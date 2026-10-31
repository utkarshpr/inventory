-- Run this in the Supabase SQL editor. Add authentication policies before production use.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_name text,
  channel text not null default 'Direct',
  status text not null default 'New',
  total numeric(10,2) not null default 0,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  selling_price numeric(10,2) not null default 0,
  food_cost numeric(10,2) not null default 0,
  prep_minutes integer,
  instructions text,
  created_at timestamptz not null default now()
);

-- If you created the recipes table before adding food cost, run this once:
alter table public.recipes add column if not exists food_cost numeric(10,2) not null default 0;

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
