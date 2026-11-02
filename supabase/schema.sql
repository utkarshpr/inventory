-- Multi-restaurant kitchen schema (Salt & Saffron, Oven & Chives).
-- Safe to run more than once in the Supabase SQL Editor (everything is idempotent).
-- Run the WHOLE file. It replaces the temporary "anon all ..." test policies.

-- ============================================================
-- 1. Tables
-- ============================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_name text,
  channel text not null default 'Direct',
  status text not null default 'New',
  total numeric(10,2) not null default 0,
  items jsonb not null default '[]'::jsonb,
  delivery_address text,
  payment_method text not null default 'Cash on delivery',
  created_at timestamptz not null default now()
);
alter table public.orders add column if not exists delivery_address text;
alter table public.orders add column if not exists payment_method text not null default 'Cash on delivery';
-- Bulk orders live in the same table, marked by kind = 'bulk' (their details are in the bulk column)
alter table public.orders add column if not exists kind text not null default 'normal';
alter table public.orders add column if not exists bulk jsonb;

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  selling_price numeric(10,2) not null default 0,
  food_cost numeric(10,2) not null default 0,
  is_published boolean not null default false,
  prep_minutes integer,
  instructions text,
  created_at timestamptz not null default now()
);
alter table public.recipes add column if not exists food_cost numeric(10,2) not null default 0;
alter table public.recipes add column if not exists is_published boolean not null default false;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  current_stock numeric(10,2) not null default 0,
  unit text,
  reorder_level numeric(10,2) default 0,
  unit_cost numeric(10,2) default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  ingredient_name text not null,
  quantity numeric(10,2),
  unit text,
  unit_cost numeric(10,2) default 0
);
-- Links an ingredient line to a stock item so orders can deduct inventory.
alter table public.recipe_ingredients
  add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null;

-- ============================================================
-- 1b. Restaurants: every order, recipe (menu) and stock item belongs to one
-- ============================================================
create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tagline text,
  order_prefix text not null default 'WEB',
  is_open boolean not null default true,
  closed_message text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.restaurants (slug, name, tagline, order_prefix, sort_order) values
  ('salt-and-saffron', 'Salt & Saffron', 'Cloud kitchen', 'SS', 1),
  ('oven-and-chives', 'Oven & Chives', 'Fresh from the oven', 'OC', 2)
on conflict (slug) do nothing;

-- Existing data (and any old app version that does not send a restaurant) goes to Salt & Saffron.
create or replace function public.default_restaurant_id() returns uuid
language sql stable as $$ select id from public.restaurants where slug = 'salt-and-saffron' $$;

alter table public.restaurants      add column if not exists location text;
alter table public.restaurants      add column if not exists upi_enabled boolean not null default true;
alter table public.restaurants      add column if not exists bulk_enabled boolean not null default false;
alter table public.restaurants      add column if not exists bulk_upi_enabled boolean not null default true;
alter table public.restaurants      add column if not exists bulk_min_qty int not null default 10;
alter table public.restaurants      add column if not exists bulk_lead_days int not null default 1;
alter table public.restaurants      add column if not exists bulk_advance_pct int not null default 0;
alter table public.restaurants      add column if not exists bulk_daily_cap int;
alter table public.restaurants      add column if not exists bulk_note text;
alter table public.restaurants      add column if not exists bulk_slots text not null default '9-11 am, 12-2 pm, 5-7 pm, 7-9 pm';
alter table public.orders           add column if not exists restaurant_id uuid references public.restaurants(id);
alter table public.recipes          add column if not exists restaurant_id uuid references public.restaurants(id);
alter table public.inventory_items  add column if not exists restaurant_id uuid references public.restaurants(id);

update public.orders          set restaurant_id = public.default_restaurant_id() where restaurant_id is null;
update public.recipes         set restaurant_id = public.default_restaurant_id() where restaurant_id is null;
update public.inventory_items set restaurant_id = public.default_restaurant_id() where restaurant_id is null;

alter table public.orders          alter column restaurant_id set default public.default_restaurant_id();
alter table public.recipes         alter column restaurant_id set default public.default_restaurant_id();
alter table public.inventory_items alter column restaurant_id set default public.default_restaurant_id();
alter table public.orders          alter column restaurant_id set not null;
alter table public.recipes         alter column restaurant_id set not null;
alter table public.inventory_items alter column restaurant_id set not null;

create index if not exists orders_restaurant_idx on public.orders (restaurant_id, created_at desc);
create index if not exists recipes_restaurant_idx on public.recipes (restaurant_id);
create index if not exists inventory_restaurant_idx on public.inventory_items (restaurant_id);

-- An ingredient line may only use stock from the SAME restaurant as its recipe.
create or replace function public.check_ingredient_restaurant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.inventory_item_id is not null and not exists (
    select 1 from public.recipes r join public.inventory_items i on i.restaurant_id = r.restaurant_id
    where r.id = new.recipe_id and i.id = new.inventory_item_id) then
    raise exception 'That stock item belongs to a different restaurant';
  end if;
  return new;
end $$;
drop trigger if exists recipe_ingredients_restaurant on public.recipe_ingredients;
create trigger recipe_ingredients_restaurant before insert or update on public.recipe_ingredients
  for each row execute function public.check_ingredient_restaurant();

-- ============================================================
-- 1c. Delivery days: each restaurant sets its own schedule; each order has a delivery date
-- ============================================================
alter table public.restaurants add column if not exists timezone text not null default 'Asia/Kolkata';
alter table public.restaurants add column if not exists delivery_mode text not null default 'daily';
alter table public.restaurants add column if not exists delivery_weekdays smallint[] not null default '{}';   -- 0 = Sunday ... 6 = Saturday
alter table public.restaurants add column if not exists delivery_anchor date;                                  -- a delivery day, for "every other day"
alter table public.restaurants add column if not exists advance_days smallint not null default 6;              -- how far ahead customers can order
alter table public.restaurants add column if not exists allow_same_day boolean not null default true;
alter table public.restaurants add column if not exists order_cutoff time;                                     -- same-day orders stop at this time (null = no cutoff)
do $$ begin
  alter table public.restaurants add constraint restaurants_delivery_mode_check check (delivery_mode in ('daily', 'alternate', 'custom'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.restaurants add constraint restaurants_advance_days_check check (advance_days between 0 and 60);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.restaurants add constraint restaurants_weekdays_check check (delivery_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]);
exception when duplicate_object then null; end $$;

alter table public.orders add column if not exists delivery_date date;
alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists coupon_code text;
alter table public.orders add column if not exists delivery_fee numeric not null default 0;
alter table public.orders add column if not exists delivery_fee_pending boolean not null default false;   -- waiting for the kitchen to set the delivery charge
alter table public.orders add column if not exists rating smallint check (rating between 1 and 5);
alter table public.orders add column if not exists rating_comment text;
alter table public.orders add column if not exists rated_at timestamptz;
alter table public.orders add column if not exists cooking_at timestamptz;
alter table public.orders add column if not exists payment_status text not null default 'not_required' check (payment_status in ('not_required', 'pending', 'received'));   -- UPI orders wait for staff to confirm the payment
alter table public.orders add column if not exists payment_confirmed_at timestamptz;
alter table public.orders add column if not exists payment_txn_id text;            -- the UPI transaction ID the customer sent (optional)
alter table public.orders add column if not exists payment_claimed_at timestamptz; -- customer pressed "I've paid": waiting for staff to verify
alter table public.orders add column if not exists payment_claims int not null default 0;
alter table public.orders add column if not exists payment_reject_reason text;     -- why staff did not accept the payment
alter table public.orders add column if not exists discount numeric not null default 0;
alter table public.recipes add column if not exists sold_out_date date;   -- sold out for that day only; clears itself the next day
alter table public.recipes add column if not exists image_url text;
alter table public.restaurants add column if not exists upi_id text;
alter table public.restaurants add column if not exists delivery_fee numeric not null default 0 check (delivery_fee >= 0);
alter table public.restaurants add column if not exists free_delivery_above numeric check (free_delivery_above is null or free_delivery_above > 0);   -- free delivery from this order value
alter table public.restaurants add column if not exists prep_minutes int default 40 check (prep_minutes is null or prep_minutes between 5 and 480);       -- usual preparation time, shown to customers
alter table public.restaurants add column if not exists unpaid_cancel_minutes int check (unpaid_cancel_minutes is null or unpaid_cancel_minutes between 5 and 1440);   -- cancel UPI orders nobody paid for
alter table public.recipes add column if not exists daily_limit int check (daily_limit is null or daily_limit >= 0);   -- plates per delivery day
alter table public.recipes add column if not exists half_plate boolean not null default false;   -- offer a half plate: full price / 2 + 50
alter table public.restaurants add column if not exists charge_mode text not null default 'fixed' check (charge_mode in ('fixed', 'distance'));   -- distance: the kitchen sets the delivery charge on each order
alter table public.restaurants add column if not exists upi_personal boolean not null default false;   -- personal UPI IDs: UPI apps refuse a pre-filled amount, so the link leaves it out
alter table public.restaurants add column if not exists low_stock_alerts boolean not null default true;   -- Settings: alert when an ingredient runs low
update public.orders set delivery_date = (created_at at time zone 'Asia/Kolkata')::date where delivery_date is null;   -- older orders: delivered on the day they were placed
alter table public.orders alter column delivery_date set default ((now() at time zone 'Asia/Kolkata')::date);
alter table public.orders alter column delivery_date set not null;
create index if not exists orders_delivery_idx on public.orders (restaurant_id, delivery_date);

-- Each restaurant's own WhatsApp group (shown on its customer pages)
alter table public.restaurants add column if not exists whatsapp_url text;
do $$ begin
  alter table public.restaurants add constraint restaurants_whatsapp_check check (whatsapp_url is null or whatsapp_url like 'https://chat.whatsapp.com/%');
exception when duplicate_object then null; end $$;
update public.restaurants set whatsapp_url = 'https://chat.whatsapp.com/DGSd2zyxnJJ3vDUPs37OSy?s=cl&p=a&iam=2' where slug = 'salt-and-saffron' and whatsapp_url is null;
update public.restaurants set whatsapp_url = 'https://chat.whatsapp.com/G4GsNiGEmGlIwk1EbcFiRM' where slug = 'oven-and-chives' and whatsapp_url is null;

-- Spam protection: a minimum order per restaurant, and the customer's phone / hashed network address for limits
alter table public.restaurants add column if not exists min_order_value numeric(10,2) not null default 0;
do $$ begin
  alter table public.restaurants add constraint restaurants_min_order_check check (min_order_value >= 0);
exception when duplicate_object then null; end $$;
alter table public.orders add column if not exists customer_phone text;   -- digits only (last 10)
alter table public.orders add column if not exists client_hash text;      -- md5 of the customer's network address, never the address itself
create index if not exists orders_phone_idx on public.orders (customer_phone, created_at desc) where customer_phone is not null;
create index if not exists orders_client_idx on public.orders (client_hash, created_at desc) where client_hash is not null;

-- Order limits shared by both restaurants (they count a customer's orders across both). 0 = no limit.
create table if not exists public.order_limits (
  id boolean primary key default true check (id),
  per_phone_hour int not null default 3 check (per_phone_hour between 0 and 100),
  per_phone_day int not null default 8 check (per_phone_day between 0 and 500),
  per_connection_hour int not null default 20 check (per_connection_hour between 0 and 500)
);
insert into public.order_limits (id) values (true) on conflict (id) do nothing;
alter table public.order_limits enable row level security;
drop policy if exists "Staff can manage order limits" on public.order_limits;
create policy "Staff can manage order limits" on public.order_limits
  for all to authenticated using (true) with check (true);

-- Sales goal shared by both restaurants (for example "London trip", target 1,00,000).
create table if not exists public.sales_goal (
  id boolean primary key default true check (id),
  name text not null default 'Sales goal',
  target numeric not null default 100000 check (target > 0),
  start_date date not null default ((now() at time zone 'Asia/Kolkata')::date)
);
insert into public.sales_goal (id) values (true) on conflict (id) do nothing;
alter table public.sales_goal enable row level security;
drop policy if exists "Staff can manage the sales goal" on public.sales_goal;
create policy "Staff can manage the sales goal" on public.sales_goal
  for all to authenticated using (true) with check (true);

-- Progress toward the goal: sales (orders that are not cancelled) since the start date, per restaurant and combined.
create or replace function public.goal_progress()
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'name', g.name, 'target', g.target, 'start_date', g.start_date,
    'total', coalesce((select sum(o.total) from public.orders o
                        where o.status <> 'Cancelled' and o.payment_status <> 'pending' and (o.created_at at time zone 'Asia/Kolkata')::date >= g.start_date), 0),
    'by_restaurant', (select coalesce(jsonb_agg(jsonb_build_object('restaurant_id', r.id, 'name', r.name, 'slug', r.slug,
                              'sales', coalesce(s.sales, 0), 'orders', coalesce(s.n, 0)) order by r.sort_order), '[]'::jsonb)
                        from public.restaurants r
                        left join (select o.restaurant_id, sum(o.total) as sales, count(*) as n from public.orders o
                                    where o.status <> 'Cancelled' and o.payment_status <> 'pending' and (o.created_at at time zone 'Asia/Kolkata')::date >= g.start_date
                                    group by o.restaurant_id) s on s.restaurant_id = r.id))
  from public.sales_goal g limit 1;
$$;
revoke all on function public.goal_progress() from public, anon;
grant execute on function public.goal_progress() to authenticated;

-- Private per-restaurant settings. Staff only: the phone-alert topic is a secret, so it must not live in the public restaurants table.
create table if not exists public.restaurant_secrets (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  alert_topic text
);
do $$ begin
  alter table public.restaurant_secrets add constraint restaurant_secrets_topic_check check (alert_topic is null or alert_topic ~ '^[A-Za-z0-9_-]{8,64}$');
exception when duplicate_object then null; end $$;
alter table public.restaurant_secrets enable row level security;
drop policy if exists "Staff can manage restaurant secrets" on public.restaurant_secrets;
create policy "Staff can manage restaurant secrets" on public.restaurant_secrets
  for all to authenticated using (true) with check (true);

-- The delivery days a customer may choose right now (single source of truth: the app and place_order both use it)
create or replace function public.delivery_dates(p_restaurant uuid, p_from timestamptz default now())
returns date[]
language plpgsql stable security definer set search_path = public as $$
declare r record; local_now timestamp; today date; d date; i int; ok boolean; out date[] := '{}';
begin
  select * into r from public.restaurants where id = p_restaurant;
  if not found then return out; end if;
  local_now := p_from at time zone r.timezone;
  today := local_now::date;
  for i in 0..r.advance_days loop
    d := today + i;
    if i = 0 and (not r.allow_same_day or (r.order_cutoff is not null and local_now::time >= r.order_cutoff)) then continue; end if;
    ok := case r.delivery_mode
      when 'custom' then extract(dow from d)::int = any(r.delivery_weekdays)
      when 'alternate' then (((d - coalesce(r.delivery_anchor, today)) % 2) + 2) % 2 = 0
      else true end;
    if ok then out := out || d; end if;
  end loop;
  return out;
end $$;
revoke all on function public.delivery_dates(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.get_delivery_dates(p_restaurant text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'dates', to_jsonb(public.delivery_dates(r.id)),
    'today', (now() at time zone r.timezone)::date,
    'mode', r.delivery_mode, 'weekdays', to_jsonb(r.delivery_weekdays), 'advance_days', r.advance_days)
  from public.restaurants r where r.slug = p_restaurant;
$$;
revoke all on function public.get_delivery_dates(text) from public;
grant execute on function public.get_delivery_dates(text) to anon, authenticated;

-- ============================================================
-- 2. Row Level Security: staff only, plus the public menu
-- ============================================================
alter table public.orders enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.inventory_items enable row level security;
alter table public.restaurants enable row level security;

-- Remove every older / temporary policy
drop policy if exists "anon all orders" on public.orders;
drop policy if exists "anon all recipes" on public.recipes;
drop policy if exists "anon all recipe_ingredients" on public.recipe_ingredients;
drop policy if exists "anon all inventory_items" on public.inventory_items;
drop policy if exists "Customers can place orders" on public.orders;
drop policy if exists "Kitchen can read orders" on public.orders;
drop policy if exists "Customers can view menu" on public.recipes;
drop policy if exists "Staff can manage orders" on public.orders;
drop policy if exists "Staff can manage recipes" on public.recipes;
drop policy if exists "Staff can manage recipe ingredients" on public.recipe_ingredients;
drop policy if exists "Staff can manage inventory" on public.inventory_items;
drop policy if exists "Anyone can view restaurants" on public.restaurants;
drop policy if exists "Staff can manage restaurants" on public.restaurants;

-- Signed-in staff can do everything.
-- IMPORTANT: turn OFF "Allow new users to sign up" in Supabase
-- (Authentication > Sign In / Providers), otherwise anyone could register as staff.
create policy "Staff can manage orders" on public.orders
  for all to authenticated using (true) with check (true);
create policy "Staff can manage recipes" on public.recipes
  for all to authenticated using (true) with check (true);
create policy "Staff can manage recipe ingredients" on public.recipe_ingredients
  for all to authenticated using (true) with check (true);
create policy "Staff can manage inventory" on public.inventory_items
  for all to authenticated using (true) with check (true);

-- Visitors may only read dishes that are published to today's menu.
create policy "Anyone can view restaurants" on public.restaurants
  for select to anon, authenticated using (true);
create policy "Staff can manage restaurants" on public.restaurants
  for all to authenticated using (true) with check (true);

-- Visitors only see published dishes of a restaurant that is open (the kill switch hides the menu).
create policy "Customers can view menu" on public.recipes
  for select to anon using (
    is_published = true
    and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.is_open));

-- Visitors can NOT read or insert orders directly. They go through place_order() below.

-- ============================================================
-- 3. Customer ordering: server-side validation + total, per restaurant, on an allowed delivery day
-- ============================================================
-- Coupon codes. Customers never read this table; they can only ask whether a code works (validate_coupon).
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  restaurant_id uuid references public.restaurants(id) on delete cascade,   -- null = works at both restaurants
  kind text not null check (kind in ('percent', 'flat')),
  value numeric not null check (value > 0),
  max_discount numeric check (max_discount is null or max_discount > 0),    -- cap for percent codes
  min_order numeric not null default 0 check (min_order >= 0),
  expires_on date,
  max_uses int check (max_uses is null or max_uses > 0),
  used int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100)
);
alter table public.coupons enable row level security;
drop policy if exists "Staff can manage coupons" on public.coupons;
create policy "Staff can manage coupons" on public.coupons for all to authenticated using (true) with check (true);

create or replace function public.coupon_discount(p_rid uuid, p_code text, p_subtotal numeric)
returns numeric
language plpgsql security definer set search_path = public as $$
declare c record; d numeric;
begin
  select * into c from public.coupons
   where code = upper(trim(p_code)) and is_active and (restaurant_id is null or restaurant_id = p_rid);
  if not found
     or (c.expires_on is not null and c.expires_on < (now() at time zone 'Asia/Kolkata')::date)
     or (c.max_uses is not null and c.used >= c.max_uses) then
    raise exception 'COUPON: This code is not valid';
  end if;
  if p_subtotal < c.min_order then
    raise exception 'COUPON: This code needs an order of at least ₹%', trim_scale(c.min_order);
  end if;
  d := case c.kind when 'percent' then round(p_subtotal * c.value / 100) else c.value end;
  if c.kind = 'percent' and c.max_discount is not null then d := least(d, c.max_discount); end if;
  return least(d, p_subtotal);
end $$;
revoke all on function public.coupon_discount(uuid, text, numeric) from public, anon, authenticated;

create or replace function public.validate_coupon(p_restaurant text, p_code text, p_subtotal numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid; d numeric;
begin
  select id into rid from public.restaurants where slug = p_restaurant;
  if rid is null then raise exception 'Restaurant not found'; end if;
  d := public.coupon_discount(rid, p_code, coalesce(p_subtotal, 0));
  return jsonb_build_object('code', upper(trim(p_code)), 'discount', d);
end $$;
revoke all on function public.validate_coupon(text, text, numeric) from public;
grant execute on function public.validate_coupon(text, text, numeric) to anon, authenticated;

drop function if exists public.place_order(text, text, text, text, text, text, jsonb, date);
create or replace function public.place_order(
  p_restaurant text, p_name text, p_phone text, p_address text, p_payment text, p_notes text, p_items jsonb, p_delivery_date date, p_coupon text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rest record; it jsonb; rc record; qty int;
  v_phone text; v_ip text; v_hash text; n int;
  v_ph int; v_pd int; v_ch int;
  total numeric := 0; v_disc numeric := 0; v_code text; subtotal numeric; v_fee numeric := 0; v_pending boolean := false;
  taken jsonb := '{}'::jsonb; plates_used int; opt record; opt_ids jsonb; opts_price numeric; opts_text text; size_n int; has_size boolean; unit numeric;
  lines jsonb := '[]'::jsonb;
  num text; tries int := 0;
begin
  select * into rest from public.restaurants where slug = p_restaurant;
  if not found then raise exception 'Restaurant not found'; end if;
  if not rest.is_open then
    raise exception 'RESTAURANT_CLOSED: %', coalesce(nullif(trim(rest.closed_message), ''), 'We are closed right now. Please check back soon.');
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_phone), '') = '' or coalesce(trim(p_address), '') = '' then
    raise exception 'Name, phone and delivery address are required';
  end if;
  if length(p_name) > 80 or length(p_phone) > 20 or length(p_address) > 300 or length(coalesce(p_notes, '')) > 300 then
    raise exception 'Some details are too long';
  end if;
  if p_payment not in ('Cash on delivery', 'UPI') then
    raise exception 'Invalid payment method';
  end if;
  if p_payment = 'UPI' and not coalesce(rest.upi_enabled, true) then
    raise exception 'UPI_OFF: UPI is not available right now. Please choose cash on delivery.';
  end if;

  -- Phone: a real 10-digit mobile number (spaces, +91 and dashes are fine)
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_phone) > 10 then v_phone := right(v_phone, 10); end if;
  if length(v_phone) <> 10 or v_phone !~ '^[6-9]' then
    raise exception 'INVALID_PHONE: Enter a valid 10-digit mobile number';
  end if;
  -- Limits per phone number (all restaurants together) and per network address
  select coalesce(max(per_phone_hour), 3), coalesce(max(per_phone_day), 8), coalesce(max(per_connection_hour), 20) into v_ph, v_pd, v_ch from public.order_limits;
  select count(*) into n from public.orders where customer_phone = v_phone and channel = 'Customer form' and created_at > now() - interval '1 hour';
  if v_ph > 0 and n >= v_ph then raise exception 'RATE_LIMIT: Too many orders from this phone number. Please try again in a little while, or call the kitchen.'; end if;
  select count(*) into n from public.orders where customer_phone = v_phone and channel = 'Customer form' and created_at > now() - interval '24 hours';
  if v_pd > 0 and n >= v_pd then raise exception 'RATE_LIMIT: Too many orders from this phone number today. Please call the kitchen.'; end if;
  begin
    v_ip := nullif(trim(split_part(coalesce((nullif(current_setting('request.headers', true), ''))::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then v_ip := null; end;
  if v_ip is not null then
    v_hash := md5(v_ip);
    select count(*) into n from public.orders where client_hash = v_hash and created_at > now() - interval '1 hour';
    if v_ch > 0 and n >= v_ch then raise exception 'RATE_LIMIT: Too many orders from this connection. Please try again later, or call the kitchen.'; end if;
  end if;

  if p_delivery_date is null or not (p_delivery_date = any(public.delivery_dates(rest.id))) then
    raise exception 'INVALID_DELIVERY_DATE: Please choose one of the available delivery days';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception 'Select at least one item';
  end if;

  -- Prices come from this restaurant's recipes, never from the browser.
  for it in select * from jsonb_array_elements(p_items) loop
    begin qty := (it->>'quantity')::int; exception when others then qty := 0; end;
    if qty < 1 or qty > 50 then raise exception 'Invalid quantity'; end if;
    select id, name, selling_price, sold_out_date, daily_limit, half_plate into rc
      from public.recipes
      where id::text = it->>'recipe_id' and is_published = true and restaurant_id = rest.id;
    if not found then raise exception 'An item is no longer on the menu'; end if;
    if rc.sold_out_date is not null and rc.sold_out_date = (now() at time zone coalesce(rest.timezone, 'Asia/Kolkata'))::date then
      raise exception 'SOLD_OUT: % is sold out today', rc.name;
    end if;
    -- Options (size, extras): prices come from the database. A dish with sizes needs exactly one size.
    opts_price := 0; opts_text := ''; size_n := 0;
    opt_ids := case when jsonb_typeof(it->'options') = 'array' then it->'options' else '[]'::jsonb end;
    if jsonb_array_length(opt_ids) > 10 then raise exception 'Too many options'; end if;
    if (select count(*) from jsonb_array_elements_text(opt_ids)) <> (select count(*) from jsonb_array_elements_text(opt_ids) e join public.recipe_options o on o.id::text = e and o.recipe_id = rc.id) then
      raise exception 'An option is no longer available';
    end if;
    -- the same extra can be picked more than once (2 x raita): price and label count each pick
    for opt in select o.kind, o.name, o.price_delta, count(*)::int as n from jsonb_array_elements_text(opt_ids) e join public.recipe_options o on o.id::text = e and o.recipe_id = rc.id group by o.kind, o.name, o.price_delta, o.sort_order order by o.sort_order, o.name loop
      opts_price := opts_price + opt.price_delta * opt.n;
      opts_text := opts_text || case when opts_text = '' then '' else ', ' end || opt.name || case when opt.n > 1 then ' x' || opt.n else '' end;
      if opt.kind = 'size' then size_n := size_n + opt.n; end if;
    end loop;
    select exists (select 1 from public.recipe_options o where o.recipe_id = rc.id and o.kind = 'size') into has_size;
    if size_n > 1 or (has_size and size_n = 0) then raise exception 'OPTIONS: Choose a size for %', rc.name; end if;
    -- Plates per delivery day
    if rc.daily_limit is not null then
      perform pg_advisory_xact_lock(hashtext(rc.id::text));
      taken := taken || jsonb_build_object(rc.id::text, coalesce((taken->>rc.id::text)::int, 0) + qty);
      select coalesce(sum((i->>'quantity')::int), 0) into plates_used
        from public.orders o, jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) i
       where o.restaurant_id = rest.id and o.delivery_date = p_delivery_date and o.status <> 'Cancelled'
         and jsonb_typeof(i) = 'object' and lower(i->>'name') = lower(rc.name);
      if plates_used + (taken->>rc.id::text)::int > rc.daily_limit then
        if rc.daily_limit - plates_used > 0 then raise exception 'SOLD_OUT: Only % of % left for that day', rc.daily_limit - plates_used, rc.name;
        else raise exception 'SOLD_OUT: % is sold out for that day', rc.name; end if;
      end if;
    end if;
    unit := rc.selling_price + opts_price;
    if coalesce((it->>'half')::boolean, false) then   -- half plate: full price / 2 + 50, half the ingredients
      if not rc.half_plate or has_size then raise exception 'OPTIONS: A half plate is not available for %', rc.name; end if;
      unit := ceil(rc.selling_price / 2.0) + 50 + opts_price;
      opts_text := 'Half plate' || case when opts_text = '' then '' else ', ' || opts_text end;
    end if;
    total := total + unit * qty;
    lines := lines || jsonb_build_array(jsonb_strip_nulls(
      jsonb_build_object('name', rc.name, 'quantity', qty, 'price', unit, 'options', nullif(opts_text, ''),
                         'portion', case when coalesce((it->>'half')::boolean, false) then 0.5 end)));
  end loop;

  if total < rest.min_order_value then
    raise exception 'MIN_ORDER: The minimum order is ₹%', trim_scale(rest.min_order_value);
  end if;

  subtotal := total;
  if coalesce(trim(p_coupon), '') <> '' then
    v_code := upper(trim(p_coupon));
    v_disc := public.coupon_discount(rest.id, v_code, subtotal);   -- raises COUPON: ... when not valid
    update public.coupons set used = used + 1 where code = v_code and (max_uses is null or used < max_uses);
    if not found then raise exception 'COUPON: This code is not valid'; end if;
    total := total - v_disc;
  end if;
  v_pending := rest.charge_mode = 'distance';   -- the kitchen sets the charge after the order is placed
  v_fee := case when v_pending then 0 when rest.free_delivery_above is not null and subtotal >= rest.free_delivery_above then 0 else coalesce(rest.delivery_fee, 0) end;
  total := total + v_fee;

  if coalesce(trim(p_notes), '') <> '' then
    lines := lines || jsonb_build_array(
      jsonb_build_object('name', 'Note: ' || trim(p_notes), 'quantity', 1, 'price', 0));
  end if;

  loop
    num := rest.order_prefix || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    begin
      insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, client_hash, channel, status, total, items, delivery_address, delivery_date, payment_method, coupon_code, discount, payment_status, delivery_fee, delivery_fee_pending)
      values (rest.id, num, trim(p_name) || ' · ' || trim(p_phone), v_phone, v_hash, 'Customer form', 'New', total, lines, trim(p_address), p_delivery_date, p_payment, v_code, v_disc,
              case when p_payment = 'UPI' then 'pending' else 'not_required' end, v_fee, v_pending);
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise exception 'Could not create the order, please try again'; end if;
    end;
  end loop;

  return jsonb_build_object('order_number', num, 'total', total, 'subtotal', subtotal, 'discount', v_disc, 'delivery_fee', v_fee, 'delivery_fee_pending', v_pending, 'coupon', v_code, 'restaurant', rest.name, 'items', lines, 'delivery_date', p_delivery_date);
end $$;
revoke all on function public.place_order(text, text, text, text, text, text, jsonb, date, text) from public;
grant execute on function public.place_order(text, text, text, text, text, text, jsonb, date, text) to anon, authenticated;

-- Older app versions (no delivery date): the order goes to the first available day.
create or replace function public.place_order(
  p_restaurant text, p_name text, p_phone text, p_address text, p_payment text, p_notes text, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid; d date[];
begin
  select id into rid from public.restaurants where slug = p_restaurant;
  if rid is null then raise exception 'Restaurant not found'; end if;
  d := public.delivery_dates(rid);
  if coalesce(array_length(d, 1), 0) = 0 then raise exception 'INVALID_DELIVERY_DATE: No delivery days are available right now'; end if;
  return public.place_order(p_restaurant, p_name, p_phone, p_address, p_payment, p_notes, p_items, d[1]);
end $$;
revoke all on function public.place_order(text, text, text, text, text, text, jsonb) from public;
grant execute on function public.place_order(text, text, text, text, text, text, jsonb) to anon, authenticated;

create or replace function public.place_order(
  p_name text, p_phone text, p_address text, p_payment text, p_notes text, p_items jsonb
) returns jsonb
language sql security definer set search_path = public as $$
  select public.place_order('salt-and-saffron', p_name, p_phone, p_address, p_payment, p_notes, p_items);
$$;
revoke all on function public.place_order(text, text, text, text, text, jsonb) from public;
grant execute on function public.place_order(text, text, text, text, text, jsonb) to anon, authenticated;

-- ============================================================
-- 4. Customer order tracking (status only, needs the exact reference number)
-- ============================================================
-- Item names and quantities only (no prices or notes), safe to show on the tracking page.
create or replace function public.public_items(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(case when jsonb_typeof(i) = 'object'
      then jsonb_strip_nulls(jsonb_build_object('name', i->>'name', 'quantity', coalesce(i->'quantity', '1'::jsonb), 'options', i->'options'))
      else jsonb_build_object('name', i #>> '{}', 'quantity', 1) end), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) i
$$;

create or replace function public.track_order(p_order_number text)
returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'rating', o.rating, 'rating_comment', o.rating_comment, 'delivery_fee', o.delivery_fee, 'kind', o.kind, 'bulk', o.bulk, 'delivery_fee_pending', o.delivery_fee_pending,
    'eta_at', case when o.status in ('New', 'Cooking') and r.prep_minutes is not null and o.payment_status <> 'pending'
                    and o.delivery_date = (now() at time zone coalesce(r.timezone, 'Asia/Kolkata'))::date
                   then coalesce(o.cooking_at, o.payment_confirmed_at, o.created_at) + make_interval(mins => r.prep_minutes) end,
    'order_number', o.order_number, 'status', o.status, 'total', o.total, 'placed_at', o.created_at,
    'delivery_date', o.delivery_date, 'cancel_reason', o.cancel_reason, 'payment_status', o.payment_status, 'payment_claimed', o.payment_claimed_at is not null, 'payment_reject_reason', o.payment_reject_reason, 'payment', o.payment_method, 'discount', o.discount, 'coupon', o.coupon_code, 'lines', (select coalesce(jsonb_agg(jsonb_build_object('name', x->>'name', 'quantity', coalesce(x->'quantity', '1'::jsonb), 'price', x->'price', 'options', x->'options')), '[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x where jsonb_typeof(x) = 'object' and (x->>'name') not like 'Note:%'),
    'items', public.public_items(o.items), 'restaurant', r.name, 'restaurant_slug', r.slug)
  from public.orders o join public.restaurants r on r.id = o.restaurant_id
  where o.order_number = upper(trim(p_order_number))
  limit 1;
$$;
-- Orders for one phone number, newest first, a page at a time. Shows date, status, items and quantities only: no names, addresses or prices.
drop function if exists public.track_orders_by_phone(text, int, int);
create or replace function public.track_orders_by_phone(p_phone text, p_limit int default 5, p_offset int default 0, p_restaurant text default null)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); v_lim int := least(greatest(coalesce(p_limit, 5), 1), 20); v_off int := greatest(coalesce(p_offset, 0), 0); v_total int; v_rows jsonb;
begin
  if length(v_phone) <> 10 or v_phone !~ '^[6-9]' then raise exception 'INVALID_PHONE: Enter a valid 10-digit mobile number'; end if;
  select count(*) into v_total from public.orders o0 where o0.customer_phone = v_phone and (p_restaurant is null or o0.restaurant_id = (select id from public.restaurants where slug = p_restaurant));
  select coalesce(jsonb_agg(x order by x_at desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('rating', o.rating, 'order_number', o.order_number, 'status', o.status, 'total', o.total, 'placed_at', o.created_at,
      'delivery_date', o.delivery_date, 'cancel_reason', o.cancel_reason, 'payment_status', o.payment_status, 'payment_claimed', o.payment_claimed_at is not null, 'payment_reject_reason', o.payment_reject_reason, 'kind', o.kind, 'delivery_fee_pending', o.delivery_fee_pending, 'items', public.public_items(o.items), 'restaurant', r.name, 'restaurant_slug', r.slug) as x, o.created_at as x_at
    from public.orders o join public.restaurants r on r.id = o.restaurant_id
    where o.customer_phone = v_phone and (p_restaurant is null or r.slug = p_restaurant) order by o.created_at desc limit v_lim offset v_off) s;
  return jsonb_build_object('total', v_total, 'limit', v_lim, 'offset', v_off, 'orders', v_rows);
end $$;
revoke all on function public.track_orders_by_phone(text, int, int, text) from public;
grant execute on function public.track_orders_by_phone(text, int, int, text) to anon, authenticated;

revoke all on function public.track_order(text) from public;
grant execute on function public.track_order(text) to anon, authenticated;

-- ============================================================
-- 5. Automatic inventory deduction (scoped to the order's restaurant)
--    New order -> that restaurant's stock goes down. Cancelled -> put back.
-- ============================================================
drop function if exists public.apply_inventory_delta(jsonb, int);
create or replace function public.apply_inventory_delta(p_items jsonb, p_sign int, p_restaurant uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; r record; q numeric;
begin
  begin
    for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      if jsonb_typeof(it) <> 'object' then continue; end if;
      q := case when (it->>'quantity') ~ '^[0-9]+(\.[0-9]+)?$' then (it->>'quantity')::numeric else 0 end;
      if q <= 0 then continue; end if;
      q := q * case when (it->>'portion') ~ '^[0-9]+(\.[0-9]+)?$' then (it->>'portion')::numeric else 1 end;   -- a half plate uses half the ingredients
      for r in
        select ri.inventory_item_id, ri.quantity
        from public.recipes rc
        join public.recipe_ingredients ri on ri.recipe_id = rc.id
        where rc.restaurant_id = p_restaurant
          and lower(rc.name) = lower(it->>'name')
          and ri.inventory_item_id is not null and ri.quantity is not null
      loop
        update public.inventory_items
           set current_stock = greatest(current_stock + p_sign * r.quantity * q, 0),
               updated_at = now()
         where id = r.inventory_item_id and restaurant_id = p_restaurant;
      end loop;
    end loop;
  exception when others then
    -- Never block an order because of an inventory problem.
    raise warning 'inventory update skipped: %', sqlerrm;
  end;
end $$;
revoke all on function public.apply_inventory_delta(jsonb, int, uuid) from public, anon, authenticated;

create or replace function public.orders_inventory_trigger()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'Cancelled' then perform public.apply_inventory_delta(new.items, -1, new.restaurant_id); end if;
  elsif tg_op = 'UPDATE' then
    if old.status <> 'Cancelled' and new.status = 'Cancelled' then
      perform public.apply_inventory_delta(old.items, 1, old.restaurant_id);
    elsif old.status = 'Cancelled' and new.status <> 'Cancelled' then
      perform public.apply_inventory_delta(new.items, -1, new.restaurant_id);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.orders_inventory_trigger() from public, anon, authenticated;

drop trigger if exists orders_inventory on public.orders;
create trigger orders_inventory
  after insert or update of status on public.orders
  for each row execute function public.orders_inventory_trigger();

-- ============================================================
-- 5b. Phone alert to the owner for every NEW CUSTOMER order, even when no dashboard is open.
--     Off until a restaurant has an alert topic (Settings > Phone alerts). Uses the free ntfy.sh service.
--     The message carries only the reference, total and delivery date, never customer details.
-- ============================================================
do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net could not be enabled here. Turn it on under Database > Extensions to use phone alerts.';
end $$;

create or replace function public.notify_owner()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare r record; t text;
begin
  if new.channel not in ('Customer form', 'Bulk order') then return new; end if;
  select s.alert_topic, x.name into r
    from public.restaurants x left join public.restaurant_secrets s on s.restaurant_id = x.id
   where x.id = new.restaurant_id;
  if r.alert_topic is null then return new; end if;
  begin
    perform net.http_post(
      url := 'https://ntfy.sh/',
      body := jsonb_build_object(
        'topic', r.alert_topic,
        'title', r.name || case when new.channel = 'Bulk order' then ': NEW BULK ORDER' else ': new order' end,
        'message', new.order_number || ' · ₹' || trim_scale(new.total)::text || ' · delivery ' || new.delivery_date::text,
        'priority', 4, 'tags', jsonb_build_array('bell')));
  exception when others then
    raise warning 'owner alert skipped: %', sqlerrm;   -- never block an order because an alert failed
  end;
  return new;
end $$;
revoke all on function public.notify_owner() from public, anon, authenticated;

-- ------------------------------------------------------------
-- Alerts that reach staff phones even when the app is closed (web push).
-- Each device subscribes for one restaurant at a time; an order only alerts its own restaurant.
-- ------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint text not null,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  primary key (endpoint, restaurant_id)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "Staff can manage push subscriptions" on public.push_subscriptions;
create policy "Staff can manage push subscriptions" on public.push_subscriptions for all to authenticated using (true) with check (true);

-- Where to send the alert (the send-push function) and the shared secret it expects.
-- No policies on purpose: only the database itself reads it, never the app.
create table if not exists public.push_config (
  id boolean primary key default true check (id),
  function_url text,
  shared_secret text
);
insert into public.push_config (id) values (true) on conflict (id) do nothing;
alter table public.push_config enable row level security;

create or replace function public.push_owner()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare c record; rname text;
begin
  if new.channel not in ('Customer form', 'Bulk order') then return new; end if;
  select function_url, shared_secret into c from public.push_config limit 1;
  if c.function_url is null or c.shared_secret is null then return new; end if;
  if not exists (select 1 from public.push_subscriptions where restaurant_id = new.restaurant_id) then return new; end if;
  select name into rname from public.restaurants where id = new.restaurant_id;
  begin
    perform net.http_post(
      url := c.function_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.shared_secret),
      body := jsonb_build_object('restaurant_id', new.restaurant_id, 'restaurant', rname, 'order_number', new.order_number,
        'total', new.total, 'delivery_date', new.delivery_date));
  exception when others then
    raise warning 'push alert skipped: %', sqlerrm;   -- never block an order because an alert failed
  end;
  return new;
end $$;
revoke all on function public.push_owner() from public, anon, authenticated;
drop trigger if exists orders_push_owner on public.orders;
create trigger orders_push_owner after insert on public.orders
  for each row execute function public.push_owner();

drop trigger if exists orders_notify_owner on public.orders;
create trigger orders_notify_owner after insert on public.orders
  for each row execute function public.notify_owner();

-- ============================================================
-- 6. Realtime (instant orders and stock in the kitchen dashboard)
-- ============================================================
do $$
begin
  begin alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.inventory_items;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.restaurants;
  exception when duplicate_object then null; end;
end $$;

-- ============================================================
-- 9. Owner alerts: low stock, daily summary, dish photos
-- ============================================================
-- One place that sends an alert to a restaurant's phones (web push) and its ntfy topic. Never blocks anything if it fails.
create or replace function public.send_alert(p_restaurant uuid, p_title text, p_body text, p_tag text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare c record; topic text;
begin
  select function_url, shared_secret into c from public.push_config limit 1;
  if c.function_url is not null and c.shared_secret is not null then
    begin
      perform net.http_post(url := c.function_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.shared_secret),
        body := jsonb_build_object('restaurant_id', p_restaurant, 'title', p_title, 'body', p_body, 'tag', p_tag));
    exception when others then raise warning 'push alert skipped: %', sqlerrm; end;
  end if;
  select alert_topic into topic from public.restaurant_secrets where restaurant_id = p_restaurant;
  if topic is not null then
    begin
      perform net.http_post(url := 'https://ntfy.sh/',
        body := jsonb_build_object('topic', topic, 'title', p_title, 'message', p_body, 'priority', 3, 'tags', jsonb_build_array('package')));
    exception when others then raise warning 'ntfy alert skipped: %', sqlerrm; end;
  end if;
end $$;
revoke all on function public.send_alert(uuid, text, text, text) from public, anon, authenticated;

-- Low stock: alert once when an ingredient falls to its reorder level (each restaurant can turn this off in Settings).
create or replace function public.alert_low_stock()
returns trigger
language plpgsql security definer set search_path = public as $$
declare rname text; enabled boolean;
begin
  if new.restaurant_id is null or new.reorder_level is null or new.reorder_level <= 0 then return new; end if;
  if new.current_stock <= new.reorder_level and old.current_stock > old.reorder_level then
    select name, low_stock_alerts into rname, enabled from public.restaurants where id = new.restaurant_id;
    if not coalesce(enabled, true) then return new; end if;   -- this restaurant turned low-stock alerts off
    perform public.send_alert(new.restaurant_id, 'Low stock · ' || coalesce(rname, 'Kitchen'),
      new.name || ': ' || trim_scale(new.current_stock)::text || ' ' || coalesce(new.unit, '') || ' left (reorder at ' || trim_scale(new.reorder_level)::text || ')',
      'stock-' || new.id::text);
  end if;
  return new;
end $$;
revoke all on function public.alert_low_stock() from public, anon, authenticated;
drop trigger if exists inventory_low_stock on public.inventory_items;
create trigger inventory_low_stock after update of current_stock on public.inventory_items
  for each row execute function public.alert_low_stock();

-- Daily closing summary: orders and sales per restaurant, plus progress toward the goal. Sent at 10:30 pm IST.
create or replace function public.send_daily_summary()
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r record; c record; g record; body text := ''; tot numeric := 0; goal_total numeric; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  for r in
    select rs.id, rs.name,
           coalesce(sum(o.total) filter (where o.status <> 'Cancelled' and o.payment_status <> 'pending'), 0) as sales,
           count(o.id) filter (where o.status <> 'Cancelled' and o.payment_status <> 'pending') as n,
           count(o.id) filter (where o.status = 'Cancelled') as cancelled
      from public.restaurants rs
      left join public.orders o on o.restaurant_id = rs.id and (o.created_at at time zone 'Asia/Kolkata')::date = today
     group by rs.id, rs.name, rs.sort_order order by rs.sort_order
  loop
    tot := tot + r.sales;
    body := body || r.name || ': ' || r.n || ' order' || case when r.n = 1 then '' else 's' end || ', ₹' || trim_scale(r.sales)::text
            || case when r.cancelled > 0 then ' (' || r.cancelled || ' cancelled)' else '' end || E'\n';
    begin   -- ntfy backup: each restaurant's own numbers
      perform public.send_alert_ntfy_only(r.id, 'Today · ' || r.name, r.n || ' orders, ₹' || trim_scale(r.sales)::text);
    exception when others then null; end;
  end loop;
  body := body || 'Total ₹' || trim_scale(tot)::text;
  select * into g from public.sales_goal limit 1;
  if found then
    select coalesce(sum(total), 0) into goal_total from public.orders where status <> 'Cancelled' and payment_status <> 'pending' and (created_at at time zone 'Asia/Kolkata')::date >= g.start_date;
    body := body || E'\n' || g.name || ': ' || floor(goal_total * 100 / g.target)::text || '% (₹' || trim_scale(goal_total)::text || ' of ₹' || trim_scale(g.target)::text || ')';
  end if;
  select function_url, shared_secret into c from public.push_config limit 1;
  if c.function_url is not null and c.shared_secret is not null then
    begin
      perform net.http_post(url := c.function_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.shared_secret),
        body := jsonb_build_object('all', true, 'title', 'Today''s summary', 'body', body, 'tag', 'daily-summary'));
    exception when others then raise warning 'daily summary push skipped: %', sqlerrm; end;
  end if;
end $$;
revoke all on function public.send_daily_summary() from public, anon, authenticated;

create or replace function public.send_alert_ntfy_only(p_restaurant uuid, p_title text, p_body text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare topic text;
begin
  select alert_topic into topic from public.restaurant_secrets where restaurant_id = p_restaurant;
  if topic is not null then
    perform net.http_post(url := 'https://ntfy.sh/', body := jsonb_build_object('topic', topic, 'title', p_title, 'message', p_body, 'priority', 2, 'tags', jsonb_build_array('chart_with_upwards_trend')));
  end if;
end $$;
revoke all on function public.send_alert_ntfy_only(uuid, text, text) from public, anon, authenticated;

-- Run the summary every night at 10:30 pm IST (17:00 UTC). Needs the pg_cron extension (Database > Extensions).
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('daily-summary', '0 17 * * *', 'select public.send_daily_summary()');
exception when others then
  raise notice 'pg_cron could not be set up here (%). Turn on pg_cron under Database > Extensions, then run this file again to get the daily summary.', sqlerrm;
end $$;

-- Dish photos: anyone can see them, only signed-in staff can add or change them.
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('dish-photos', 'dish-photos', true) on conflict (id) do nothing;
    execute 'drop policy if exists "Staff can see dish photos" on storage.objects';
    execute 'create policy "Staff can see dish photos" on storage.objects for select to authenticated using (bucket_id = ''dish-photos'')';
    execute 'drop policy if exists "Staff can add dish photos" on storage.objects';
    execute 'create policy "Staff can add dish photos" on storage.objects for insert to authenticated with check (bucket_id = ''dish-photos'')';
    execute 'drop policy if exists "Staff can change dish photos" on storage.objects';
    execute 'create policy "Staff can change dish photos" on storage.objects for update to authenticated using (bucket_id = ''dish-photos'') with check (bucket_id = ''dish-photos'')';
    execute 'drop policy if exists "Staff can remove dish photos" on storage.objects';
    execute 'create policy "Staff can remove dish photos" on storage.objects for delete to authenticated using (bucket_id = ''dish-photos'')';
  end if;
exception when others then
  raise notice 'Dish photo storage could not be set up here (%). Create a public bucket named dish-photos under Storage.', sqlerrm;
end $$;

-- ============================================================
-- 10. UPI payments: an order paid by UPI cannot be cooked until staff confirm the payment
-- ============================================================
create or replace function public.gate_payment()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.payment_status = 'pending' and new.status in ('Cooking', 'Ready', 'Delivered') and new.status is distinct from old.status then
    raise exception 'PAYMENT_PENDING: Confirm the UPI payment before cooking this order';
  end if;
  return new;
end $$;
drop trigger if exists orders_gate_payment on public.orders;
create trigger orders_gate_payment before update on public.orders
  for each row execute function public.gate_payment();

-- The customer says "I've paid" (optionally with the UPI transaction ID). Staff then verify and accept or reject.
create or replace function public.claim_payment(p_order_number text, p_txn text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; t text := nullif(trim(coalesce(p_txn, '')), '');
begin
  select * into o from public.orders where order_number = upper(trim(coalesce(p_order_number, '')));
  if not found then raise exception 'PAYMENT: We could not find that order'; end if;
  if o.payment_method is distinct from 'UPI' or o.payment_status <> 'pending' or o.status = 'Cancelled' then
    raise exception 'PAYMENT: This order is not waiting for a UPI payment';
  end if;
  if o.delivery_fee_pending then raise exception 'PAYMENT: Wait for the kitchen to add the delivery charge, then pay the new total'; end if;
  if t is not null and t !~ '^[A-Za-z0-9]{6,40}$' then
    raise exception 'PAYMENT: The transaction ID should be 6 to 40 letters or numbers, with no spaces';
  end if;
  if o.payment_claims >= 5 then raise exception 'PAYMENT: Too many tries. Please call the kitchen.'; end if;
  update public.orders
     set payment_txn_id = coalesce(t, payment_txn_id), payment_claimed_at = now(),
         payment_claims = payment_claims + 1, payment_reject_reason = null
   where id = o.id;
  return jsonb_build_object('claimed', true);
end $$;
revoke all on function public.claim_payment(text, text) from public;
grant execute on function public.claim_payment(text, text) to anon, authenticated;

-- Tell staff (push + ntfy) when a payment is waiting to be verified.
create or replace function public.alert_payment_claim()
returns trigger
language plpgsql security definer set search_path = public as $$
declare rname text;
begin
  if new.payment_claimed_at is not null and new.payment_claimed_at is distinct from old.payment_claimed_at then
    select name into rname from public.restaurants where id = new.restaurant_id;
    perform public.send_alert(new.restaurant_id, 'Verify payment · ' || coalesce(rname, 'Kitchen'),
      new.order_number || ' · ₹' || trim_scale(new.total)::text || case when new.payment_txn_id is not null then ' · txn ' || new.payment_txn_id else '' end,
      'pay-' || new.order_number);
  end if;
  return new;
end $$;
revoke all on function public.alert_payment_claim() from public, anon, authenticated;
drop trigger if exists orders_alert_payment_claim on public.orders;
create trigger orders_alert_payment_claim after update of payment_claimed_at on public.orders
  for each row execute function public.alert_payment_claim();

-- ============================================================
-- 11. Dish options, plate limits, ratings, auto-cancel, ETA, customers, staff roles
-- ============================================================
-- Options for a dish: a size (exactly one when the dish has sizes) and extras. The price is added to the dish price.
create table if not exists public.recipe_options (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  kind text not null check (kind in ('size', 'extra')),
  name text not null check (length(trim(name)) between 1 and 40),
  price_delta numeric not null default 0 check (price_delta >= 0),
  sort_order int not null default 0
);
create index if not exists recipe_options_recipe_idx on public.recipe_options (recipe_id);
alter table public.recipe_options enable row level security;
drop policy if exists "Staff can manage recipe options" on public.recipe_options;
create policy "Staff can manage recipe options" on public.recipe_options for all to authenticated using (true) with check (true);
drop policy if exists "Customers can view options" on public.recipe_options;
create policy "Customers can view options" on public.recipe_options for select to anon using (
  exists (select 1 from public.recipes r join public.restaurants s on s.id = r.restaurant_id
           where r.id = recipe_options.recipe_id and r.is_published and s.is_open));

-- How many plates are left per dish for a delivery day (only dishes with a daily limit appear).
create or replace function public.get_availability(p_restaurant text, p_date date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(rc.id::text, greatest(rc.daily_limit - coalesce(u.used, 0), 0)), '{}'::jsonb)
  from public.recipes rc
  join public.restaurants rs on rs.id = rc.restaurant_id and rs.slug = p_restaurant
  left join lateral (
    select sum((i->>'quantity')::int) as used
      from public.orders o, jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) i
     where o.restaurant_id = rc.restaurant_id and o.delivery_date = p_date and o.status <> 'Cancelled'
       and jsonb_typeof(i) = 'object' and lower(i->>'name') = lower(rc.name)) u on true
  where rc.is_published and rc.daily_limit is not null
$$;
revoke all on function public.get_availability(text, date) from public;
grant execute on function public.get_availability(text, date) to anon, authenticated;

-- Customers rate a delivered order once (1 to 5 stars, optional comment).
create or replace function public.rate_order(p_order_number text, p_rating int, p_comment text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from public.orders where order_number = upper(trim(coalesce(p_order_number, '')));
  if not found then raise exception 'RATING: We could not find that order'; end if;
  if o.status <> 'Delivered' then raise exception 'RATING: You can rate an order once it is delivered'; end if;
  if o.rating is not null then raise exception 'RATING: This order is already rated'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'RATING: Choose 1 to 5 stars'; end if;
  update public.orders set rating = p_rating, rating_comment = nullif(left(trim(coalesce(p_comment, '')), 300), ''), rated_at = now() where id = o.id;
  return jsonb_build_object('rated', true);
end $$;
revoke all on function public.rate_order(text, int, text) from public;
grant execute on function public.rate_order(text, int, text) to anon, authenticated;

create or replace function public.alert_low_rating()
returns trigger
language plpgsql security definer set search_path = public as $$
declare rname text;
begin
  if new.rating is not null and new.rating <= 2 and new.rating is distinct from old.rating then
    select name into rname from public.restaurants where id = new.restaurant_id;
    perform public.send_alert(new.restaurant_id, 'Low rating · ' || coalesce(rname, 'Kitchen'),
      new.order_number || ' · ' || new.rating || ' star' || case when new.rating = 1 then '' else 's' end || coalesce(' · ' || new.rating_comment, ''), 'rate-' || new.order_number);
  end if;
  return new;
end $$;
revoke all on function public.alert_low_rating() from public, anon, authenticated;
drop trigger if exists orders_alert_low_rating on public.orders;
create trigger orders_alert_low_rating after update of rating on public.orders for each row execute function public.alert_low_rating();

-- Remember when cooking started (used for the "ready around" time).
create or replace function public.stamp_cooking()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'Cooking' and old.status is distinct from 'Cooking' and new.cooking_at is null then new.cooking_at := now(); end if;
  return new;
end $$;
drop trigger if exists orders_stamp_cooking on public.orders;
create trigger orders_stamp_cooking before update on public.orders for each row execute function public.stamp_cooking();

-- Cancel UPI orders that nobody paid for (and nobody claimed to have paid) after the time each restaurant sets.
create or replace function public.cancel_unpaid_upi()
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.orders o
     set status = 'Cancelled', cancel_reason = 'The UPI payment was not received in time'
    from public.restaurants r
   where r.id = o.restaurant_id and r.unpaid_cancel_minutes is not null
     and o.payment_method = 'UPI' and o.payment_status = 'pending' and o.payment_claimed_at is null and o.status = 'New'
     and o.created_at < now() - make_interval(mins => r.unpaid_cancel_minutes);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.cancel_unpaid_upi() from public, anon, authenticated;
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('cancel-unpaid-upi', '*/5 * * * *', 'select public.cancel_unpaid_upi()');
exception when others then
  raise notice 'pg_cron could not be set up here (%). Turn on pg_cron under Database > Extensions, then run this file again to auto-cancel unpaid UPI orders.', sqlerrm;
end $$;

-- Customers (staff only): one row per phone number across both restaurants.
create or replace function public.customer_summary()
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'last_order')::timestamptz desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'phone', o.customer_phone,
      'name', (array_agg(split_part(o.customer_name, ' · ', 1) order by o.created_at desc))[1],
      'orders', count(*), 'spent', coalesce(sum(o.total), 0), 'last_order', max(o.created_at),
      'restaurants', (select jsonb_agg(distinct r.name) from public.restaurants r where r.id = any(array_agg(o.restaurant_id)))) as x
    from public.orders o
    where o.customer_phone is not null and o.status <> 'Cancelled' and o.payment_status <> 'pending'
    group by o.customer_phone) t
$$;
revoke all on function public.customer_summary() from public, anon;
grant execute on function public.customer_summary() to authenticated;

-- Staff roles. Until the first role is saved, every signed-in person is an owner (so nobody gets locked out).
create table if not exists public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'cook', 'delivery')),
  created_at timestamptz not null default now()
);
alter table public.staff_roles enable row level security;   -- no policies: only the functions below read or change it

create or replace function public.my_role()
returns text
language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is null then return null; end if;
  select role into r from public.staff_roles where user_id = auth.uid();
  if r is not null then return r; end if;
  if not exists (select 1 from public.staff_roles) then return 'owner'; end if;
  return 'none';
end $$;
create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = public as $$ select public.my_role() = 'owner' $$;
revoke all on function public.my_role() from public, anon; grant execute on function public.my_role() to authenticated;
revoke all on function public.is_owner() from public, anon; grant execute on function public.is_owner() to authenticated;

create or replace function public.list_staff()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'ROLE: Only the owner can see the team'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'role', s.role) order by s.role, u.email)
                     from public.staff_roles s join auth.users u on u.id = s.user_id), '[]'::jsonb);
end $$;
revoke all on function public.list_staff() from public, anon; grant execute on function public.list_staff() to authenticated;

create or replace function public.set_staff_role(p_email text, p_role text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_owner() then raise exception 'ROLE: Only the owner can change roles'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(coalesce(p_email, '')));
  if uid is null then raise exception 'ROLE: No account with that email. Add the person under Authentication > Users in Supabase first.'; end if;
  if not exists (select 1 from public.staff_roles) then   -- first role ever saved: keep the person doing it as an owner
    insert into public.staff_roles (user_id, role) values (auth.uid(), 'owner') on conflict (user_id) do nothing;
  end if;
  if p_role is null or p_role = 'remove' then
    if exists (select 1 from public.staff_roles where user_id = uid and role = 'owner') and (select count(*) from public.staff_roles where role = 'owner') <= 1 then
      raise exception 'ROLE: There must be at least one owner';
    end if;
    delete from public.staff_roles where user_id = uid;
  elsif p_role in ('owner', 'cook', 'delivery') then
    if uid = auth.uid() and p_role <> 'owner' and (select count(*) from public.staff_roles where role = 'owner') <= 1 then
      raise exception 'ROLE: There must be at least one owner';
    end if;
    insert into public.staff_roles (user_id, role) values (uid, p_role) on conflict (user_id) do update set role = excluded.role;
  else raise exception 'ROLE: Choose owner, cook or delivery'; end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.set_staff_role(text, text) from public, anon; grant execute on function public.set_staff_role(text, text) to authenticated;

-- Settings tables can only be changed by the owner (cooks and delivery staff can still work on orders).
drop policy if exists "Staff can manage restaurants" on public.restaurants;
drop policy if exists "Owner can manage restaurants" on public.restaurants;
create policy "Owner can manage restaurants" on public.restaurants for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "Staff can manage order limits" on public.order_limits;
drop policy if exists "Owner can manage order limits" on public.order_limits;
create policy "Owner can manage order limits" on public.order_limits for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "Staff can manage coupons" on public.coupons;
drop policy if exists "Owner can manage coupons" on public.coupons;
create policy "Owner can manage coupons" on public.coupons for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "Staff can manage restaurant secrets" on public.restaurant_secrets;
drop policy if exists "Owner can manage restaurant secrets" on public.restaurant_secrets;
create policy "Owner can manage restaurant secrets" on public.restaurant_secrets for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "Staff can manage the sales goal" on public.sales_goal;
drop policy if exists "Staff can read the sales goal" on public.sales_goal;
drop policy if exists "Owner can manage the sales goal" on public.sales_goal;
create policy "Staff can read the sales goal" on public.sales_goal for select to authenticated using (true);
create policy "Owner can manage the sales goal" on public.sales_goal for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- The kitchen sets (or changes) the delivery charge of an order, for example by distance. The total follows.
create or replace function public.set_delivery_charge(p_order_number text, p_fee numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; new_total numeric;
begin
  if coalesce(public.my_role(), '') not in ('owner', 'cook', 'delivery') then raise exception 'ROLE: Sign in as staff to set the delivery charge'; end if;
  if p_fee is null or p_fee < 0 or p_fee > 5000 then raise exception 'CHARGE: Enter an amount from 0 to 5000'; end if;
  select * into o from public.orders where order_number = upper(trim(coalesce(p_order_number, '')));
  if not found then raise exception 'CHARGE: Order not found'; end if;
  if o.status in ('Delivered', 'Cancelled') then raise exception 'CHARGE: This order is already %', lower(o.status); end if;
  new_total := o.total - o.delivery_fee + round(p_fee);
  update public.orders set delivery_fee = round(p_fee), total = new_total, delivery_fee_pending = false where id = o.id;
  return jsonb_build_object('delivery_fee', round(p_fee), 'total', new_total);
end $$;
revoke all on function public.set_delivery_charge(text, numeric) from public, anon;
grant execute on function public.set_delivery_charge(text, numeric) to authenticated;

-- ============================================================
-- 12. Indexes for speed (safe to run again; they only help reads)
-- ============================================================
-- Orders: the staff list by status, the Payments page, the unpaid-UPI check, customers, the daily summary
create index if not exists orders_status_idx        on public.orders (restaurant_id, status, created_at desc);
create index if not exists orders_delivery_status_idx on public.orders (restaurant_id, delivery_date, status);
create index if not exists orders_unpaid_upi_idx    on public.orders (created_at) where payment_status = 'pending';
create index if not exists orders_customer_idx      on public.orders (restaurant_id, customer_phone) where customer_phone is not null;
create index if not exists orders_created_idx       on public.orders (created_at desc);
-- Menu and stock: dishes by restaurant and published state, name matching for stock deduction
create index if not exists recipes_published_idx    on public.recipes (restaurant_id, is_published);
create index if not exists recipes_name_idx         on public.recipes (restaurant_id, lower(name));
create index if not exists inventory_name_idx       on public.inventory_items (restaurant_id, lower(name));
create index if not exists recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id);
create index if not exists recipe_ingredients_item_idx   on public.recipe_ingredients (inventory_item_id) where inventory_item_id is not null;
-- Coupons and alerts
create index if not exists coupons_restaurant_idx   on public.coupons (restaurant_id);
create index if not exists push_subs_restaurant_idx on public.push_subscriptions (restaurant_id);
analyze public.orders; analyze public.recipes; analyze public.inventory_items; analyze public.recipe_ingredients;

-- ============================================================
-- 13. Bulk orders (a separate flow from normal orders)
-- ============================================================
create table if not exists public.bulk_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  description text,
  price numeric(10,2) not null check (price >= 0),
  min_qty int check (min_qty is null or min_qty >= 1),
  tiers jsonb not null default '[]'::jsonb,        -- [{"qty": 50, "price": 230}]: a lower price from that quantity
  image_url text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists bulk_items_restaurant_idx on public.bulk_items (restaurant_id, is_active, sort_order);
create index if not exists orders_kind_idx on public.orders (restaurant_id, kind, created_at desc);
alter table public.bulk_items enable row level security;
drop policy if exists "Staff can manage bulk items" on public.bulk_items;
create policy "Staff can manage bulk items" on public.bulk_items for all to authenticated using (true) with check (true);

-- Plates already booked for each upcoming date (not cancelled)
create or replace function public.bulk_plates_on(p_restaurant uuid, p_date date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when jsonb_typeof(i) = 'object' and (i->>'name') not like 'Note:%' then (i->>'quantity')::int else 0 end), 0)::int
    from public.orders o, jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) i
   where o.restaurant_id = p_restaurant and o.kind = 'bulk' and o.status <> 'Cancelled' and o.delivery_date = p_date
$$;
revoke all on function public.bulk_plates_on(uuid, date) from public, anon, authenticated;

create or replace function public.get_bulk_menu(p_restaurant text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rest record; today date; booked jsonb := '{}'::jsonb; d date; n int;
begin
  select * into rest from public.restaurants where slug = p_restaurant;
  if not found then return null; end if;
  today := (now() at time zone coalesce(rest.timezone, 'Asia/Kolkata'))::date;
  if rest.bulk_daily_cap is not null then
    for d in select generate_series(today, today + 90, interval '1 day')::date loop
      n := public.bulk_plates_on(rest.id, d);
      if n > 0 then booked := booked || jsonb_build_object(d::text, n); end if;
    end loop;
  end if;
  return jsonb_build_object(
    'enabled', rest.bulk_enabled, 'note', rest.bulk_note, 'min_qty', rest.bulk_min_qty, 'lead_days', rest.bulk_lead_days,
    'advance_pct', rest.bulk_advance_pct, 'daily_cap', rest.bulk_daily_cap, 'today', today,
    'earliest', today + rest.bulk_lead_days, 'latest', today + 90,
    'slots', (select coalesce(jsonb_agg(trim(x)) filter (where trim(x) <> ''), '[]'::jsonb) from unnest(string_to_array(rest.bulk_slots, ',')) x),
    'booked', booked,
    'items', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', b.id, 'name', b.name, 'diet', b.diet, 'description', b.description, 'price', b.price,
                'min_qty', coalesce(b.min_qty, rest.bulk_min_qty), 'tiers', b.tiers, 'image_url', b.image_url)) order by b.sort_order, b.name), '[]'::jsonb)
                from public.bulk_items b where b.restaurant_id = rest.id and b.is_active));
end $$;
revoke all on function public.get_bulk_menu(text) from public;
grant execute on function public.get_bulk_menu(text) to anon, authenticated;

create or replace function public.place_bulk_order(
  p_restaurant text, p_name text, p_phone text, p_address text, p_payment text, p_notes text, p_items jsonb,
  p_delivery_date date, p_slot text default null, p_guests int default null, p_spice text default null, p_packing text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rest record; it jsonb; bi record; q int; unit numeric; today date;
  v_phone text; v_ip text; v_hash text; n int; v_ch int;
  total numeric := 0; subtotal numeric; v_fee numeric := 0; v_pending boolean := false; v_adv numeric := 0; plates int := 0; booked int;
  lines jsonb := '[]'::jsonb; num text; tries int := 0; meta jsonb; slots text[];
begin
  select * into rest from public.restaurants where slug = p_restaurant;
  if not found then raise exception 'Restaurant not found'; end if;
  if not rest.is_open then
    raise exception 'RESTAURANT_CLOSED: %', coalesce(nullif(trim(rest.closed_message), ''), 'We are closed right now. Please check back soon.');
  end if;
  if not rest.bulk_enabled then raise exception 'BULK_OFF: Bulk orders are not open right now.'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_phone), '') = '' or coalesce(trim(p_address), '') = '' then
    raise exception 'Name, phone and delivery address are required';
  end if;
  if length(p_name) > 80 or length(p_phone) > 20 or length(p_address) > 300 or length(coalesce(p_notes, '')) > 300 then
    raise exception 'Some details are too long';
  end if;
  if p_payment not in ('Cash on delivery', 'UPI') then raise exception 'Invalid payment method'; end if;
  if p_payment = 'UPI' and not coalesce(rest.bulk_upi_enabled, true) then
    raise exception 'UPI_OFF: UPI is not available for bulk orders right now. Please choose cash on delivery.';
  end if;
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_phone) > 10 then v_phone := right(v_phone, 10); end if;
  if length(v_phone) <> 10 or v_phone !~ '^[6-9]' then raise exception 'INVALID_PHONE: Enter a valid 10-digit mobile number'; end if;
  select count(*) into n from public.orders where customer_phone = v_phone and channel = 'Bulk order' and created_at > now() - interval '24 hours';
  if n >= 5 then raise exception 'RATE_LIMIT: Too many bulk orders from this phone number today. Please call the kitchen.'; end if;
  select coalesce(max(per_connection_hour), 20) into v_ch from public.order_limits;
  begin
    v_ip := nullif(trim(split_part(coalesce((nullif(current_setting('request.headers', true), ''))::json ->> 'x-forwarded-for', ''), ',', 1)), '');
  exception when others then v_ip := null; end;
  if v_ip is not null then
    v_hash := md5(v_ip);
    select count(*) into n from public.orders where client_hash = v_hash and created_at > now() - interval '1 hour';
    if v_ch > 0 and n >= v_ch then raise exception 'RATE_LIMIT: Too many orders from this connection. Please try again later, or call the kitchen.'; end if;
  end if;

  today := (now() at time zone coalesce(rest.timezone, 'Asia/Kolkata'))::date;
  if p_delivery_date is null or p_delivery_date < today + rest.bulk_lead_days or p_delivery_date > today + 90 then
    raise exception 'BULK_DATE: Bulk orders need at least % day% notice. Please choose a later date.', rest.bulk_lead_days, case when rest.bulk_lead_days = 1 then '' else 's' end;
  end if;
  slots := array(select trim(x) from unnest(string_to_array(rest.bulk_slots, ',')) x where trim(x) <> '');
  if p_slot is not null and trim(p_slot) <> '' and not (trim(p_slot) = any(slots)) then raise exception 'Please choose one of the delivery times'; end if;
  if p_packing is not null and p_packing not in ('Individual boxes', 'Bulk trays') then raise exception 'Invalid packing choice'; end if;
  if p_spice is not null and p_spice not in ('Mild', 'Medium', 'Hot') then raise exception 'Invalid spice level'; end if;
  if p_guests is not null and (p_guests < 1 or p_guests > 100000) then raise exception 'Invalid guest count'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20 then
    raise exception 'Select at least one item';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    begin q := (it->>'quantity')::int; exception when others then q := 0; end;
    if q < 1 or q > 5000 then raise exception 'Invalid quantity'; end if;
    begin
      select * into bi from public.bulk_items where id = (it->>'item_id')::uuid and restaurant_id = rest.id and is_active;
    exception when others then bi := null; end;
    if bi.id is null then raise exception 'An item is no longer available'; end if;
    if q < coalesce(bi.min_qty, rest.bulk_min_qty) then
      raise exception 'BULK_MIN: The minimum for % is % plates', bi.name, coalesce(bi.min_qty, rest.bulk_min_qty);
    end if;
    unit := coalesce((select t.price from jsonb_to_recordset(bi.tiers) as t(qty int, price numeric) where t.qty <= q order by t.qty desc limit 1), bi.price);
    total := total + unit * q; plates := plates + q;
    lines := lines || jsonb_build_array(jsonb_build_object('name', bi.name, 'quantity', q, 'price', unit));
  end loop;

  perform pg_advisory_xact_lock(hashtext('bulk:' || rest.id::text || p_delivery_date::text));
  if rest.bulk_daily_cap is not null then
    booked := public.bulk_plates_on(rest.id, p_delivery_date);
    if booked + plates > rest.bulk_daily_cap then
      raise exception 'BULK_FULL: % is fully booked (only % plates left that day). Please choose another date or fewer plates.', to_char(p_delivery_date, 'DD Mon'), greatest(rest.bulk_daily_cap - booked, 0);
    end if;
  end if;

  subtotal := total;
  v_pending := rest.charge_mode = 'distance';
  v_fee := case when v_pending then 0 when rest.free_delivery_above is not null and subtotal >= rest.free_delivery_above then 0 else coalesce(rest.delivery_fee, 0) end;
  total := total + v_fee;
  v_adv := case when rest.bulk_advance_pct > 0 then ceil(subtotal * rest.bulk_advance_pct / 100.0) else 0 end;
  meta := jsonb_strip_nulls(jsonb_build_object('slot', nullif(trim(coalesce(p_slot, '')), ''), 'guests', p_guests, 'spice', p_spice, 'packing', p_packing,
            'advance', v_adv, 'advance_pct', rest.bulk_advance_pct, 'advance_received', false));
  if coalesce(trim(p_notes), '') <> '' then
    lines := lines || jsonb_build_array(jsonb_build_object('name', 'Note: ' || trim(p_notes), 'quantity', 1, 'price', 0));
  end if;

  loop
    num := rest.order_prefix || 'B-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
    begin
      insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, client_hash, channel, kind, bulk, status, total, items, delivery_address, delivery_date, payment_method, payment_status, delivery_fee, delivery_fee_pending)
      values (rest.id, num, trim(p_name) || ' · ' || trim(p_phone), v_phone, v_hash, 'Bulk order', 'bulk', meta, 'New', total, lines, trim(p_address), p_delivery_date, p_payment,
              case when p_payment = 'UPI' then 'pending' else 'not_required' end, v_fee, v_pending);
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise exception 'Could not create the order, please try again'; end if;
    end;
  end loop;
  return jsonb_build_object('order_number', num, 'total', total, 'subtotal', subtotal, 'delivery_fee', v_fee, 'delivery_fee_pending', v_pending,
    'delivery_date', p_delivery_date, 'advance', v_adv, 'bulk', meta, 'payment', p_payment, 'items', lines, 'today', today);
end $$;
revoke all on function public.place_bulk_order(text, text, text, text, text, text, jsonb, date, text, int, text, text) from public;
grant execute on function public.place_bulk_order(text, text, text, text, text, text, jsonb, date, text, int, text, text) to anon, authenticated;

-- ============================================================
-- 14. Veg / non-veg
-- ============================================================
alter table public.recipes add column if not exists diet text;
alter table public.bulk_items add column if not exists diet text;
alter table public.recipes drop constraint if exists recipes_diet_check;
alter table public.recipes add constraint recipes_diet_check check (diet is null or diet in ('veg', 'nonveg'));
alter table public.bulk_items drop constraint if exists bulk_items_diet_check;
alter table public.bulk_items add constraint bulk_items_diet_check check (diet is null or diet in ('veg', 'nonveg'));
-- First time only: a guess from the dish name. Staff can change it for any dish.
update public.recipes set diet = case when lower(name) ~ '(chicken|mutton|egg|fish|prawn|keema|lamb|beef|pork|crab|seafood|meat)' then 'nonveg' else 'veg' end where diet is null;
update public.bulk_items set diet = case when lower(name) ~ '(chicken|mutton|egg|fish|prawn|keema|lamb|beef|pork|crab|seafood|meat)' then 'nonveg' else 'veg' end where diet is null;
