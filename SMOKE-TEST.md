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
- If you set up closed-app alerts (README): turn them on on your phone, close the app completely, place a test order at each restaurant from another device and confirm a notification arrives for both, naming the right restaurant.
- Overview: the Sales goal card shows both restaurants together. Use Edit goal to set a name and target (for example 1L), and confirm the percentage and amount look right.
- With Salt & Saffron open on the dashboard, place an order at Oven & Chives from another device: a popup (named Oven & Chives) and the sound should appear. "View order" should switch you to Oven & Chives.

## 9. More features
- Recipes: switch "Sold out today" on a dish, open the customer order page and confirm it says "Sold out today" and can't be added. Switch it off again.
- Recipes: add a photo to a dish and confirm it shows on the customer menu.
- Settings: add a coupon (for example WELCOME10, 10%). On the order page apply it and confirm the total drops; place the order and confirm the discount is on it. Then delete the test coupon.
- Settings: set a UPI ID for one restaurant. Place a UPI order there and confirm "Pay with UPI" opens your UPI app with the right amount. Confirm the other restaurant (with no UPI ID) shows no button.
- Orders: tap WhatsApp on an order and confirm WhatsApp opens to that customer with a message.
- Tracking: look up a phone number with past orders and tap "Order again".
- Settings → Backup: download the orders spreadsheet and open it.
- Low stock: lower an ingredient below its reorder level and confirm a notification arrives. Turn the setting off and confirm it stops.
- After running the schema with pg_cron on, at 10:30 pm IST confirm the daily summary arrives.

## 10. UPI payment confirmation
- Place a UPI order from a phone. It should show "Payment confirmation pending" with the QR code, the UPI ID (Copy) and the amount (Copy amount).
- On the dashboard the new-order popup says to confirm the payment. In Orders the order shows "UPI · payment pending". Try to set it to Cooking: it asks if you received the payment.
- Tap Confirm payment. On the customer's phone the popup should change to "Payment confirmed" and then disappear, and the QR code and UPI ID go away.
- Pay a small amount by scanning the QR code from another phone (or screenshot it and scan from the gallery), and by copying the UPI ID. Confirm the payment arrives and that you can match it with the order number.
