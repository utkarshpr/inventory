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

## Cancel reasons, phone tracking, app install
- Cancelling an order asks staff for a reason, which customers see when they track the order.
- Customers can track by reference number or by phone number (5 orders per page, with date, status, items and quantities; no names, addresses or prices).
- Staff-made orders need the customer's 10-digit phone number. Customer-form orders count toward the order limits; staff-made orders do not.
- The site is an installable app (`public/manifest.webmanifest`, `public/sw.js`). Staff can turn on notifications in Settings. They show while the app is open or in the background. A fully closed phone still gets alerts through the ntfy topic. True background push needs a server component (VAPID keys and a Supabase Edge Function) that is not built yet.
- Each restaurant has a `location`, set in Settings → Kitchen profile and shown to customers.
- **To cook** page: pending orders added up by dish for the selected restaurant (filter by not started / cooking and by delivery day, with Copy list).

## Alerts when the app is closed (web push)
This is optional and free. A new customer order reaches staff phones even when the app is closed, for either restaurant. The alert names the restaurant.

1. Make a key pair: `npx web-push generate-vapid-keys`. Keep the private key secret.
2. In Vercel, add `VITE_VAPID_PUBLIC_KEY` (the public key) and redeploy.
3. In Supabase, set the function secrets (Project Settings → Edge Functions, or the CLI):
   `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com PUSH_SHARED_SECRET=<a long random string>`
4. Deploy the function: `supabase functions deploy send-push --no-verify-jwt`
5. Tell the database where it is (SQL editor, same random string as step 3). `pg_net` must be enabled:
   `update public.push_config set function_url = 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-push', shared_secret = '<same random string>';`
6. On each staff phone: open the site, install the app, then Settings → App & notifications → "Alerts when the app is closed" → Turn on.

The ntfy topic in Settings keeps working as a separate backup.
- **Sales goal** (Overview): combined sales of both restaurants against a goal the owner sets, for example "London trip", ₹1L. A bar shows how far you are, with each restaurant's share. Edit the name, target (type 50K, 1L, 1Cr or a number) and start date with "Edit goal". Cancelled orders are not counted.
- **Order alerts reach you for both restaurants, whichever one you have open.** The popup, sound and phone notification all name the restaurant, and "View order" switches to it. The order list, badges and stock still only show the restaurant you are managing.

## More features (all free to run)
- **Sold out today**: on a dish in Recipes, switch "Sold out today". Customers see "Sold out today" and can't add it. It clears itself the next day.
- **Dish photos**: add a photo to a dish in Recipes. It is resized on the phone and stored in the free `dish-photos` storage bucket (created by `schema.sql`).
- **Coupon codes** (Settings → Coupon codes): percent or rupees off, optional cap, minimum order, expiry date and use limit, for both restaurants or one. The server works out the discount.
- **UPI pay button**: each restaurant sets its own UPI ID in its Settings. Customers who choose UPI see a QR code, the UPI ID with a Copy button, and the amount to pay with a Copy amount button. (There is no Pay button: UPI apps reject a pre-filled request to a personal UPI ID.) The QR code is made by `src/qr.js`, so no extra package is needed. No gateway, no fees; you confirm payments yourself.
- **WhatsApp button** on each order: opens WhatsApp to the customer with a ready message for the order's status. You press send.
- **Order again** on the tracking page: refills the cart from a past order at today's prices.
- **Low-stock alerts**: a notification when an ingredient falls to its reorder level. Turn on or off per restaurant in Settings.
- **Daily closing summary** at 10:30 pm IST (orders and sales per restaurant, plus the sales goal), by push and ntfy. Needs the `pg_cron` extension (Database → Extensions), then run `schema.sql` again.
- **Reports**: busiest hours, busiest days of the week and slow sellers.
- **Backup** (Settings): download orders, menu and stock as spreadsheets, or everything as one file.
- The greeting on the dashboard follows the time of day and shows the owner of the restaurant you are managing.

## UPI payment confirmation
- An order paid by UPI starts as **Payment confirmation pending** and cannot be moved to Cooking, Ready or Delivered until staff confirm the payment (the database enforces this). Cancelling is always allowed.
- Staff see "UPI · payment pending" and a **Confirm payment** button on the order. Choosing Cooking first asks "Did you receive the UPI payment?" Confirming saves the time and then moves the order on.
- The customer sees a popup "Payment confirmation pending" (and the first step of their order status says the same). It changes to "Payment confirmed" when staff confirm, then disappears and the normal order screen remains. The Pay button and QR code go away once paid.
- Unconfirmed UPI orders are left out of To cook, sales totals, the sales goal and the daily summary until confirmed.
- The QR holds only `pa`, `pn`, `am`, `cu` and `tn` (the amount and note are left out when "Personal UPI ID" is ticked in Settings). A business (merchant) UPI ID works most reliably.
- Payment choices for customers are **Cash on delivery** and **UPI** only (card on delivery and bank transfer were removed; the database refuses them too).
- **I've paid + transaction ID:** after paying, the customer taps "I've paid" and can add the UPI transaction ID (optional). The admin gets a **Verify payment** popup with a sound (for either restaurant, and as a phone notification) showing the order, amount and transaction ID, with **Accept payment** and **Reject**. Reject asks for a reason; the customer sees it and can pay again or send the right ID. Staff can also open the order and use Verify payment / Confirm payment themselves. A customer can send "I've paid" up to 5 times per order.
