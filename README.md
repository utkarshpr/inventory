# Salt & Saffron and Oven & Chives

One app, two independent restaurants. Each has its own logo, name, colours, menu, recipes, stock, orders, reports and open/closed switch.

## Addresses

| Address | What it is |
|---|---|
| `/` | Customers: choose a restaurant, track an order. Staff: when signed in, the dashboard. |
| `/salt-and-saffron` | Salt & Saffron's own page (terracotta + gold, from its logo) |
| `/oven-and-chives` | Oven & Chives' own page (sage + forest green, from its logo) |
| `/<restaurant>/order` | That restaurant's order page |
| `/admin` | Staff sign-in |

Old `/order` links keep working (they go to Salt & Saffron).

## What is separate per restaurant

Orders, recipes (the menu is the recipes marked *published*), recipe ingredients, inventory, reports and the open/closed switch all belong to exactly one restaurant (`restaurant_id`).
The database enforces it: an order can only contain dishes from its own restaurant, stock only goes down for the restaurant that took the order, and a recipe can only use stock items from its own restaurant.
Shared on purpose: one staff login manages both, and every order reference is unique, so tracking works from anywhere.

## Staff

- Switch restaurant with the selector at the top of the dashboard. The whole dashboard changes colour to match.
- **Open / Closed** is the kill switch for the selected restaurant. When closed, its page shows "Closed", the menu is hidden, and the server refuses orders. The other restaurant is unaffected.
- New customer orders pop up on screen with full details and a sound, **only for the restaurant you have selected**. An order at the other restaurant gives no popup, sound, badge or tab alert here. To be alerted at both, keep one device on each restaurant (the selection is remembered per device).

## Delivery days (per restaurant)

In **Settings** each restaurant sets when it delivers: every day, alternate days (pick the first delivery day), or chosen weekdays. It also sets how far ahead customers can order and an optional same-day cut-off time.
Customers pick one of the allowed days when ordering, and the server re-checks it, so an order for a day the kitchen doesn't deliver is refused.
Orders are listed by delivery date (today first, then upcoming days, then earlier days), grouped under day headings. Every order needs a delivery address and a delivery date.

## WhatsApp group (per restaurant)

Each restaurant has its own group link, shown as "Join our WhatsApp group" on its page, its order confirmation and its closed page. Staff can change it in Settings (only `https://chat.whatsapp.com/...` links are accepted).

## Spam protection

`place_order` (the only way customers can order) refuses: phone numbers that are not a valid 10-digit mobile number, more than 3 orders per hour or 8 per day from one phone number, more than 20 orders per hour from one connection (stored only as a hash). These three numbers are the defaults; change them in Settings → Order limits (0 = no limit), and orders below the restaurant's minimum order (Settings).
Customers see plain messages, never error codes. Staff-made orders are not limited.
Phone verification by SMS code is possible with Supabase phone login, but it needs an SMS provider and India's DLT registration, so it is not switched on.

## Alerts that do not depend on an open dashboard

- The strip under the restaurant selector shows **Live / Offline**, **Sound**, and **Screen stays on**. The screen is kept awake while the dashboard is open, sound must be unlocked with one tap, an unhandled order repeats its sound every 25 seconds, and after being offline or asleep the dashboard refreshes and alerts for orders it missed.
- **Phone alerts** (Settings, per restaurant): a free push notification to the owner's phone for every new customer order, even with the dashboard closed. Install the ntfy app, make a topic, subscribe, press Send test, Save. Turn on the `pg_net` extension in Supabase (Database > Extensions) once. The message holds only the reference, total and delivery date. The topic is stored in a staff-only table.

Before launch, follow [SMOKE-TEST.md](./SMOKE-TEST.md).

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and add your Supabase URL and anon key.
3. In Supabase open **SQL Editor**, paste all of [`supabase/schema.sql`](./supabase/schema.sql) and run it.
   It is safe to run again whenever the file changes. Existing data is assigned to Salt & Saffron.
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
- Orders open read-only. Press **Enable editing** to change one. The delivery address has a **Copy** button (also on each order row).
- Reports show a food-cost based *estimated* profit: sales minus each recipe's food-cost %.

## Adding or changing a restaurant

Name, tagline, order prefix and open/closed live in the `restaurants` table. The logo and colours live in `src/restaurants.jsx` (logos in `src/assets/logos/`).
A third restaurant needs a row in `restaurants` plus a logo and theme entry there.
