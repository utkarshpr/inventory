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
          <span className="oa-new">New order</span>
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
  const init = () => ({ mode: r.delivery_mode || 'daily', weekdays: r.delivery_weekdays || [], anchor: r.delivery_anchor || todayIso, ahead: r.advance_days == null ? 6 : r.advance_days, sameDay: r.allow_same_day !== false, cutoff: (r.order_cutoff || '').slice(0, 5), whatsapp: r.whatsapp_url || '', minOrder: String(r.min_order_value == null ? 0 : r.min_order_value), topic: (secrets && secrets.alert_topic) || '' })
  const [f, setF] = useState(init)
  useEffect(() => { setF(init()) }, [r.id, secrets && secrets.alert_topic])
  const set = (patch) => setF(cur => ({ ...cur, ...patch }))
  const [testMsg, setTestMsg] = useState('')
  const topicOk = !f.topic.trim() || /^[A-Za-z0-9_-]{8,64}$/.test(f.topic.trim())
  const minOk = f.minOrder === '' || Number(f.minOrder) >= 0
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
    if (customEmpty || !waOk || !topicOk || !minOk) return
    onSave({ delivery_mode: f.mode, delivery_weekdays: f.mode === 'custom' ? f.weekdays : [], delivery_anchor: f.mode === 'alternate' ? f.anchor : null, advance_days: Number(f.ahead), allow_same_day: f.sameDay, order_cutoff: f.cutoff || null, whatsapp_url: f.whatsapp.trim() || null, min_order_value: Number(f.minOrder || 0) }, { alert_topic: f.topic.trim() || null })
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

export function AppInstallCard({ notify, restaurant }) {
  const pushOk = Boolean(VAPID_KEY) && typeof window !== 'undefined' && 'PushManager' in window && 'serviceWorker' in navigator && Boolean(supabase)
  const [pushOn, setPushOn] = useState(false), [pushBusy, setPushBusy] = useState(false)
  const rid = restaurant && restaurant.id
  useEffect(() => {   // is this phone already subscribed for the restaurant being managed?
    setPushOn(false)
    if (!pushOk || !rid) return
    let alive = true
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
      if (!sub || !alive) return
      return supabase.from('push_subscriptions').select('endpoint').eq('endpoint', sub.endpoint).eq('restaurant_id', rid).maybeSingle().then(({ data }) => { if (alive) setPushOn(Boolean(data)) })
    }).catch(() => {})
    return () => { alive = false }
  }, [pushOk, rid])
  const turnPushOn = async () => {
    setPushBusy(true)
    try {
      const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      if (p !== 'granted') return notify && notify('Notifications are blocked for this site')
      const reg = await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_KEY) })
      const j = sub.toJSON()
      const { error } = await supabase.from('push_subscriptions').upsert({ endpoint: j.endpoint, restaurant_id: rid, p256dh: j.keys.p256dh, auth: j.keys.auth })
      if (error) return notify && notify(`Could not turn on alerts: ${error.message}`)
      setPushOn(true); notify && notify(`Closed-app alerts on for ${restaurant.name}`)
    } catch (e) { notify && notify(`Could not turn on alerts: ${e.message || 'unknown error'}`) } finally { setPushBusy(false) }
  }
  const turnPushOff = async () => {
    setPushBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription()
      if (sub) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint).eq('restaurant_id', rid)
      setPushOn(false); notify && notify(`Closed-app alerts off for ${restaurant.name}`)
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
      {!pushOk && restaurant && <div className="app-row"><div><b>Alerts when the app is closed</b><small>{!VAPID_KEY ? 'Not set up yet: this version of the app was built without the VITE_VAPID_PUBLIC_KEY setting. Add it in Vercel, then redeploy.' : !supabase ? 'Not available: the app is not connected to Supabase.' : !('serviceWorker' in navigator) || !('PushManager' in window) ? (ios && !installed ? 'On iPhone this only works from the home screen app. Tap Share, then Add to Home Screen, and open the app from there.' : 'This browser does not support closed-app alerts. Try Chrome on Android, or the installed home screen app on iPhone.') : 'Not available right now.'}</small></div></div>}
      {pushOk && restaurant && <div className="app-row"><div><b>Alerts when the app is closed · {restaurant.name}</b><small>{pushOn ? `On for this phone. New ${restaurant.name} orders reach you even when the app is closed. Other restaurants are not mixed in.` : `Off. Turn on to get ${restaurant.name} orders even when the app is closed. Do this on each restaurant you manage.`}</small></div>
        {pushOn ? <button className="text-btn" disabled={pushBusy} onClick={turnPushOff}>Turn off</button> : <button className="primary app-btn" disabled={pushBusy} onClick={turnPushOn}>Turn on</button>}</div>}
      <p className="lset-note">{pushOk ? 'Alerts for a closed app come from the server. The phone alert topic above (ntfy) is a separate backup.' : 'Notifications appear while the app is open or in the background. If the app is fully closed, phone alerts (the topic above, via ntfy) still reach you.'}</p>
    </div>
  </section>
}
