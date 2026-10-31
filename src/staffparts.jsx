import React, { useEffect, useRef, useState } from 'react'
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
export function RestaurantSettings({ r, onSave }) {
  const todayIso = zonedNow(r.timezone || 'Asia/Kolkata').date
  const init = () => ({ mode: r.delivery_mode || 'daily', weekdays: r.delivery_weekdays || [], anchor: r.delivery_anchor || todayIso, ahead: r.advance_days == null ? 6 : r.advance_days, sameDay: r.allow_same_day !== false, cutoff: (r.order_cutoff || '').slice(0, 5), whatsapp: r.whatsapp_url || '' })
  const [f, setF] = useState(init)
  useEffect(() => { setF(init()) }, [r.id])
  const set = (patch) => setF(cur => ({ ...cur, ...patch }))
  const effective = { ...r, delivery_mode: f.mode, delivery_weekdays: f.weekdays, delivery_anchor: f.mode === 'alternate' ? f.anchor : null, advance_days: Number(f.ahead), allow_same_day: f.sameDay, order_cutoff: f.cutoff || null }
  const preview = deliveryDates(effective)
  const waOk = !f.whatsapp.trim() || /^https:\/\/chat\.whatsapp\.com\//.test(f.whatsapp.trim())
  const customEmpty = f.mode === 'custom' && !f.weekdays.length
  const toggleDay = (d) => set({ weekdays: f.weekdays.includes(d) ? f.weekdays.filter(x => x !== d) : [...f.weekdays, d] })
  const aheadOptions = [...new Set([1, 2, 3, 5, 7, 10, 14, 21, 30, Number(f.ahead)])].sort((a, b) => a - b)
  const submit = (e) => {
    e.preventDefault()
    if (customEmpty || !waOk) return
    onSave({ delivery_mode: f.mode, delivery_weekdays: f.mode === 'custom' ? f.weekdays : [], delivery_anchor: f.mode === 'alternate' ? f.anchor : null, advance_days: Number(f.ahead), allow_same_day: f.sameDay, order_cutoff: f.cutoff || null, whatsapp_url: f.whatsapp.trim() || null })
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

      <label className="rset-field rset-wa">WhatsApp group link
        <input type="url" inputMode="url" placeholder="https://chat.whatsapp.com/…" value={f.whatsapp} onChange={e => set({ whatsapp: e.target.value })} />
        <small>Shown as "Join our WhatsApp group" on {r.name}'s pages.</small></label>
      {!waOk && <p className="rset-warn" role="alert">Use a group invite link that starts with https://chat.whatsapp.com/</p>}

      <button className="primary rset-save" disabled={customEmpty || !waOk}>Save for {r.name}</button>
    </div>
  </form>
}
