# Smoke test: 10 minutes before you tell customers

Do these on the real site, with your phone for the customer steps.

## 0. Build (on your computer, before pushing)
1. `npm install`
2. `npm run build` must finish with no errors. This is the same build Vercel runs, so you find problems in seconds instead of waiting for a deploy.

## 1. Setup
- Supabase SQL Editor: run all of `supabase/schema.sql`. Table `restaurants` should now have 2 rows.
- Supabase > Authentication: **sign-ups off**, and your staff user exists.
- Vercel: the latest deployment says **Ready**. Open its **Build Logs** and check there are no errors. Environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set.
- Optional, for phone alerts: Supabase > Database > Extensions > turn on **pg_net**.

## 2. A customer order, at each restaurant
1. Open the home page, pick the restaurant. Its own logo, name and colours show.
2. Add two dishes, choose a delivery day, fill in the details, place the order.
3. The centred confirmation shows the reference, total, items, delivery day and the WhatsApp button. **Copy** works.
4. Type the reference into **Track your order**. The status shows.

## 3. The kitchen
1. Sign in at `/admin`. Tap once anywhere so sound is allowed (the strip shows "Sound on").
2. The new order pops up with details and a sound. Press **View order**: it is highlighted in the right restaurant.
3. Open the order: it is read-only. **Copy address** works. **Enable editing**, change something, **Save changes**.
4. Change the status Cooking, then Delivered. Print the ticket.

## 4. The restaurants stay separate
- While on Salt & Saffron, place an order at Oven & Chives from your phone. There must be **no popup or sound** on Salt & Saffron. Switch to Oven & Chives: the order is there.
- Add a recipe and a stock item at Oven & Chives. Check they do **not** appear at Salt & Saffron.
- Recipe ingredient `Flour | 0.2 | kg` with a stock item named Flour: order that dish, stock goes down. Cancel the order, stock comes back.

## 5. Kill switch
Close Oven & Chives with a message. Its customer page shows "Closed", the menu is hidden, and Salt & Saffron still works. Reopen it.

## 6. Delivery days
Settings > set **Alternate days** (or choose weekdays). The customer order page shows only those days. Orders list in delivery-date order.

## 7. Spam limits
- Set a minimum order (Settings). A smaller order shows "Add ₹X more".
- Place 4 orders in an hour from the same phone number. The 4th is refused with a clear message.
- In Settings → Order limits, set "per phone, per hour" to 1, save, and confirm a second order is refused. Set it back to 3.

## 8. Phone alerts (optional)
Settings > Phone alerts > **Make one** > subscribe in the ntfy app > **Send test** > **Save**. Place a customer order: your phone buzzes even with the dashboard closed.

## 9. The kitchen tablet
Leave the dashboard open. The strip shows **Live**, **Sound on**, **Screen stays on**. Lock the screen for a minute, unlock it: it reconnects, and any order that arrived meanwhile pops up.

## 8. Cancel reason, phone tracking, app install
- In Orders, set an order to Cancelled. A box asks for a reason (the Cancel button stays off until you give one). Then track that order on the home page: the reason is shown.
- Record a staff order without a phone number: it is refused. With a 10-digit number it saves.
- On the home page, type a customer phone number in "Track your order". You should see that number's orders, 5 per page, each with date, status, items and quantities. Tap one to see its steps.
- Open the site on your phone, go to Settings, and use "App & notifications": install the app (Android: Install app; iPhone: Share, then Add to Home Screen), then turn notifications on. Put the app in the background, place a test order from another device, and confirm a notification arrives.
- Open "To cook". With a few New orders for the same dish, confirm the dish shows one total (for example 4 × Panner Tikka, in 2 orders). Use the Not started / Cooking / Both and day filters, and "Copy list".
- If you set up closed-app alerts (README): turn them on for one restaurant on your phone, close the app completely, place a test order for that restaurant from another device and confirm the notification arrives. Place one for the other restaurant and confirm nothing arrives.
