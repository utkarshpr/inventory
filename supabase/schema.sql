-- Run this in the Supabase SQL editor. Add authentication policies before production use.
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

-- Required for instant order updates in the kitchen dashboard.
alter publication supabase_realtime add table public.orders;

-- Customer order-form access. Use this only before adding staff authentication;
-- replace the broad read policy with an authenticated staff-only policy in production.
alter table public.orders enable row level security;
create policy "Customers can place orders" on public.orders for insert to anon with check (channel = 'Customer form' and status = 'New');
drop policy if exists "Kitchen can read orders" on public.orders;
create policy "Staff can manage orders" on public.orders for all to authenticated using (true) with check (true);

-- Public visitors can read menu choices, while only signed-in staff can manage recipes and inventory.
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.inventory_items enable row level security;
create policy "Customers can view menu" on public.recipes for select to anon using (true);
create policy "Staff can manage recipes" on public.recipes for all to authenticated using (true) with check (true);
create policy "Staff can manage recipe ingredients" on public.recipe_ingredients for all to authenticated using (true) with check (true);
create policy "Staff can manage inventory" on public.inventory_items for all to authenticated using (true) with check (true);

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

-- If you created the recipes table before adding food cost, run this once:
alter table public.recipes add column if not exists food_cost numeric(10,2) not null default 0;
alter table public.recipes add column if not exists is_published boolean not null default false;

-- Useful live-data queries (the React app uses equivalent Supabase queries):
-- select * from public.orders order by created_at desc;
-- select r.*, ri.* from public.recipes r left join public.recipe_ingredients ri on ri.recipe_id = r.id order by r.created_at desc;
-- select * from public.inventory_items order by name;

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  ingredient_name text not null,
  quantity numeric(10,2),
  unit text,
  unit_cost numeric(10,2) default 0
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  current_stock numeric(10,2) not null default 0,
  unit text,
  reorder_level numeric(10,2) default 0,
  unit_cost numeric(10,2) default 0,
  updated_at timestamptz not null default now()
);
