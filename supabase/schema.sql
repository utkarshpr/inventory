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
  ('salt-and-saffron', 'Salt & Saffron', 'Cloud kitchen, Pune', 'SS', 1),
  ('oven-and-chives', 'Oven & Chives', 'Fresh from the oven', 'OC', 2)
on conflict (slug) do nothing;

-- Existing data (and any old app version that does not send a restaurant) goes to Salt & Saffron.
create or replace function public.default_restaurant_id() returns uuid
language sql stable as $$ select id from public.restaurants where slug = 'salt-and-saffron' $$;

alter table public.restaurants      add column if not exists location text;
update public.restaurants set location = 'Pune' where location is null and slug in ('salt-and-saffron', 'oven-and-chives');
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
create or replace function public.place_order(
  p_restaurant text, p_name text, p_phone text, p_address text, p_payment text, p_notes text, p_items jsonb, p_delivery_date date
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rest record; it jsonb; rc record; qty int;
  v_phone text; v_ip text; v_hash text; n int;
  v_ph int; v_pd int; v_ch int;
  total numeric := 0;
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
  if p_payment not in ('Cash on delivery', 'UPI', 'Card on delivery', 'Bank transfer') then
    raise exception 'Invalid payment method';
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
    select id, name, selling_price into rc
      from public.recipes
      where id::text = it->>'recipe_id' and is_published = true and restaurant_id = rest.id;
    if not found then raise exception 'An item is no longer on the menu'; end if;
    total := total + rc.selling_price * qty;
    lines := lines || jsonb_build_array(
      jsonb_build_object('name', rc.name, 'quantity', qty, 'price', rc.selling_price));
  end loop;

  if total < rest.min_order_value then
    raise exception 'MIN_ORDER: The minimum order is ₹%', trim_scale(rest.min_order_value);
  end if;

  if coalesce(trim(p_notes), '') <> '' then
    lines := lines || jsonb_build_array(
      jsonb_build_object('name', 'Note: ' || trim(p_notes), 'quantity', 1, 'price', 0));
  end if;

  loop
    num := rest.order_prefix || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    begin
      insert into public.orders (restaurant_id, order_number, customer_name, customer_phone, client_hash, channel, status, total, items, delivery_address, delivery_date, payment_method)
      values (rest.id, num, trim(p_name) || ' · ' || trim(p_phone), v_phone, v_hash, 'Customer form', 'New', total, lines, trim(p_address), p_delivery_date, p_payment);
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise exception 'Could not create the order, please try again'; end if;
    end;
  end loop;

  return jsonb_build_object('order_number', num, 'total', total, 'restaurant', rest.name, 'items', lines, 'delivery_date', p_delivery_date);
end $$;
revoke all on function public.place_order(text, text, text, text, text, text, jsonb, date) from public;
grant execute on function public.place_order(text, text, text, text, text, text, jsonb, date) to anon, authenticated;

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
      then jsonb_build_object('name', i->>'name', 'quantity', coalesce(i->'quantity', '1'::jsonb))
      else jsonb_build_object('name', i #>> '{}', 'quantity', 1) end), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) i
$$;

create or replace function public.track_order(p_order_number text)
returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'order_number', o.order_number, 'status', o.status, 'total', o.total, 'placed_at', o.created_at,
    'delivery_date', o.delivery_date, 'cancel_reason', o.cancel_reason, 'items', public.public_items(o.items), 'restaurant', r.name, 'restaurant_slug', r.slug)
  from public.orders o join public.restaurants r on r.id = o.restaurant_id
  where o.order_number = upper(trim(p_order_number))
  limit 1;
$$;
-- Orders for one phone number, newest first, a page at a time. Shows date, status, items and quantities only: no names, addresses or prices.
create or replace function public.track_orders_by_phone(p_phone text, p_limit int default 5, p_offset int default 0)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); v_lim int := least(greatest(coalesce(p_limit, 5), 1), 20); v_off int := greatest(coalesce(p_offset, 0), 0); v_total int; v_rows jsonb;
begin
  if length(v_phone) <> 10 or v_phone !~ '^[6-9]' then raise exception 'INVALID_PHONE: Enter a valid 10-digit mobile number'; end if;
  select count(*) into v_total from public.orders where customer_phone = v_phone;
  select coalesce(jsonb_agg(x order by x_at desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('order_number', o.order_number, 'status', o.status, 'total', o.total, 'placed_at', o.created_at,
      'delivery_date', o.delivery_date, 'cancel_reason', o.cancel_reason, 'items', public.public_items(o.items), 'restaurant', r.name, 'restaurant_slug', r.slug) as x, o.created_at as x_at
    from public.orders o join public.restaurants r on r.id = o.restaurant_id
    where o.customer_phone = v_phone order by o.created_at desc limit v_lim offset v_off) s;
  return jsonb_build_object('total', v_total, 'limit', v_lim, 'offset', v_off, 'orders', v_rows);
end $$;
revoke all on function public.track_orders_by_phone(text, int, int) from public;
grant execute on function public.track_orders_by_phone(text, int, int) to anon, authenticated;

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
  if new.channel <> 'Customer form' then return new; end if;
  select s.alert_topic, x.name into r
    from public.restaurants x left join public.restaurant_secrets s on s.restaurant_id = x.id
   where x.id = new.restaurant_id;
  if r.alert_topic is null then return new; end if;
  begin
    perform net.http_post(
      url := 'https://ntfy.sh/',
      body := jsonb_build_object(
        'topic', r.alert_topic,
        'title', r.name || ': new order',
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
  if new.channel <> 'Customer form' then return new; end if;
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
