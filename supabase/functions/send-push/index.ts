// Sends a web-push notification to the phones subscribed to one restaurant.
// Called by the database (trigger push_owner) when a customer order arrives.
// Deploy with:  supabase functions deploy send-push --no-verify-jwt
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  const secret = Deno.env.get('PUSH_SHARED_SECRET')
  if (!secret || req.headers.get('x-push-secret') !== secret) return new Response('forbidden', { status: 403 })

  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!pub || !priv) return new Response('VAPID keys are not set', { status: 500 })
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:owner@example.com', pub, priv)

  let b: { restaurant_id?: string; restaurant?: string; order_number?: string; total?: number; delivery_date?: string; all?: boolean; title?: string; body?: string; tag?: string }
  try { b = await req.json() } catch { return new Response('bad json', { status: 400 }) }
  const custom = typeof b.title === 'string' && b.title.length > 0   // any other alert: low stock, daily summary
  if (!custom && (!b.restaurant_id || !b.order_number)) return new Response('missing fields', { status: 400 })
  if (custom && !b.all && !b.restaurant_id) return new Response('missing fields', { status: 400 })

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let q = sb.from('push_subscriptions').select('endpoint, p256dh, auth')
  if (!b.all) q = q.eq('restaurant_id', b.restaurant_id!)
  const { data: rows, error } = await q
  if (error) return new Response(error.message, { status: 500 })
  const subs = [...new Map((rows ?? []).map((r) => [r.endpoint, r])).values()]   // one notification per phone

  const payload = JSON.stringify(custom
    ? { title: b.title, body: b.body ?? '', tag: b.tag, url: '/' }
    : {
        title: `New order · ${b.restaurant ?? 'Kitchen'}`,
        body: `${b.order_number} · ₹${b.total ?? ''}${b.delivery_date ? ' · delivery ' + b.delivery_date : ''}`,
        tag: b.order_number, url: '/',
      })
  let sent = 0
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' })
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint)   // phone unsubscribed
    }
  }))
  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } })
})
