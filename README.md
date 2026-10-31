# Salt&Saffron — kitchen operations

A React + Supabase app for a cloud kitchen: live orders, recipes, inventory, reports, and a public ordering page.

- **Home page** (`/`): one address for everyone. Customers see **Order now** and order tracking. Staff click **Staff sign in**; once signed in, `/` opens the dashboard (orders, today's menu, recipes, inventory, reports). `/admin` goes straight to the staff sign-in.
- **Customer page** (`/order`): customers order from the published menu and can track their order by reference number.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and add your Supabase URL and anon key.
3. In Supabase open **SQL Editor**, paste all of [`supabase/schema.sql`](./supabase/schema.sql) and run it.
   It is safe to run again whenever the file changes.
4. **Create your staff login:** Supabase > Authentication > Users > *Add user* (email + password, tick "Auto Confirm").
5. **Turn off public sign-ups:** Supabase > Authentication > Sign In / Providers > disable *Allow new users to sign up*.
   Any signed-in user is treated as staff, so this step matters.
6. `npm run dev`

### Deploying on Vercel

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under Project Settings > Environment Variables, then redeploy.
Vercel will warn that `VITE_` values are public. That is expected: the anon key is designed to be public, and your data is protected by the row-level-security policies in `schema.sql`.

## How security works

- Visitors (not signed in) can only read dishes marked *published* and call two database functions:
  `place_order` (validates input, takes prices from the recipes table, never from the browser) and
  `track_order` (returns only the status for an exact reference number).
- Visitors cannot read, edit or insert orders directly.
- Signed-in staff can manage everything.

## Inventory auto-deduction

Write recipe ingredients as `name | amount | unit`, one per line, for example `Paneer | 0.25 | kg`.
If the name matches an item in Inventory, every order of that dish reduces that stock automatically,
and cancelling an order puts the stock back. Editing an order's items afterwards does not re-adjust stock.

## Staff dashboard tips

- The bell icon toggles the new-order sound (customer orders only). Browsers only allow sound after you have clicked once on the page.
- Each order row has **Print** (kitchen ticket) and **Edit**.
- Reports show a food-cost based *estimated* profit: sales minus each recipe's food-cost %.
