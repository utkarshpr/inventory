-- Salt&Saffron kitchen schema.
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
-- 2. Row Level Security: staff only, plus the public menu
-- ============================================================
alter table public.orders enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.inventory_items enable row level security;

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
create policy "Customers can view menu" on public.recipes
  for select to anon using (is_published = true);

-- Visitors can NOT read or insert orders directly. They go through place_order() below.

-- ============================================================
-- 3. Customer ordering: server-side validation + total
-- ============================================================
create or replace function public.place_order(
  p_name text, p_phone text, p_address text, p_payment text, p_notes text, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; rc record; qty int;
  total numeric := 0;
  lines jsonb := '[]'::jsonb;
  num text; tries int := 0;
begin
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_phone), '') = '' or coalesce(trim(p_address), '') = '' then
    raise exception 'Name, phone and delivery address are required';
  end if;
  if length(p_name) > 80 or length(p_phone) > 20 or length(p_address) > 300 or length(coalesce(p_notes, '')) > 300 then
    raise exception 'Some details are too long';
  end if;
  if p_payment not in ('Cash on delivery', 'UPI', 'Card on delivery', 'Bank transfer') then
    raise exception 'Invalid payment method';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception 'Select at least one item';
  end if;

  -- The price always comes from the recipes table, never from the browser.
  for it in select * from jsonb_array_elements(p_items) loop
    begin qty := (it->>'quantity')::int; exception when others then qty := 0; end;
    if qty < 1 or qty > 50 then raise exception 'Invalid quantity'; end if;
    select id, name, selling_price into rc
      from public.recipes where id::text = it->>'recipe_id' and is_published = true;
    if not found then raise exception 'An item is no longer on the menu'; end if;
    total := total + rc.selling_price * qty;
    lines := lines || jsonb_build_array(
      jsonb_build_object('name', rc.name, 'quantity', qty, 'price', rc.selling_price));
  end loop;

  if coalesce(trim(p_notes), '') <> '' then
    lines := lines || jsonb_build_array(
      jsonb_build_object('name', 'Note: ' || trim(p_notes), 'quantity', 1, 'price', 0));
  end if;

  loop
    num := 'WEB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    begin
      insert into public.orders (order_number, customer_name, channel, status, total, items, delivery_address, payment_method)
      values (num, trim(p_name) || ' · ' || trim(p_phone), 'Customer form', 'New', total, lines, trim(p_address), p_payment);
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise exception 'Could not create the order, please try again'; end if;
    end;
  end loop;

  return jsonb_build_object('order_number', num, 'total', total);
end $$;

revoke all on function public.place_order(text, text, text, text, text, jsonb) from public;
grant execute on function public.place_order(text, text, text, text, text, jsonb) to anon, authenticated;

-- ============================================================
-- 4. Customer order tracking (status only, needs the reference number)
-- ============================================================
create or replace function public.track_order(p_order_number text)
returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'order_number', order_number, 'status', status, 'total', total, 'placed_at', created_at)
  from public.orders
  where order_number = upper(trim(p_order_number))
  limit 1;
$$;
revoke all on function public.track_order(text) from public;
grant execute on function public.track_order(text) to anon, authenticated;

-- ============================================================
-- 5. Automatic inventory deduction
--    Each ordered dish uses its recipe ingredients (that are linked to a stock item).
--    New order -> stock goes down. Order cancelled -> stock is put back.
-- ============================================================
create or replace function public.apply_inventory_delta(p_items jsonb, p_sign int)
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
        where lower(rc.name) = lower(it->>'name')
          and ri.inventory_item_id is not null and ri.quantity is not null
      loop
        update public.inventory_items
           set current_stock = greatest(current_stock + p_sign * r.quantity * q, 0),
               updated_at = now()
         where id = r.inventory_item_id;
      end loop;
    end loop;
  exception when others then
    -- Never block an order because of an inventory problem.
    raise warning 'inventory update skipped: %', sqlerrm;
  end;
end $$;
revoke all on function public.apply_inventory_delta(jsonb, int) from public, anon, authenticated;

create or replace function public.orders_inventory_trigger()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'Cancelled' then perform public.apply_inventory_delta(new.items, -1); end if;
  elsif tg_op = 'UPDATE' then
    if old.status <> 'Cancelled' and new.status = 'Cancelled' then
      perform public.apply_inventory_delta(old.items, 1);
    elsif old.status = 'Cancelled' and new.status <> 'Cancelled' then
      perform public.apply_inventory_delta(new.items, -1);
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
-- 6. Realtime (instant orders and stock in the kitchen dashboard)
-- ============================================================
do $$
begin
  begin alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.inventory_items;
  exception when duplicate_object then null; end;
end $$;
