import React, { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { Mark, themeStyle, deliveryDates, zonedNow, deliveryText, WEEKDAYS } from './restaurants'

/* Pick which restaurant you are managing. Each option shows that restaurant's logo + name. */
export function RestaurantSwitcher({ list, active, onPick }) {
  const [open, setOpen] = useState(false), ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  return <div className="rs" ref={ref}>
    <button type="button" className="rs-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`Managing ${active.name}. Switch restaurant`} onClick={() => setOpen(o => !o)}>
      <Mark r={active} size={36} /><span className="rs-chev" aria-hidden="true">⌄</span>
    </button>
    {open && <ul className="rs-menu" role="listbox" aria-label="Restaurants">{list.map(r => <li key={r.slug}>
      <button type="button" role="option" aria-selected={r.id === active.id} className={r.id === active.id ? 'rs-opt on' : 'rs-opt'} onClick={() => { onPick(r.slug); setOpen(false) }}>
        <Mark r={r} size={34} />
        <span className="rs-end"><span className={r.is_open ? 'rs-state open' : 'rs-state closed'}>{r.is_open ? 'Open' : 'Closed'}</span></span>
      </button>
    </li>)}</ul>}
  </div>
}

/* The kill switch for the restaurant you are managing */
export function OpenToggle({ r, onToggle }) {
  return <button type="button" className={r.is_open ? 'open-toggle open' : 'open-toggle closed'} onClick={onToggle}
    aria-label={r.is_open ? `${r.name} is open. Close it` : `${r.name} is closed. Reopen it`}>
    <i className="ot-dot" aria-hidden="true" />
    <span className="ot-state">{r.is_open ? 'Open' : 'Closed'}</span>
    <span className="ot-action">{r.is_open ? 'Close' : 'Reopen'}</span>
  </button>
}

/* New customer orders for the restaurant you are managing (never the other one), in that restaurant's colours */
export function OrderAlerts({ alerts, restaurants, onDismiss, onView, onClear }) {
  if (!alerts.length) return null
  return <div className="oa-stack" role="region" aria-label="New orders" aria-live="assertive">
    {alerts.slice(0, 3).map(a => {
      const r = restaurants.find(x => x.id === a.restaurantId)
      const o = a.order
      return <article key={a.key} className="oa-card" style={themeStyle(r && r.slug)}>
        <header className="oa-head">
          {r ? <Mark r={r} size={30} /> : <span />}
          <span className="oa-new">New order{r ? ` · ${r.name}` : ''}</span>
          <button type="button" className="oa-x" aria-label="Dismiss" onClick={() => onDismiss(a.key)}>×</button>
        </header>
        <div className="oa-ref"><b>{o.id}</b><span>{o.createdAt ? new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span></div>
        <p className="oa-cust">{o.customer}</p>
        {o.deliveryDate && <p className="oa-deliver">Delivery: {deliveryText(o.deliveryDate, a.today)}</p>}
        <ul className="oa-items">{a.lines.map((l, i) => <li key={i}><span>{l.quantity} × {l.name}</span>{l.price ? <span>₹{l.price * l.quantity}</span> : null}</li>)}</ul>
        {(o.payment || o.address) && <p className="oa-meta">{[o.payment, o.address].filter(Boolean).join(' · ')}</p>}
        <div className="oa-foot"><b className="oa-total">₹{o.total}</b><button type="button" className="oa-view" onClick={() => onView(a)}>View order</button></div>
      </article>
    })}
    {alerts.length > 3 && <button type="button" className="oa-more" onClick={onClear}>{alerts.length - 3} more. Dismiss all</button>}
  </div>
}

/* This restaurant's own delivery days and WhatsApp group. Changes only affect the selected restaurant. */
export function RestaurantSettings({ r, secrets, onSave }) {
  const todayIso = zonedNow(r.timezone || 'Asia/Kolkata').date
  const init = () => ({ mode: r.delivery_mode || 'daily', weekdays: r.delivery_weekdays || [], anchor: r.delivery_anchor || todayIso, ahead: r.advance_days == null ? 6 : r.advance_days, sameDay: r.allow_same_day !== false, cutoff: (r.order_cutoff || '').slice(0, 5), whatsapp: r.whatsapp_url || '', upi: r.upi_id || '', lowStock: r.low_stock_alerts !== false, minOrder: String(r.min_order_value == null ? 0 : r.min_order_value), topic: (secrets && secrets.alert_topic) || '' })
  const [f, setF] = useState(init)
  useEffect(() => { setF(init()) }, [r.id, secrets && secrets.alert_topic])
  const set = (patch) => setF(cur => ({ ...cur, ...patch }))
  const [testMsg, setTestMsg] = useState('')
  const topicOk = !f.topic.trim() || /^[A-Za-z0-9_-]{8,64}$/.test(f.topic.trim())
  const minOk = f.minOrder === '' || Number(f.minOrder) >= 0
  const upiOk = !f.upi.trim() || /^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,32}$/.test(f.upi.trim())
  const makeTopic = () => { const bytes = crypto.getRandomValues(new Uint8Array(10)); set({ topic: `${(r.order_prefix || 'kitchen').toLowerCase()}-${Array.from(bytes, b => (b % 36).toString(36)).join('')}` }); setTestMsg('') }
  const sendTest = async () => {
    setTestMsg('Sending…')
    try {
      const res = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: f.topic.trim(), title: `${r.name}: test alert`, message: 'If you can read this, phone alerts are working.', priority: 4, tags: ['white_check_mark'] }) })
      setTestMsg(res.ok ? 'Test sent. Check your phone.' : 'The alert service did not accept that. Check the topic.')
    } catch { setTestMsg('Could not reach the alert service. Check your internet connection.') }
  }
  const effective = { ...r, delivery_mode: f.mode, delivery_weekdays: f.weekdays, delivery_anchor: f.mode === 'alternate' ? f.anchor : null, advance_days: Number(f.ahead), allow_same_day: f.sameDay, order_cutoff: f.cutoff || null }
  const preview = deliveryDates(effective)
  const waOk = !f.whatsapp.trim() || /^https:\/\/chat\.whatsapp\.com\//.test(f.whatsapp.trim())
  const customEmpty = f.mode === 'custom' && !f.weekdays.length
  const toggleDay = (d) => set({ weekdays: f.weekdays.includes(d) ? f.weekdays.filter(x => x !== d) : [...f.weekdays, d] })
  const aheadOptions = [...new Set([1, 2, 3, 5, 7, 10, 14, 21, 30, Number(f.ahead)])].sort((a, b) => a - b)
  const submit = (e) => {
    e.preventDefault()
    if (customEmpty || !waOk || !topicOk || !minOk || !upiOk) return
    onSave({ delivery_mode: f.mode, delivery_weekdays: f.mode === 'custom' ? f.weekdays : [], delivery_anchor: f.mode === 'alternate' ? f.anchor : null, advance_days: Number(f.ahead), allow_same_day: f.sameDay, order_cutoff: f.cutoff || null, whatsapp_url: f.whatsapp.trim() || null, upi_id: f.upi.trim() || null, low_stock_alerts: f.lowStock, min_order_value: Number(f.minOrder || 0) }, { alert_topic: f.topic.trim() || null })
  }
  return <form className="panel rset" onSubmit={submit}>
    <div className="panel-heading"><div><h3>Delivery days · {r.name}</h3><p>Customers can only pick these days when ordering. This changes {r.name} only.</p></div></div>
    <div className="rset-body">
      <div className="rset-modes" role="radiogroup" aria-label="Delivery schedule">
        {[['daily', 'Every day'], ['alternate', 'Alternate days'], ['custom', 'Choose days']].map(([v, label]) => <label key={v} className={f.mode === v ? 'rset-mode on' : 'rset-mode'}><input type="radio" name="delivery-mode" checked={f.mode === v} onChange={() => set({ mode: v })} />{label}</label>)}
      </div>
      {f.mode === 'alternate' && <label className="rset-field">First delivery day
        <input type="date" required value={f.anchor} onChange={e => set({ anchor: e.target.value })} />
        <small>Delivers on this day, then every 2nd day after it.</small></label>}
      {f.mode === 'custom' && <div className="rset-days" role="group" aria-label="Delivery weekdays">
        {[1, 2, 3, 4, 5, 6, 0].map(d => <button type="button" key={d} aria-pressed={f.weekdays.includes(d)} className={f.weekdays.includes(d) ? 'rset-day on' : 'rset-day'} onClick={() => toggleDay(d)}>{WEEKDAYS[d]}</button>)}
      </div>}
      {customEmpty && <p className="rset-warn" role="alert">Choose at least one delivery day.</p>}

      <div className="rset-row">
        <label className="rset-field">Customers can order
          <select value={f.ahead} onChange={e => set({ ahead: Number(e.target.value) })}>{aheadOptions.map(n => <option key={n} value={n}>up to {n} day{n === 1 ? '' : 's'} ahead</option>)}</select></label>
        <label className="rset-check"><input type="checkbox" checked={f.sameDay} onChange={e => set({ sameDay: e.target.checked })} />Accept same-day orders</label>
        {f.sameDay && <label className="rset-field">Stop same-day orders at
          <input type="time" value={f.cutoff} onChange={e => set({ cutoff: e.target.value })} /><small>Leave empty for no cut-off.</small></label>}
      </div>

      <div className="rset-preview" aria-live="polite"><b>Customers can choose</b>
        {preview.length
          ? <ul>{preview.slice(0, 10).map(d => <li key={d}>{deliveryText(d, todayIso)}</li>)}{preview.length > 10 && <li>+{preview.length - 10} more</li>}</ul>
          : <p>No days. Customers can't order until you add delivery days.</p>}
      </div>

      <label className="rset-field">Minimum order (₹)
        <input type="number" min="0" step="1" inputMode="numeric" value={f.minOrder} onChange={e => set({ minOrder: e.target.value })} />
        <small>Customers can't place an order below this amount. 0 means no minimum.</small></label>
      <label className="rset-check rset-lowstock"><input type="checkbox" aria-label="Low-stock alerts" checked={f.lowStock} onChange={e => set({ lowStock: e.target.checked })} />Alert me when an ingredient runs low <small>A notification once when stock falls to its reorder level. {r.name} only.</small></label>
      <label className="rset-field">UPI ID for {r.name}
        <input value={f.upi} onChange={e => set({ upi: e.target.value })} placeholder="e.g. saltsaffron@okaxis" autoCapitalize="none" autoCorrect="off" spellCheck="false" aria-label="UPI ID" aria-invalid={!upiOk} />
        <small>Customers who choose UPI get a "Pay with UPI" button for this ID. Leave empty to hide it. Each restaurant has its own.</small></label>
      {!upiOk && <p className="rset-warn" role="alert">That doesn't look like a UPI ID. It looks like name@bank.</p>}
      {!minOk && <p className="rset-warn" role="alert">The minimum order can't be negative.</p>}

      <div className="rset-alerts">
        <b>Phone alerts</b>
        <p>Get a notification on your phone for every new customer order at {r.name}, even when the dashboard is closed. Free, using the ntfy app.</p>
        <ol><li>Install the <b>ntfy</b> app (Android or iPhone).</li><li>Make a topic below and subscribe to it in the app.</li><li>Press <b>Send test</b>, then <b>Save</b>.</li></ol>
        <div className="rset-field"><span>Alert topic</span>
          <div className="rset-inline">
            <input aria-label="Alert topic" value={f.topic} onChange={e => set({ topic: e.target.value })} placeholder="Leave empty to switch alerts off" autoCapitalize="none" autoCorrect="off" spellCheck="false" />
            <button type="button" className="rset-mini" onClick={makeTopic}>Make one</button>
            <button type="button" className="rset-mini" disabled={!f.topic.trim() || !topicOk} onClick={sendTest}>Send test</button>
          </div>
          <small>Keep it private: anyone who knows it can read these alerts. They contain only the order reference, total and delivery date.</small></div>
        {testMsg && <p className="rset-note" role="status">{testMsg}</p>}
        {!topicOk && <p className="rset-warn" role="alert">Use 8 to 64 letters, numbers, dashes or underscores.</p>}
      </div>

      <label className="rset-field rset-wa">WhatsApp group link
        <input type="url" inputMode="url" placeholder="https://chat.whatsapp.com/…" value={f.whatsapp} onChange={e => set({ whatsapp: e.target.value })} />
        <small>Shown as "Join our WhatsApp group" on {r.name}'s pages.</small></label>
      {!waOk && <p className="rset-warn" role="alert">Use a group invite link that starts with https://chat.whatsapp.com/</p>}

      <button className="primary rset-save" disabled={customEmpty || !waOk || !topicOk || !minOk}>Save for {r.name}</button>
    </div>
  </form>
}

/* Is the kitchen screen ready to catch orders? Connection, sound and screen-awake at a glance. */
export function LiveStrip({ live, soundOn, soundReady, onSound, onUnlock, awake, awakeSupported, onAwake }) {
  return <div className="live-strip" role="status">
    <span className={live ? 'ls-pill ok' : 'ls-pill bad'}><i aria-hidden="true" />{live ? 'Live' : 'Offline. Reconnecting…'}</span>
    <button type="button" className={soundOn ? 'ls-chip on' : 'ls-chip'} aria-pressed={soundOn} onClick={onSound}>{soundOn ? 'Sound on' : 'Sound off'}</button>
    {soundOn && !soundReady && <button type="button" className="ls-chip warn" onClick={onUnlock}>Tap to enable sound</button>}
    {awakeSupported && <button type="button" className={awake ? 'ls-chip on' : 'ls-chip'} aria-pressed={awake} onClick={onAwake}>{awake ? 'Screen stays on' : 'Screen may sleep'}</button>}
  </div>
}

/* Spam limits that apply to BOTH restaurants (a customer's orders are counted across both). 0 = no limit. */
export function OrderLimitsSettings({ limits, onSave }) {
  const toForm = () => ({ h: String(limits.per_phone_hour), d: String(limits.per_phone_day), c: String(limits.per_connection_hour) })
  const [f, setF] = useState(toForm)
  useEffect(() => { setF(toForm()) }, [limits.per_phone_hour, limits.per_phone_day, limits.per_connection_hour])
  const valid = (v, max) => /^\d+$/.test(f[v.key]) && Number(f[v.key]) <= max
  const fields = [
    { key: 'h', label: 'Orders per phone number, per hour', max: 100, hint: 'Default 3.' },
    { key: 'd', label: 'Orders per phone number, per day', max: 500, hint: 'Default 8.' },
    { key: 'c', label: 'Orders per connection, per hour', max: 500, hint: 'Default 20. Stops one device or network sending many orders with different phone numbers.' },
  ]
  const ok = fields.every(x => valid(x, x.max))
  const submit = (e) => { e.preventDefault(); if (ok) onSave({ per_phone_hour: Number(f.h), per_phone_day: Number(f.d), per_connection_hour: Number(f.c) }) }
  return <form className="panel lset" onSubmit={submit}>
    <div className="panel-heading"><div><h3>Order limits · both restaurants</h3><p>These stop spam orders. A customer's orders are counted across Salt &amp; Saffron and Oven &amp; Chives together, so one setting covers both.</p></div></div>
    <div className="rset-body">
      <div className="rset-row">
        {fields.map(x => <label className="rset-field" key={x.key}>{x.label}
          <input inputMode="numeric" value={f[x.key]} onChange={e => setF(cur => ({ ...cur, [x.key]: e.target.value }))} aria-invalid={!valid(x, x.max)} />
          <small>{x.hint}</small></label>)}
      </div>
      {!ok && <p className="lset-warn" role="alert">Use whole numbers: up to 100 per hour per phone, and up to 500 for the others.</p>}
      <p className="lset-note">0 means no limit. Phone numbers must always be a valid 10-digit mobile number (spaces and +91 are fine). Orders you enter yourself in the dashboard are never limited. Customers only see a plain message when a limit is reached.</p>
      <button className="primary lset-save" disabled={!ok}>Save order limits</button>
    </div>
  </form>
}

/* System notification for a new order. Only shown when the app is in the background, because the
   in-app popup and sound already cover the case where it is open. */
export function systemNotify(order, restaurantName) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return
    const title = `New order · ${restaurantName}`
    const opts = { body: `${order.id} · ₹${order.total} · ${order.customer}`, tag: order.id, renotify: true, requireInteraction: true, vibrate: [200, 100, 200], icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: '/' } }
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then(reg => reg ? reg.showNotification(title, opts) : new Notification(title, opts)).catch(() => {})
    else new Notification(title, opts)
  } catch { /* notifications are optional */ }
}

/* Install the app to the home screen + allow notifications on this device. */
const VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY
const keyBytes = (b64) => { const pad = '='.repeat((4 - b64.length % 4) % 4), raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))) }

export function AppInstallCard({ notify, restaurant, restaurants = [] }) {
  const pushOk = Boolean(VAPID_KEY) && typeof window !== 'undefined' && 'PushManager' in window && 'serviceWorker' in navigator && Boolean(supabase)
  const [pushOn, setPushOn] = useState(false), [pushBusy, setPushBusy] = useState(false)
  const ids = restaurants.map(r => r.id).filter(Boolean), idKey = ids.join(',')
  useEffect(() => {   // is this phone already subscribed for the restaurant being managed?
    setPushOn(false)
    if (!pushOk || !ids.length) return
    let alive = true
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
      if (!sub || !alive) return
      return supabase.from('push_subscriptions').select('endpoint, restaurant_id').eq('endpoint', sub.endpoint).then(({ data }) => { if (alive) setPushOn(ids.every(id => (data || []).some(r => r.restaurant_id === id))) })
    }).catch(() => {})
    return () => { alive = false }
  }, [pushOk, idKey])
  const turnPushOn = async () => {
    setPushBusy(true)
    try {
      const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      if (p !== 'granted') return notify && notify('Notifications are blocked for this site')
      const reg = await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_KEY) })
      const j = sub.toJSON()
      const { error } = await supabase.from('push_subscriptions').upsert(ids.map(id => ({ endpoint: j.endpoint, restaurant_id: id, p256dh: j.keys.p256dh, auth: j.keys.auth })))
      if (error) return notify && notify(`Could not turn on alerts: ${error.message}`)
      setPushOn(true); notify && notify('Closed-app alerts on for both restaurants')
    } catch (e) { notify && notify(`Could not turn on alerts: ${e.message || 'unknown error'}`) } finally { setPushBusy(false) }
  }
  const turnPushOff = async () => {
    setPushBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription()
      if (sub) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      setPushOn(false); notify && notify('Closed-app alerts off')
    } catch { /* ignore */ } finally { setPushBusy(false) }
  }
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState(() => supported ? Notification.permission : 'unsupported')
  const [prompt, setPrompt] = useState(null)
  const standalone = () => { try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true } catch { return false } }
  const [installed, setInstalled] = useState(standalone)
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '')
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e) }
    const onInstalled = () => { setInstalled(true); setPrompt(null) }
    window.addEventListener('beforeinstallprompt', onPrompt); window.addEventListener('appinstalled', onInstalled)
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled) }
  }, [])
  const install = async () => { if (!prompt) return; prompt.prompt(); try { await prompt.userChoice } catch { /* ignore */ } setPrompt(null) }
  const ask = async () => { try { const p = await Notification.requestPermission(); setPerm(p); if (p === 'granted') { const reg = await navigator.serviceWorker?.getRegistration(); const opts = { body: 'You will see new orders here when the app is in the background.', icon: '/icons/icon-192.png', tag: 'test' }; reg ? reg.showNotification('Notifications are on', opts) : new Notification('Notifications are on', opts); notify && notify('Notifications turned on') } } catch { /* ignore */ } }
  return <section className="panel appcard">
    <div className="panel-heading"><div><h3>App &amp; notifications · this device</h3><p>Add the app to your home screen and get a notification when a new order comes in.</p></div></div>
    <div className="rset-body">
      <div className="app-row"><div><b>Home screen app</b><small>{installed ? 'Installed. You are using the app.' : prompt ? 'Opens full screen, like any other app.' : ios ? 'On iPhone: tap the Share button, then "Add to Home Screen".' : 'In Chrome, open the menu and choose "Install app" or "Add to Home screen".'}</small></div>
        {installed ? <span className="stock">Installed</span> : prompt ? <button className="primary app-btn" onClick={install}>Install app</button> : null}</div>
      <div className="app-row"><div><b>New-order notifications</b><small>{perm === 'granted' ? 'On for this device. Shown when the app is in the background.' : perm === 'denied' ? 'Blocked. Allow notifications for this site in your browser settings.' : perm === 'unsupported' ? (ios && !installed ? 'On iPhone, add the app to your home screen first, then turn this on.' : 'This browser does not support notifications.') : 'Off. Turn on to see new orders even when you are in another app.'}</small></div>
        {perm === 'default' && <button className="primary app-btn" onClick={ask}>Turn on</button>}{perm === 'granted' && <span className="stock">On</span>}</div>
      {!pushOk && <div className="app-row"><div><b>Alerts when the app is closed</b><small>{!VAPID_KEY ? 'Not set up yet: this version of the app was built without the VITE_VAPID_PUBLIC_KEY setting. Add it in Vercel, then redeploy.' : !supabase ? 'Not available: the app is not connected to Supabase.' : !('serviceWorker' in navigator) || !('PushManager' in window) ? (ios && !installed ? 'On iPhone this only works from the home screen app. Tap Share, then Add to Home Screen, and open the app from there.' : 'This browser does not support closed-app alerts. Try Chrome on Android, or the installed home screen app on iPhone.') : 'Not available right now.'}</small></div></div>}
      {pushOk && ids.length > 0 && <div className="app-row"><div><b>Alerts when the app is closed · all restaurants</b><small>{pushOn ? 'On for this phone. New orders from any restaurant reach you even when the app is closed. The alert names the restaurant.' : 'Off. Turn on to get new orders from every restaurant, even when the app is closed.'}</small></div>
        {pushOn ? <button className="text-btn" disabled={pushBusy} onClick={turnPushOff}>Turn off</button> : <button className="primary app-btn" disabled={pushBusy} onClick={turnPushOn}>Turn on</button>}</div>}
      <p className="lset-note">{pushOk ? 'Alerts for a closed app come from the server. The phone alert topic above (ntfy) is a separate backup.' : 'Notifications appear while the app is open or in the background. If the app is fully closed, phone alerts (the topic above, via ntfy) still reach you.'}</p>
    </div>
  </section>
}

/* Combined sales of both restaurants against a goal the owner sets (for example "London trip", 1L). */
const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const short = (n) => { const v = Math.abs(Number(n) || 0); const f = (x, u) => (Math.round(x * 10) / 10).toString().replace(/\.0$/, '') + u; return v >= 1e7 ? '₹' + f(v / 1e7, ' Cr') : v >= 1e5 ? '₹' + f(v / 1e5, 'L') : v >= 1e3 ? '₹' + f(v / 1e3, 'K') : '₹' + Math.round(v) }
export const parseMoney = (text) => {   // "100000", "1,00,000", "50k", "1L", "1.5 lakh", "2cr"
  const m = String(text || '').trim().toLowerCase().replace(/[₹,\s]/g, '').match(/^(\d+(?:\.\d+)?)(k|l|lac|lakh|lakhs|cr|crore)?$/)
  if (!m) return NaN
  const mult = { k: 1e3, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crore: 1e7 }[m[2]] || 1
  return Math.round(Number(m[1]) * mult)
}
const GOAL_COLORS = { 'salt-and-saffron': '#B84E24', 'oven-and-chives': '#4F7A57' }
const GOAL_FALLBACK = ['#B84E24', '#4F7A57', '#C9922F', '#5B6EAE']

export function GoalCard({ goal, onSave }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(''), [target, setTarget] = useState(''), [start, setStart] = useState('')
  const open = () => { setName(goal.name); setTarget(String(goal.target)); setStart(goal.start_date); setEditing(true) }
  const targetNum = parseMoney(target), valid = name.trim().length > 0 && targetNum > 0 && /^\d{4}-\d{2}-\d{2}$/.test(start)
  const total = Number(goal.total) || 0, tgt = Number(goal.target) || 1
  const pct = Math.min(100, Math.floor((total / tgt) * 100)), done = total >= tgt
  const parts = (goal.by_restaurant || []).map((r, i) => ({ ...r, sales: Number(r.sales) || 0, color: GOAL_COLORS[r.slug] || GOAL_FALLBACK[i % GOAL_FALLBACK.length] }))
  const save = (e) => { e.preventDefault(); if (!valid) return; onSave({ name: name.trim(), target: targetNum, start_date: start }); setEditing(false) }
  return <section className="panel goalcard" aria-label="Sales goal">
    <div className="goal-head">
      <div><span className="hero-kicker goal-kicker">SALES GOAL</span><h3 className="goal-name">{goal.name}</h3></div>
      <button className="text-btn" onClick={open}>Edit goal</button>
    </div>
    <div className="goal-line"><b className="goal-pct">{pct}%</b><span>{done ? 'You got it! 🎉' : `${short(total)} of ${short(tgt)}`}</span></div>
    <div className="goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${goal.name}: ${pct}% of the goal`}>
      {parts.map(p => <span key={p.restaurant_id} className="goal-seg" style={{ width: `${Math.min(100, (p.sales / tgt) * 100)}%`, background: p.color }} title={`${p.name} ${inr(p.sales)}`} />)}
    </div>
    <div className="goal-parts">{parts.map(p => <span key={p.restaurant_id}><i style={{ background: p.color }} />{p.name} <b>{short(p.sales)}</b></span>)}</div>
    <p className="goal-note">{done ? `Goal reached with ${inr(total)}.` : `${inr(tgt - total)} to go.`} Sales since {new Date(goal.start_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, both restaurants together, cancelled orders left out.</p>
    {editing && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit goal" onClick={e => e.target === e.currentTarget && setEditing(false)}>
      <form className="modal goal-form" onSubmit={save}>
        <h3>Sales goal</h3>
        <label>What are you saving for?<input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="e.g. London trip" aria-label="Goal name" /></label>
        <label>Target amount<input value={target} onChange={e => setTarget(e.target.value)} inputMode="text" placeholder="e.g. 1L or 100000" aria-label="Goal target" aria-invalid={!(targetNum > 0)} /><small>{targetNum > 0 ? inr(targetNum) : 'Type a number. You can use K, L (lakh) or Cr, like 50K or 1L.'}</small></label>
        <label>Count sales from<input type="date" value={start} onChange={e => setStart(e.target.value)} aria-label="Goal start date" /></label>
        <div className="cancel-actions"><button type="button" className="text-btn" onClick={() => setEditing(false)}>Cancel</button><button className="primary app-btn" disabled={!valid}>Save goal</button></div>
      </form>
    </div>}
  </section>
}

/* ---------- Coupon codes (both restaurants, or one) ---------- */
const couponText = (c, restaurants) => {
  const where = c.restaurant_id ? ((restaurants.find(r => r.id === c.restaurant_id) || {}).name || 'One restaurant') : 'Both restaurants'
  const off = c.kind === 'percent' ? `${Number(c.value)}% off${c.max_discount ? ` (max ₹${Number(c.max_discount)})` : ''}` : `₹${Number(c.value)} off`
  return [off, Number(c.min_order) > 0 ? `min order ₹${Number(c.min_order)}` : '', where, c.expires_on ? `expires ${new Date(c.expires_on + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : '', `used ${c.used}${c.max_uses ? ` of ${c.max_uses}` : ''}`].filter(Boolean).join(' · ')
}
export function CouponsSettings({ restaurants, notify }) {
  const [list, setList] = useState(null)
  const blank = { code: '', where: '', kind: 'percent', value: '', max: '', min: '', expires: '', uses: '' }
  const [f, setF] = useState(blank), [err, setErr] = useState('')
  const set = (patch) => setF(cur => ({ ...cur, ...patch }))
  useEffect(() => { if (!supabase) return setList([]); let alive = true; supabase.from('coupons').select('*').order('created_at', { ascending: false }).then(({ data }) => { if (alive) setList(data || []) }); return () => { alive = false } }, [])
  const num = (v) => v === '' ? null : Number(v)
  const add = async (e) => {
    e.preventDefault(); setErr('')
    const code = f.code.trim().toUpperCase(), value = Number(f.value)
    if (!/^[A-Z0-9]{3,20}$/.test(code)) return setErr('The code needs 3 to 20 letters or numbers, no spaces.')
    if (!(value > 0) || (f.kind === 'percent' && value > 100)) return setErr(f.kind === 'percent' ? 'A percentage must be between 1 and 100.' : 'Enter the rupees off.')
    for (const [v, label] of [[f.max, 'maximum discount'], [f.min, 'minimum order'], [f.uses, 'number of uses']]) if (v !== '' && !(Number(v) >= 0)) return setErr(`Check the ${label}.`)
    if (list && list.some(c => c.code === code)) return setErr('That code already exists.')
    const row = { code, restaurant_id: f.where || null, kind: f.kind, value, max_discount: f.kind === 'percent' && f.max !== '' && Number(f.max) > 0 ? Number(f.max) : null, min_order: num(f.min) || 0, expires_on: f.expires || null, max_uses: f.uses !== '' && Number(f.uses) > 0 ? Number(f.uses) : null }
    if (supabase) { const { data, error } = await supabase.from('coupons').insert(row).select().single(); if (error) return setErr(error.message); setList(l => [data, ...(l || [])]) } else setList(l => [{ id: String(Date.now()), used: 0, is_active: true, ...row }, ...(l || [])])
    setF(blank); notify && notify(`Coupon ${code} added`)
  }
  const toggle = async (c) => { if (supabase) { const { error } = await supabase.from('coupons').update({ is_active: !c.is_active }).eq('id', c.id); if (error) return notify && notify(error.message) } setList(l => l.map(x => x.id === c.id ? { ...x, is_active: !c.is_active } : x)) }
  const remove = async (c) => { if (supabase) { const { error } = await supabase.from('coupons').delete().eq('id', c.id); if (error) return notify && notify(error.message) } setList(l => l.filter(x => x.id !== c.id)); notify && notify(`Coupon ${c.code} deleted`) }
  return <section className="panel couponcard" aria-label="Coupon codes">
    <div className="panel-heading"><div><h3>Coupon codes</h3><p>Customers type a code at checkout. The discount is worked out on the server, so it can't be changed in the browser.</p></div></div>
    <form className="rset-body" onSubmit={add}>
      <div className="rset-row">
        <label className="rset-field">Code<input aria-label="Coupon code name" value={f.code} onChange={e => set({ code: e.target.value.toUpperCase() })} placeholder="WELCOME50" maxLength={20} autoCapitalize="characters" /></label>
        <label className="rset-field">Works at<select aria-label="Coupon applies to" value={f.where} onChange={e => set({ where: e.target.value })}><option value="">Both restaurants</option>{restaurants.map(r => <option key={r.id} value={r.id}>{r.name} only</option>)}</select></label>
      </div>
      <div className="rset-row">
        <label className="rset-field">Type<select aria-label="Coupon type" value={f.kind} onChange={e => set({ kind: e.target.value })}><option value="percent">Percent off</option><option value="flat">Rupees off</option></select></label>
        <label className="rset-field">{f.kind === 'percent' ? 'Percent' : 'Rupees'}<input aria-label="Coupon value" inputMode="decimal" value={f.value} onChange={e => set({ value: e.target.value })} placeholder={f.kind === 'percent' ? '10' : '50'} /></label>
        {f.kind === 'percent' && <label className="rset-field">Max discount (₹)<input aria-label="Coupon max discount" inputMode="numeric" value={f.max} onChange={e => set({ max: e.target.value })} placeholder="optional" /></label>}
      </div>
      <div className="rset-row">
        <label className="rset-field">Minimum order (₹)<input aria-label="Coupon minimum order" inputMode="numeric" value={f.min} onChange={e => set({ min: e.target.value })} placeholder="0" /></label>
        <label className="rset-field">Expires on<input type="date" aria-label="Coupon expiry" value={f.expires} onChange={e => set({ expires: e.target.value })} /></label>
        <label className="rset-field">Total uses<input aria-label="Coupon total uses" inputMode="numeric" value={f.uses} onChange={e => set({ uses: e.target.value })} placeholder="no limit" /></label>
      </div>
      {err && <p className="lset-warn" role="alert">{err}</p>}
      <button className="primary app-btn">Add coupon</button>
    </form>
    <ul className="coupon-list">{(list || []).map(c => <li key={c.id} className={c.is_active ? 'coupon-row' : 'coupon-row off'}>
      <div><b>{c.code}</b><small>{couponText(c, restaurants)}</small></div>
      <div className="coupon-act"><button type="button" role="switch" aria-checked={c.is_active} aria-label={`${c.code} active`} className={c.is_active ? 'switch on ok' : 'switch'} onClick={() => toggle(c)}><i /></button><button type="button" className="text-btn" onClick={() => remove(c)}>Delete</button></div>
    </li>)}{list && !list.length && <li className="coupon-empty">No coupons yet.</li>}</ul>
  </section>
}

/* ---------- Backup: download your data ---------- */
const csvCell = (v) => { const t = v == null ? '' : String(v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
const toCsv = (rows) => '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')
const download = (name, text, type) => { const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
const itemsText = (items) => (Array.isArray(items) ? items : []).map(i => typeof i === 'string' ? i : `${i.quantity} × ${i.name}`).join('; ')
export function BackupCard({ restaurants, notify }) {
  const [busy, setBusy] = useState('')
  const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const nameOf = (id) => (restaurants.find(r => r.id === id) || {}).name || ''
  const get = async (table, select = '*') => { const { data, error } = await supabase.from(table).select(select); if (error) throw new Error(`${table}: ${error.message}`); return data || [] }
  const run = async (kind) => {
    if (!supabase) return notify && notify('Backups need Supabase')
    setBusy(kind)
    try {
      if (kind === 'orders') {
        const o = (await get('orders')).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        download(`orders-${stamp}.csv`, toCsv([['Restaurant', 'Order number', 'Placed at (IST)', 'Delivery date', 'Status', 'Customer', 'Phone', 'Address', 'Payment', 'Items', 'Coupon', 'Discount', 'Total', 'Cancel reason'],
          ...o.map(x => [nameOf(x.restaurant_id), x.order_number, new Date(x.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), x.delivery_date, x.status, x.customer_name, x.customer_phone, x.delivery_address, x.payment_method, itemsText(x.items), x.coupon_code, x.discount, x.total, x.cancel_reason])]), 'text/csv')
      } else if (kind === 'menu') {
        const r = await get('recipes', '*, recipe_ingredients(*)')
        download(`menu-recipes-${stamp}.csv`, toCsv([['Restaurant', 'Dish', 'Category', 'Price', 'Food cost %', 'Prep minutes', 'On menu', 'Ingredients', 'Method'],
          ...r.map(x => [nameOf(x.restaurant_id), x.name, x.category, x.selling_price, x.food_cost, x.prep_minutes, x.is_published ? 'yes' : 'no', (x.recipe_ingredients || []).map(i => `${i.quantity ?? ''} ${i.unit ?? ''} ${i.ingredient_name ?? ''}`.trim()).join('; '), String(x.instructions || '').replace(/\n/g, ' | ')])]), 'text/csv')
      } else if (kind === 'stock') {
        const s = await get('inventory_items')
        download(`stock-${stamp}.csv`, toCsv([['Restaurant', 'Item', 'In stock', 'Unit', 'Reorder level', 'Unit cost'], ...s.map(x => [nameOf(x.restaurant_id), x.name, x.current_stock, x.unit, x.reorder_level, x.unit_cost])]), 'text/csv')
      } else {
        const [orders, recipes, stock, goal, coupons] = await Promise.all([get('orders'), get('recipes', '*, recipe_ingredients(*)'), get('inventory_items'), get('sales_goal'), get('coupons')])
        download(`kitchen-backup-${stamp}.json`, JSON.stringify({ exported_at: new Date().toISOString(), restaurants, orders, recipes, inventory_items: stock, sales_goal: goal, coupons }, null, 2), 'application/json')
      }
      notify && notify('Download started')
    } catch (e) { notify && notify(`Could not download: ${e.message}`) } finally { setBusy('') }
  }
  const btn = (kind, label) => <button type="button" className="text-btn backup-btn" disabled={Boolean(busy)} onClick={() => run(kind)}>{busy === kind ? 'Preparing…' : label}</button>
  return <section className="panel backupcard" aria-label="Backup">
    <div className="panel-heading"><div><h3>Backup · download your data</h3><p>Both restaurants together. Spreadsheets open in Excel or Google Sheets. The full backup keeps everything in one file.</p></div></div>
    <div className="rset-body backup-row">{btn('orders', 'Orders (spreadsheet)')}{btn('menu', 'Menu & recipes (spreadsheet)')}{btn('stock', 'Stock (spreadsheet)')}{btn('full', 'Full backup (file)')}</div>
  </section>
}
