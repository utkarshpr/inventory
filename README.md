# Mise en Place

A React dashboard for running a restaurant or cloud kitchen: live orders, recipes, ingredient workflows, pricing and kitchen cues.

## Start it

1. Run `npm install`.
2. Copy `.env.example` to `.env.local`, then add your Supabase URL and anon key.
3. In Supabase, open the SQL Editor and run [`supabase/schema.sql`](./supabase/schema.sql).
4. Run `npm run dev`.

The interface uses sample records until Supabase credentials and data queries are enabled. The schema is ready for orders, recipes, ingredients, and inventory.
