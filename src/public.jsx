import React, { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useRestaurants, themeStyle, logoFor, Mark, wordmarkLines, closedText, dayParts, deliveryText, scheduleLabel, usePageBrand, zonedNow } from './restaurants'
import './public.css'

const PAYMENTS = ['Cash on delivery', 'UPI', 'Card on delivery', 'Bank transfer']
const STEPS = [['New', 'Received'], ['Cooking', 'Cooking'], ['Ready', 'Ready'], ['Delivered', 'Delivered']]

const icons = {
  back: <path d="M15 5l-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
}
const PinIcon = () => <svg className="c-pin" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>

function Ico({ n, size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[n]}</svg>
}

// last order reference: one per restaurant (so a restaurant page only ever shows its own order) plus one overall for the home page
const readSaved = (slug) => { try { return localStorage.getItem(slug ? `last-order-ref:${slug}` : 'last-order-ref') || '' } catch { return '' } }
const itemText = (items) => (items || []).map(i => /^\d+\s*×/.test(i.name || '') ? i.name : `${i.quantity}× ${i.name}`).join(', ')
const placedText = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : ''
const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text) } catch {
    const box = document.createElement('textarea'); box.value = text; document.body.appendChild(box); box.select()
    try { document.execCommand('copy') } catch { /* ignore */ }
    box.remove()
  }
}

/* ---------- routing for everything customers can see ---------- */
export function PublicRouter({ path, onStaff }) {
  const { list } = useRestaurants()
  let parts = path.split('/').filter(Boolean)
  if (path === '/order') { window.history.replaceState(null, '', '/salt-and-saffron/order'); parts = ['salt-and-saffron', 'order'] }  // old links keep working
  if (list === null) return <div className="c-app c-loading" style={themeStyle(null)}>Loading…</div>
  if (!parts.length) return <Home list={list} onStaff={onStaff} />
  if (!list.some(x => x.slug === parts[0])) return <Home list={list} onStaff={onStaff} missing={parts[0]} />
  const r = list.find(x => x.slug === parts[0])
  return parts[1] === 'order' ? <OrderPage r={r} list={list} /> : <RestaurantLanding r={r} list={list} onStaff={onStaff} />
}

/* Switch between restaurants: each pill shows that restaurant's own logo and name. */
function SwitchPills({ list, current }) {
  return <nav className="c-pills" aria-label="Restaurants">{list.map(x => <a key={x.slug} href={`/${x.slug}`} className={x.slug === current ? 'c-pill-link on' : 'c-pill-link'} aria-current={x.slug === current ? 'page' : undefined}>
    <Mark r={x} size={32} />
  </a>)}</nav>
}

function WhatsAppLink({ r, className }) {
  if (!r.whatsapp_url || !r.whatsapp_url.startsWith('https://')) return null
  return <a className={className} href={r.whatsapp_url} target="_blank" rel="noopener noreferrer">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.7-5.4A8.4 8.4 0 1 1 21 11.5Z" /></svg>
    Join our WhatsApp group
  </a>
}

function StaffLink({ onStaff }) {
  return <button type="button" className="c-staff staff-link" onClick={onStaff}>Staff sign in</button>
}

/* ---------- Home: choose a restaurant ---------- */
function Home({ list, onStaff, missing }) {
  usePageBrand(null)
  const [savedRef] = useState(() => readSaved())
  return <div className="c-app c-home" style={themeStyle(null)}>
    <div className="c-home-in">
      <h1 className="c-h1">Choose a restaurant</h1>
      <p className="c-sub c-lead">{missing ? `We couldn't find "${missing}". Pick one of these.` : 'Two kitchens, each with its own menu.'}</p>
      <div className="c-tiles">{list.map(r => <a key={r.slug} className="c-tile" style={themeStyle(r.slug)} href={`/${r.slug}`}>
        <img className="c-tile-logo c-logo" src={logoFor(r.slug)} alt={`${r.name} logo`} />
        <span className="c-tile-name">{r.name}</span>
        {r.tagline && <span className="c-tile-tag">{r.tagline}</span>}
        {r.location && <span className="c-loc"><PinIcon />{r.location}</span>}
        <span className={r.is_open ? 'c-status open' : 'c-status closed'}>{r.is_open ? 'Open now' : 'Closed'}</span>
      </a>)}</div>
      <section className="c-track-wrap"><TrackOrder initialRef={savedRef} /></section>
      <StaffLink onStaff={onStaff} />
    </div>
  </div>
}

/* ---------- One restaurant's own page ---------- */
function RestaurantLanding({ r, list, onStaff }) {
  usePageBrand(r)
  const [savedRef] = useState(() => readSaved(r.slug))
  const lines = wordmarkLines(r.name)
  return <div className="c-app c-landing" style={themeStyle(r.slug)}>
    <section className="c-hero">
      <SwitchPills list={list} current={r.slug} />
      <div className="c-hero-brand">
        <img className="c-logo c-logo-lg" src={logoFor(r.slug)} alt={`${r.name} logo`} width="112" height="112" />
        <h1 className="c-wordmark">{lines.map((l, i) => <React.Fragment key={i}>{i > 0 && <br />}{l}</React.Fragment>)}</h1>
        {r.tagline && <p className="c-tagline">{r.tagline}</p>}
        {r.location && <p className="c-loc c-loc-hero"><PinIcon />{r.location}</p>}
        <p className="c-sched">Delivers {scheduleLabel(r)}</p>
      </div>
      <div className="c-hero-foot">
        {r.is_open
          ? <a className="c-cta c-cta-hero landing-order" href={`/${r.slug}/order`}>Order now</a>
          : <div className="c-closed-box" role="status"><b>Closed right now</b><span>{closedText(r)}</span></div>}
        <WhatsAppLink r={r} className="c-wa c-wa-hero" />
      </div>
    </section>
    <section className="c-track-wrap"><TrackOrder slug={r.slug} initialRef={savedRef} /></section>
    <StaffLink onStaff={onStaff} />
  </div>
}

/* ---------- Order tracking (works with any reference number) ---------- */
export function TrackOrder({ initialRef, compact, slug }) {
  const [code, setCode] = useState(() => readSaved(slug)), [result, setResult] = useState(null), [msg, setMsg] = useState(''), [active, setActive] = useState(''), [list, setList] = useState(null)
  const PAGE = 5
  const phoneOf = (v) => { const t = (v || '').trim(); return /^[+\d\s-]+$/.test(t) && t.replace(/\D/g, '').length >= 10 ? t : '' }
  const loadPhone = async (phone, page) => {
    if (!supabase) return setMsg('Tracking is not available right now.')
    setMsg('Checking…')
    const { data, error } = await supabase.rpc('track_orders_by_phone', { p_phone: phone, p_limit: PAGE, p_offset: page * PAGE })
    if (error) return setMsg((error.message || '').replace(/^INVALID_PHONE:\s*/, '') || 'Could not check this number.')
    setResult(null); setActive('')
    if (!data || !data.total) { setList(null); return setMsg('No orders found for that phone number.') }
    setList({ phone, page, total: data.total, orders: data.orders }); setMsg('')
  }
  const lookup = async (value, quiet) => {
    const ref = (value || '').trim().toUpperCase()
    if (!ref) return
    if (!quiet && phoneOf(value)) return loadPhone(phoneOf(value), 0)
    if (!quiet) setList(null)
    if (!supabase) return setMsg('Tracking is not available right now.')
    if (!quiet) setMsg('Checking…')
    const { data, error } = await supabase.rpc('track_order', { p_order_number: ref })
    if (error) return setMsg(`Could not check this order: ${error.message}`)
    if (!data) { setResult(null); setActive(''); return setMsg('No order found for that reference number. Check it and try again.') }
    setResult(data); setActive(ref); setMsg('')
  }
  useEffect(() => { if (initialRef) { setCode(initialRef); lookup(initialRef) } }, [initialRef])
  useEffect(() => {
    if (!active || ['Delivered', 'Cancelled'].includes(result?.status)) return
    const timer = setInterval(() => lookup(active, true), 15000)
    return () => clearInterval(timer)
  }, [active, result?.status])
  const current = STEPS.findIndex(([status]) => status === result?.status)
  const label = (STEPS[current] || [])[1]
  return <div className="c-track">
    {!compact && <>
      <h2 className="c-h2">Track your order</h2>
      <form className="track-form c-trackform" onSubmit={e => { e.preventDefault(); lookup(code) }}>
        <input className="c-input" value={code} onChange={e => setCode(e.target.value)} placeholder="Reference or phone number" aria-label="Order reference number" autoCapitalize="characters" autoCorrect="off" spellCheck="false" />
        <button className="c-btn c-btn-ink">Track</button>
      </form>
    </>}
    {msg && <p className="c-note">{msg}</p>}
    {list && <div className="c-orders" aria-label="Orders for this phone number">
      <p className="c-sub">{list.total} order{list.total === 1 ? '' : 's'} for this number. Tap one to see its status.</p>
      <ul className="c-ordlist">{list.orders.map(o => <li key={o.order_number}><button type="button" className={o.order_number === active ? 'c-ordrow on' : 'c-ordrow'} onClick={() => lookup(o.order_number, true)}>
        {logoFor(o.restaurant_slug) && <img className="c-logo" src={logoFor(o.restaurant_slug)} alt="" width="32" height="32" />}
        <span className="c-ordmain"><b>{o.order_number}</b><small>{o.restaurant} · {placedText(o.placed_at)} · {money(o.total)}</small><small className="c-orditems">{itemText(o.items)}</small></span>
        <span className={o.status === 'Cancelled' ? 'c-pill bad' : o.status === 'Delivered' ? 'c-pill done' : 'c-pill'}>{o.status}</span>
      </button></li>)}</ul>
      {list.total > PAGE && <div className="c-pager"><button type="button" className="c-btn c-btn-line" disabled={list.page === 0} onClick={() => loadPhone(list.phone, list.page - 1)}>Previous</button><span>Page {list.page + 1} of {Math.ceil(list.total / PAGE)}</span><button type="button" className="c-btn c-btn-line" disabled={(list.page + 1) * PAGE >= list.total} onClick={() => loadPhone(list.phone, list.page + 1)}>Next</button></div>}
    </div>}
    {result && (result.status === 'Cancelled'
      ? <p className="c-note c-note-bad">Order {result.order_number} was cancelled.{result.cancel_reason ? <> <b>Reason:</b> {result.cancel_reason}</> : ' Please contact the kitchen.'}</p>
      : <div className="track-result c-result">
          {result.restaurant && <p className="c-rest-chip">{logoFor(result.restaurant_slug) && <img className="c-logo" src={logoFor(result.restaurant_slug)} alt="" width="24" height="24" />}<span>{result.restaurant}</span></p>}
          <div className="c-result-head">{compact ? <span className="c-sub">Order status</span> : <b>{result.order_number}</b>}<span className={result.status === 'Delivered' ? 'c-pill done' : 'c-pill'}>{label}</span></div>
          {result.placed_at && <p className="c-sub">Placed {placedText(result.placed_at)}</p>}
          {result.items && result.items.length > 0 && <p className="c-sub c-items">{itemText(result.items)}</p>}
          {result.delivery_date && <p className="c-sub c-deliver">Delivery: {deliveryText(result.delivery_date, zonedNow('Asia/Kolkata').date)}</p>}
          <ol className="c-steps">{STEPS.map(([status, text], i) => <li key={status} style={{ '--i': i }} className={i < current ? 'done' : i === current ? 'now' : ''}>{text}</li>)}</ol>
          <p className="c-sub">Total {money(result.total)}. This updates by itself.</p>
        </div>)}
  </div>
}

/* ---------- Order page for one restaurant ---------- */
function OrderPage({ r, list }) {
  const [menu, setMenu] = useState(null), [menuError, setMenuError] = useState('')
  const [qty, setQty] = useState({})
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [address, setAddress] = useState(''), [payment, setPayment] = useState(PAYMENTS[0]), [notes, setNotes] = useState('')
  const [sending, setSending] = useState(false), [error, setError] = useState(''), [placed, setPlaced] = useState(null), [dialog, setDialog] = useState(false)
  const [copied, setCopied] = useState(false), [forcedClosed, setForcedClosed] = useState('')
  const isOpen = r.is_open && !forcedClosed
  const others = list.filter(x => x.slug !== r.slug)
  usePageBrand(r)

  useEffect(() => {
    if (!isOpen) return
    if (!supabase || !r.id) { setMenu([]); setMenuError('The menu is not available yet.'); return }
    setMenu(null); setMenuError('')
    supabase.from('recipes').select('id,name,selling_price,category').eq('restaurant_id', r.id).eq('is_published', true).order('name').then(({ data, error: err }) => {
      if (err) { setMenuError(`Could not load the menu: ${err.message}`); setMenu([]) } else setMenu(data || [])
    })
  }, [r.id, isOpen])
  useEffect(() => { if (r.is_open) setForcedClosed('') }, [r.is_open])

  // delivery days: only the days this restaurant delivers on (the server decides and double-checks)
  const [days, setDays] = useState(null), [today, setToday] = useState(''), [deliveryDate, setDeliveryDate] = useState('')
  const loadDays = () => {
    if (!supabase) return setDays([])
    supabase.rpc('get_delivery_dates', { p_restaurant: r.slug }).then(({ data, error: err }) => {
      if (err || !data) return setDays([])
      const list = data.dates || []
      setDays(list); setToday(data.today)
      setDeliveryDate(cur => list.includes(cur) ? cur : (list[0] || ''))
    })
  }
  const scheduleKey = JSON.stringify([r.delivery_mode, r.delivery_weekdays, r.delivery_anchor, r.advance_days, r.allow_same_day, r.order_cutoff])
  useEffect(() => { if (isOpen) loadDays() }, [r.slug, isOpen, scheduleKey])

  const dishes = menu || []
  const picked = dishes.filter(d => qty[d.id] > 0)
  const count = picked.reduce((n, d) => n + qty[d.id], 0)
  const total = picked.reduce((sum, d) => sum + Number(d.selling_price) * qty[d.id], 0)
  const minOrder = Number(r.min_order_value || 0), belowMin = total < minOrder
  const groups = Object.entries(dishes.reduce((acc, d) => { (acc[d.category || 'Menu'] ||= []).push(d); return acc }, {}))
  const step = (id, delta) => setQty(q => ({ ...q, [id]: Math.max(0, Math.min(50, (q[id] || 0) + delta)) }))
  const copyRef = async () => { if (!placed) return; await copyText(placed.ref); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  const submit = async (e) => {
    e.preventDefault()
    if (sending) return
    if (!picked.length) return setError('Add at least one dish to place an order.')
    if (!deliveryDate) return setError('Choose a delivery day.')
    if (!supabase) return setError('Ordering is not available right now. Please contact the kitchen.')
    setSending(true); setError('')
    const { data, error: err } = await supabase.rpc('place_order', { p_restaurant: r.slug, p_name: name.trim(), p_phone: phone.trim(), p_address: address.trim(), p_payment: payment, p_notes: notes.trim(), p_items: picked.map(d => ({ recipe_id: d.id, quantity: qty[d.id] })), p_delivery_date: deliveryDate })
    setSending(false)
    if (err) {
      if (/INVALID_DELIVERY_DATE/.test(err.message)) { loadDays(); return setError('That delivery day is no longer available. Please choose another day.') }
      if (/RESTAURANT_CLOSED/.test(err.message)) { setForcedClosed(err.message.replace(/^.*RESTAURANT_CLOSED:\s*/, '')); return }
      const known = /^(INVALID_PHONE|RATE_LIMIT|MIN_ORDER):/.test(err.message)
      return setError(known ? err.message.replace(/^[A-Z_]+:\s*/, '') : `Could not place your order: ${err.message}`)
    }
    const ref = data.order_number
    setPlaced({ ref, total: Number(data.total), deliveryDate: data.delivery_date, today, items: (data.items || []).filter(i => !String(i.name).startsWith('Note:')) })
    setDialog(true)
    try { localStorage.setItem('last-order-ref', ref); localStorage.setItem(`last-order-ref:${r.slug}`, ref) } catch { /* optional */ }
    setQty({}); setNotes('')
  }

  return <div className="c-app c-order" style={themeStyle(r.slug)}>
    <header className="c-bar">
      <a className="c-back" href={`/${r.slug}`} aria-label={`Back to ${r.name}`}><Ico n="back" /></a>
      <Mark r={r} size={34} className="c-bar-mark" />
      {others.length === 1 && <a className="c-switch" href={`/${others[0].slug}`}>Switch to <b>{others[0].name}</b></a>}
      {others.length > 1 && <a className="c-switch" href="/">All restaurants</a>}
    </header>

    {!isOpen
      ? <div className="c-page c-closed-page" role="status">
          <img className="c-logo c-logo-lg" src={logoFor(r.slug)} alt={`${r.name} logo`} width="96" height="96" />
          <h1 className="c-h1">{r.name} is closed</h1>
          <p className="c-lead-text">{forcedClosed || closedText(r)}</p>
          <WhatsAppLink r={r} className="c-wa c-wa-plain" />
          {others.filter(x => x.is_open).map(x => <a key={x.slug} className="c-cta c-cta-btn" href={`/${x.slug}/order`}>Order from {x.name}</a>)}
          <a className="c-staff" href={`/${r.slug}`}>Back to {r.name}</a>
        </div>
      : <div className="c-page">
          {placed && <section className="c-success" aria-live="polite">
            <h2 className="c-h2">Order placed</h2>
            <div className="c-ref-row"><code className="c-ref">{placed.ref}</code><button type="button" className="c-btn c-btn-line" onClick={copyRef}>{copied ? 'Copied' : 'Copy'}</button></div>
            <p className="c-sub">Total {money(placed.total)}. Keep this number to track your order.</p>
            {placed.deliveryDate && <p className="c-deliver-line">Delivery: {deliveryText(placed.deliveryDate, placed.today)}</p>}
            <WhatsAppLink r={r} className="c-wa" />
            <TrackOrder initialRef={placed.ref} compact />
          </section>}

          <form id="order-form" onSubmit={submit}>
            <h1 className="c-h1">{placed ? 'Order something else' : 'Choose your dishes'}</h1>
            {minOrder > 0 && <p className="c-sub c-min">Minimum order {money(minOrder)}.</p>}
            {menu === null && <p className="c-note">Loading the menu…</p>}
            {menuError && <p className="c-note c-note-bad">{menuError}</p>}
            {menu && !menu.length && !menuError && <p className="c-note">No dishes are on today's menu yet. Please check back soon.</p>}
            {groups.map(([category, items]) => <section key={category}>
              <h2 className="c-h2 c-cat">{category}</h2>
              <ul className="c-menu">{items.map(d => {
                const n = qty[d.id] || 0
                return <li key={d.id} className={n ? 'c-dish on' : 'c-dish'}>
                  <div className="c-dish-main"><span className="c-dish-name">{d.name}</span><span className="c-dish-price">{money(d.selling_price)}</span></div>
                  <div className="c-qty">{n === 0
                    ? <button type="button" className="c-add" onClick={() => step(d.id, 1)} aria-label={`Add ${d.name}`}>Add</button>
                    : <><button type="button" className="c-step" onClick={() => step(d.id, -1)} aria-label={`Remove one ${d.name}`}><Ico n="minus" size={18} /></button><output key={n} className="c-n c-bump" aria-label={`${d.name} quantity`}>{n}</output><button type="button" className="c-step" onClick={() => step(d.id, 1)} aria-label={`Add one more ${d.name}`}><Ico n="plus" size={18} /></button></>}
                  </div>
                </li>
              })}</ul>
            </section>)}

            <h2 className="c-h2 c-cat">Delivery day</h2>
            <p className="c-sub c-sched-note">{r.name} delivers {scheduleLabel(r)}. Choose a day.</p>
            {days === null && <p className="c-note">Checking delivery days…</p>}
            {days && !days.length && <p className="c-note c-note-bad" role="alert">No delivery days are open right now. Please check back soon.</p>}
            {days && days.length > 0 && <div className="c-days" role="radiogroup" aria-label="Delivery day">{days.map(d => { const p = dayParts(d, today); return <label key={d} className={deliveryDate === d ? 'c-day on' : 'c-day'}><input type="radio" name="delivery-day" value={d} checked={deliveryDate === d} onChange={() => setDeliveryDate(d)} /><b>{p.top}</b><span>{p.bottom}</span></label> })}</div>}

            <h2 className="c-h2 c-cat">Delivery details</h2>
            <label className="c-field"><span>Name</span><input className="c-input" required autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>
            <label className="c-field"><span>Phone number <small>10-digit mobile</small></span><input className="c-input" required maxLength={16} type="tel" inputMode="tel" autoComplete="tel" pattern="[0-9+ \-]{7,20}" title="Enter a valid phone number" value={phone} onChange={e => setPhone(e.target.value)} /></label>
            <label className="c-field"><span>Delivery address</span><textarea className="c-input" required rows={3} autoComplete="street-address" placeholder="House or flat, building, area, landmark" value={address} onChange={e => setAddress(e.target.value)} /></label>
            <fieldset className="c-field c-pay"><legend>Payment</legend>
              <div className="c-chips">{PAYMENTS.map(p => <label key={p} className={payment === p ? 'c-chip on' : 'c-chip'}><input type="radio" name="payment" value={p} checked={payment === p} onChange={() => setPayment(p)} />{p}</label>)}</div>
            </fieldset>
            <label className="c-field"><span>Notes <small>optional</small></span><textarea className="c-input" rows={2} placeholder="Spice level, allergies, delivery instructions" value={notes} onChange={e => setNotes(e.target.value)} /></label>
            {error && <p className="c-note c-note-bad" role="alert">{error}</p>}
          </form>
        </div>}

    {isOpen && count > 0 && <div className="c-cart">
      <div className="c-cart-sum"><b>{count} item{count === 1 ? '' : 's'}</b><span key={total} className="c-bump">{money(total)}</span></div>
      <button form="order-form" className="c-cta c-cta-accent customer-submit" disabled={sending || !deliveryDate || belowMin}>{belowMin ? `Add ${money(minOrder - total)} more` : sending ? 'Placing order…' : 'Place order'}</button>
    </div>}

    {dialog && placed && <OrderDialog r={r} order={placed} copied={copied} onCopy={copyRef} onClose={() => { setDialog(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />}
  </div>
}

/* The centred "order received" confirmation, in the restaurant's own colours */
function OrderDialog({ r, order, copied, onCopy, onClose }) {
  const done = useRef(null)
  useEffect(() => {
    done.current && done.current.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return <div className="c-dialog-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="c-dialog" role="dialog" aria-modal="true" aria-labelledby="od-title">
      <img className="c-logo c-dlg-logo" src={logoFor(r.slug)} alt={`${r.name} logo`} width="64" height="64" />
      <p className="c-dlg-rest">{r.name}</p>
      <svg className="c-check" width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="22" cy="22" r="16" /><path d="M14.5 22.5l5 5 10-11" /></svg>
      <h2 id="od-title" className="c-dlg-title">Order received!</h2>
      <p className="c-dlg-line">Your reference is</p>
      <div className="c-dlg-ref"><code>{order.ref}</code><button type="button" className="c-btn c-btn-ink" onClick={onCopy}>{copied ? 'Copied' : 'Copy'}</button></div>
      <p className="c-dlg-total">Total: {money(order.total)}</p>
      {order.deliveryDate && <p className="c-dlg-deliver">Delivery: {deliveryText(order.deliveryDate, order.today)}</p>}
      {order.items.length > 0 && <ul className="c-dlg-items" aria-label="Your order">{order.items.map((i, k) => <li key={k}><span>{i.quantity} × {i.name}</span><span>{money(i.price * i.quantity)}</span></li>)}</ul>}
      <WhatsAppLink r={r} className="c-wa c-wa-dlg" />
      <p className="c-dlg-hint">Keep this number to track your order.</p>
      <button ref={done} type="button" className="c-cta c-cta-hero" onClick={onClose}>Done</button>
    </div>
  </div>
}

/* ---------- Staff sign in ---------- */
export function AdminLogin({ onBack }) {
  usePageBrand(null, 'Staff sign in')
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [message, setMessage] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    if (!supabase) return setMessage('Sign-in is not available. Add your Supabase URL and anon key to .env.')
    setMessage('Signing in…')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setMessage(error ? `Sign-in failed: ${error.message}` : '')
  }
  return <div className="c-app c-login" style={themeStyle(null)}>
    <header className="c-bar">{onBack ? <button type="button" className="c-back" onClick={onBack} aria-label="Back to home"><Ico n="back" /></button> : <span className="c-back" />}<span>Staff</span></header>
    <form className="c-page" onSubmit={submit}>
      <h1 className="c-h1">Staff sign in</h1>
      <p className="c-sub c-lead">For kitchen staff. Customers can order from the home page.</p>
      <label className="c-field"><span>Email</span><input className="c-input" required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@kitchen.com" /></label>
      <label className="c-field"><span>Password</span><input className="c-input" required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button className="c-cta c-cta-btn customer-submit">Sign in</button>
      {message && <p className="c-note" role="status">{message}</p>}
    </form>
  </div>
}
