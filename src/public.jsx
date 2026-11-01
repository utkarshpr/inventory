import React, { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { qrMatrix } from './qr'
import { useRestaurants, themeStyle, logoFor, Mark, wordmarkLines, closedText, dayParts, deliveryText, scheduleLabel, usePageBrand, zonedNow } from './restaurants'
import './public.css'

const PAYMENTS = ['Cash on delivery', 'UPI']
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
const orderAgain = (slug, items) => { try { sessionStorage.setItem('reorder', JSON.stringify({ slug, items: (items || []).filter(i => !String(i.name).startsWith('Note:')).map(i => ({ name: i.name, quantity: i.quantity })) })) } catch { /* optional */ } window.location.href = `/${slug}/order` }
const itemText = (items) => (items || []).map(i => /^\d+\s*×/.test(i.name || '') ? i.name : `${i.quantity}× ${i.name}${i.options ? ` (${i.options})` : ''}`).join(', ')
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
    const timer = setInterval(() => lookup(active, true), result?.payment_status === 'pending' ? 5000 : 15000)
    return () => clearInterval(timer)
  }, [active, result?.status, result?.payment_status])
  // A UPI order starts with its payment: "Payment confirmation pending" comes first, then the kitchen steps.
  const payFlow = result && (result.payment_status === 'pending' || result.payment_status === 'received')
  const steps = payFlow ? [['Payment', result.payment_status === 'pending' ? (result.payment_claimed ? 'Payment sent, waiting for verification' : 'Payment confirmation pending') : 'Payment confirmed'], ...STEPS] : STEPS
  const current = result && result.payment_status === 'pending' ? 0 : steps.findIndex(([status]) => status === result?.status)
  const label = result && result.payment_status === 'pending' ? (result.payment_claimed ? 'Verifying payment' : 'Payment pending') : (steps[current] || [])[1]
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
        <span className="c-ordmain"><b>{o.order_number}</b><small>{o.restaurant} · {placedText(o.placed_at)} · {money(o.total)}{o.payment_status === 'pending' && o.status !== 'Cancelled' ? ' · payment pending' : ''}</small><small className="c-orditems">{itemText(o.items)}</small></span>
        <span className={o.status === 'Cancelled' ? 'c-pill bad' : o.status === 'Delivered' ? 'c-pill done' : 'c-pill'}>{o.payment_status === 'pending' && o.status !== 'Cancelled' ? 'Payment pending' : o.status}</span>
      </button>{o.restaurant_slug && <button type="button" className="c-again" onClick={() => orderAgain(o.restaurant_slug, o.items)}>Order again</button>}</li>)}</ul>
      {list.total > PAGE && <div className="c-pager"><button type="button" className="c-btn c-btn-line" disabled={list.page === 0} onClick={() => loadPhone(list.phone, list.page - 1)}>Previous</button><span>Page {list.page + 1} of {Math.ceil(list.total / PAGE)}</span><button type="button" className="c-btn c-btn-line" disabled={(list.page + 1) * PAGE >= list.total} onClick={() => loadPhone(list.phone, list.page + 1)}>Next</button></div>}
    </div>}
    {result && (result.status === 'Cancelled'
      ? <p className="c-note c-note-bad">Order {result.order_number} was cancelled.{result.cancel_reason ? <> <b>Reason:</b> {result.cancel_reason}</> : ' Please contact the kitchen.'}</p>
      : <div className="track-result c-result">
          {result.restaurant && <p className="c-rest-chip">{logoFor(result.restaurant_slug) && <img className="c-logo" src={logoFor(result.restaurant_slug)} alt="" width="24" height="24" />}<span>{result.restaurant}</span></p>}
          <div className="c-result-head">{compact ? <span className="c-sub">Order status</span> : <b>{result.order_number}</b>}<span className={result.status === 'Delivered' ? 'c-pill done' : 'c-pill'}>{label}</span></div>
          {result.delivery_fee_pending && <p className="c-pay-note" role="status"><b>The delivery charge is being added.</b> {result.restaurant || 'The kitchen'} sets it based on your distance. Your total will update here{result.payment_status === 'pending' ? ', then you can pay' : ''}.</p>}
          {result.payment_status === 'pending' && !result.delivery_fee_pending && <p className="c-pay-note" role="status"><b>{result.payment_claimed ? 'Payment sent. Waiting for verification.' : 'Waiting for your UPI payment to be confirmed.'}</b> {result.restaurant || 'The kitchen'} starts cooking once the payment is confirmed.</p>}
          {!compact && result.payment_status === 'pending' && !result.delivery_fee_pending && <PayClaim orderRef={result.order_number} claimed={Boolean(result.payment_claimed)} reason={result.payment_reject_reason || ''} onDone={() => lookup(result.order_number, true)} />}
          {result.payment_status === 'received' && <p className="c-pay-ok" role="status">Payment confirmed</p>}
          {result.placed_at && <p className="c-sub">Placed {placedText(result.placed_at)}</p>}
          {result.items && result.items.length > 0 && <p className="c-sub c-items">{itemText(result.items)}</p>}
          {result.eta_at && <p className="c-sub c-eta">{new Date(result.eta_at) > new Date() ? `Ready around ${new Date(result.eta_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}` : 'Ready any minute now'}</p>}
          {result.delivery_date && <p className="c-sub c-deliver">Delivery: {deliveryText(result.delivery_date, zonedNow('Asia/Kolkata').date)}</p>}
          <ol className="c-steps">{steps.map(([status, text], i) => <li key={status} style={{ '--i': i }} className={i < current ? 'done' : i === current ? 'now' : ''}>{text}</li>)}</ol>
          <p className="c-sub">Total {money(result.total)}{Number(result.delivery_fee) > 0 ? ` (includes ${money(result.delivery_fee)} delivery)` : ''}. This updates by itself.</p>
          {result.status === 'Delivered' && <RatingBox orderRef={result.order_number} rating={result.rating} comment={result.rating_comment} onDone={() => lookup(result.order_number, true)} />}
          {!compact && result.restaurant_slug && <button type="button" className="c-btn c-btn-line c-again-btn" onClick={() => orderAgain(result.restaurant_slug, result.items)}>Order again</button>}
        </div>)}
  </div>
}

/* ---------- Order page for one restaurant ---------- */
function OrderPage({ r, list }) {
  const [menu, setMenu] = useState(null), [menuError, setMenuError] = useState('')
  const [qty, setQty] = useState({})   // key: a dish id, or "dishId|optionId+optionId" for a dish with options
  const [optionsBy, setOptionsBy] = useState({}), [sheet, setSheet] = useState(null), [avail, setAvail] = useState({})
  const [saved] = useState(() => { try { return JSON.parse(localStorage.getItem('customer-details') || 'null') || {} } catch { return {} } })
  const [hasSaved, setHasSaved] = useState(Boolean(saved.phone))
  const [name, setName] = useState(saved.name || ''), [phone, setPhone] = useState(saved.phone || ''), [address, setAddress] = useState(saved.address || ''), [payment, setPayment] = useState(PAYMENTS[0]), [notes, setNotes] = useState('')
  const [sending, setSending] = useState(false), [error, setError] = useState(''), [placed, setPlaced] = useState(null), [dialog, setDialog] = useState(false)
  const [dishQ, setDishQ] = useState(''), [editDetails, setEditDetails] = useState(false), [activeOrder, setActiveOrder] = useState(null)
  const [tab, setTab] = useState('menu')   // 'menu' = add to cart and order, 'orders' = sign in with a phone number, see and track orders
  const [custPhone, setCustPhone] = useState(() => { try { const v = digits10((JSON.parse(localStorage.getItem('customer-details') || '{}') || {}).phone); return /^[6-9]\d{9}$/.test(v) ? v : '' } catch { return '' } })   // logged in by phone number alone
  useEffect(() => { if (custPhone) setPhone(cur => cur || custPhone) }, [custPhone])   // the order form uses the number you signed in with
  useEffect(() => {   // the newest order that is still on its way, shown as a small bar above the menu
    if (!custPhone || !supabase) return setActiveOrder(null)
    let alive = true
    const look = async () => { const { data } = await supabase.rpc('track_orders_by_phone', { p_phone: custPhone, p_limit: 3, p_offset: 0, p_restaurant: r.slug }); if (!alive || !data) return; setActiveOrder((data.orders || []).find(o => o.status !== 'Delivered' && o.status !== 'Cancelled') || null) }
    look(); const t = setInterval(look, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [custPhone, placed && placed.ref])
  const [copied, setCopied] = useState(false), [forcedClosed, setForcedClosed] = useState('')
  const [feeState, setFeeState] = useState(null)   // { ref, status: 'pending' | 'set', fee, total }: waiting for the kitchen's delivery charge
  const [payState, setPayState] = useState(null)   // { ref, status: 'pending' | 'received' } for a UPI order just placed
  const [couponText, setCouponText] = useState(''), [coupon, setCoupon] = useState(null), [couponMsg, setCouponMsg] = useState(''), [reorderNote, setReorderNote] = useState('')
  const kitchenToday = zonedNow(r.timezone || 'Asia/Kolkata').date
  const soldOut = (d) => Boolean(d.sold_out_date) && d.sold_out_date === kitchenToday
  const isOpen = r.is_open && !forcedClosed
  const others = list.filter(x => x.slug !== r.slug)
  usePageBrand(r)

  useEffect(() => {
    if (!isOpen) return
    if (!supabase || !r.id) { setMenu([]); setMenuError('The menu is not available yet.'); return }
    setMenu(null); setMenuError('')
    supabase.from('recipes').select('id,name,selling_price,category,sold_out_date,image_url,daily_limit,half_plate').eq('restaurant_id', r.id).eq('is_published', true).order('name').then(async ({ data, error: err }) => {
      if (err) { setMenuError(`Could not load the menu: ${err.message}`); setMenu([]); return }
      const rows = data || []
      let by = {}
      if (rows.length) {
        const res = await supabase.from('recipe_options').select('id,recipe_id,kind,name,price_delta,sort_order').in('recipe_id', rows.map(x => x.id))
        ;(res.data || []).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)).forEach(o => { (by[o.recipe_id] ||= []).push(o) })
      }
      setOptionsBy(by); setMenu(rows)
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
  const optsOf = (d) => optionsBy[d.id] || []
  const halfPrice = (d) => Math.ceil(Number(d.selling_price) / 2) + 50   // half plate = full price / 2 + 50
  const hasHalf = (d) => Boolean(d.half_plate) && !optsOf(d).some(o => o.kind === 'size')
  const needsSheet = (d) => optsOf(d).length > 0 || hasHalf(d)
  const lineInfo = (key) => {
    const [id, optStr] = key.split('|'), d = dishes.find(x => x.id === id)
    if (!d) return null
    const ids = optStr ? optStr.split('+') : [], half = ids.includes('half') && hasHalf(d), chosen = ids.map(i => optsOf(d).find(o => o.id === i)).filter(Boolean)
    const cnt = {}; chosen.forEach(o => { cnt[o.name] = (cnt[o.name] || 0) + 1 })
    const names = [...(half ? ['Half plate'] : hasHalf(d) ? ['Full plate'] : []), ...Object.keys(cnt).map(n => cnt[n] > 1 ? `${n} ×${cnt[n]}` : n)]
    return { key, dish: d, half, optionIds: chosen.map(o => o.id), label: names.join(', '), unit: (half ? halfPrice(d) : Number(d.selling_price)) + chosen.reduce((s, o) => s + Number(o.price_delta), 0), qty: qty[key] }
  }
  const picked = Object.keys(qty).filter(k => qty[k] > 0).map(lineInfo).filter(Boolean)
  const count = picked.reduce((n, l) => n + l.qty, 0)
  const total = picked.reduce((sum, l) => sum + l.unit * l.qty, 0)
  const dishQty = (d) => picked.filter(l => l.dish.id === d.id).reduce((n, l) => n + l.qty, 0)
  const leftOf = (d) => avail[d.id]   // plates left for the chosen day (undefined = no limit)
  const canAdd = (d) => leftOf(d) == null || dishQty(d) < leftOf(d)
  const minOrder = Number(r.min_order_value || 0), belowMin = total < minOrder
  const discount = coupon ? Math.min(coupon.discount, total) : 0
  const feeBase = Number(r.delivery_fee || 0), freeAbove = r.free_delivery_above ? Number(r.free_delivery_above) : null
  const distance = r.charge_mode === 'distance'   // the kitchen adds the delivery charge after the order is placed
  const fee = picked.length && !distance ? (freeAbove != null && total >= freeAbove ? 0 : feeBase) : 0
  const payable = total - discount + fee
  const groups = Object.entries(dishes.filter(d => !dishQ.trim() || String(d.name).toLowerCase().includes(dishQ.trim().toLowerCase())).reduce((acc, d) => { (acc[d.category || 'Menu'] ||= []).push(d); return acc }, {}))
  const step = (key, delta) => {
    const d = dishes.find(x => x.id === key.split('|')[0])
    if (delta > 0 && d && !canAdd(d)) return
    setQty(q => ({ ...q, [key]: Math.max(0, Math.min(50, (q[key] || 0) + delta)) }))
  }
  const addDish = (d) => { if (needsSheet(d)) setSheet(d); else step(d.id, 1) }
  useEffect(() => {   // plates left per dish for the chosen delivery day
    if (!isOpen || !deliveryDate || !supabase) return
    let alive = true
    supabase.rpc('get_availability', { p_restaurant: r.slug, p_date: deliveryDate }).then(({ data }) => { if (alive) setAvail(data || {}) })
    return () => { alive = false }
  }, [r.slug, deliveryDate, isOpen, menu && menu.length])
  useEffect(() => {   // "Order again": fill the cart from a past order, using today's menu and prices
    if (!menu || !menu.length) return
    let saved = null
    try { saved = JSON.parse(sessionStorage.getItem('reorder') || 'null'); sessionStorage.removeItem('reorder') } catch { /* ignore */ }
    if (!saved || saved.slug !== r.slug || !Array.isArray(saved.items)) return
    const next = {}, missing = []
    saved.items.forEach(it => {
      const d = menu.find(x => x.name.trim().toLowerCase() === String(it.name || '').trim().toLowerCase())
      if (d && !soldOut(d) && !needsSheet(d)) next[d.id] = Math.min(50, (next[d.id] || 0) + (Number(it.quantity) || 1)); else missing.push(it.name)
    })
    setQty(next)
    const added = Object.keys(next).length
    setReorderNote(added ? `Added ${added} dish${added === 1 ? '' : 'es'} from your last order at today's prices.${missing.length ? ` Not available now: ${missing.join(', ')}.` : ''}` : `None of those dishes are available right now: ${missing.join(', ')}.`)
  }, [menu])
  const checkCoupon = async (code, subtotal, quiet) => {
    if (!supabase) return
    const { data, error: err } = await supabase.rpc('validate_coupon', { p_restaurant: r.slug, p_code: code, p_subtotal: subtotal })
    if (err || !data) { setCoupon(null); return setCouponMsg((err && err.message || '').replace(/^COUPON:\s*/, '') || 'This code is not valid') }
    setCoupon({ code: data.code, discount: Number(data.discount) }); setCouponMsg(quiet ? '' : `Code ${data.code} applied`)
  }
  useEffect(() => { if (coupon) checkCoupon(coupon.code, total, true) }, [total])   // the discount follows the cart
  useEffect(() => {   // after a UPI order: ask every few seconds whether the kitchen has confirmed the payment
    if (!payState || payState.status !== 'pending' || !supabase) return
    const timer = setInterval(async () => {
      const { data } = await supabase.rpc('track_order', { p_order_number: payState.ref })
      if (!data) return
      if (data.status === 'Cancelled') setPayState(null)
      else if (data.payment_status !== 'pending') setPayState({ ref: payState.ref, status: 'received' })
      else setPayState(s => s && s.status === 'pending' && (s.claimed !== Boolean(data.payment_claimed) || s.reason !== (data.payment_reject_reason || '')) ? { ...s, claimed: Boolean(data.payment_claimed), reason: data.payment_reject_reason || '' } : s)
    }, 5000)
    return () => clearInterval(timer)
  }, [payState && payState.ref, payState && payState.status])
  useEffect(() => {   // the kitchen sets the delivery charge: pick it up within a few seconds
    if (!feeState || feeState.status !== 'pending' || !supabase) return
    const timer = setInterval(async () => {
      const { data } = await supabase.rpc('track_order', { p_order_number: feeState.ref })
      if (!data) return
      if (data.status === 'Cancelled') return setFeeState(null)
      if (!data.delivery_fee_pending) { setPlaced(p => p && ({ ...p, total: Number(data.total), deliveryFee: Number(data.delivery_fee || 0), feePending: false })); setFeeState({ ref: feeState.ref, status: 'set', fee: Number(data.delivery_fee || 0), total: Number(data.total) }) }
    }, 5000)
    return () => clearInterval(timer)
  }, [feeState && feeState.ref, feeState && feeState.status])
  useEffect(() => {
    if (!feeState || feeState.status !== 'set') return
    const t = setTimeout(() => setFeeState(null), 6000)
    return () => clearTimeout(t)
  }, [feeState && feeState.status])
  const onClaimed = () => setPayState(s => s && ({ ...s, claimed: true, reason: '' }))
  useEffect(() => {   // "Payment confirmed" stays for a moment, then the popup disappears
    if (!payState || payState.status !== 'received') return
    const t = setTimeout(() => setPayState(null), 4500)
    return () => clearTimeout(t)
  }, [payState && payState.status])
  const copyRef = async () => { if (!placed) return; await copyText(placed.ref); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  const submit = async (e) => {
    e.preventDefault()
    if (sending) return
    if (!picked.length) return setError('Add at least one dish to place an order.')
    if (!deliveryDate) return setError('Choose a delivery day.')
    if (!supabase) return setError('Ordering is not available right now. Please contact the kitchen.')
    setSending(true); setError('')
    const { data, error: err } = await supabase.rpc('place_order', { p_restaurant: r.slug, p_name: name.trim(), p_phone: phone.trim(), p_address: address.trim(), p_payment: payment, p_notes: notes.trim(), p_items: picked.map(l => ({ recipe_id: l.dish.id, quantity: l.qty, ...(l.optionIds.length ? { options: l.optionIds } : {}), ...(l.half ? { half: true } : {}) })), p_coupon: coupon ? coupon.code : null, p_delivery_date: deliveryDate })
    setSending(false)
    if (err) {
      if (/INVALID_DELIVERY_DATE/.test(err.message)) { loadDays(); return setError('That delivery day is no longer available. Please choose another day.') }
      if (/RESTAURANT_CLOSED/.test(err.message)) { setForcedClosed(err.message.replace(/^.*RESTAURANT_CLOSED:\s*/, '')); return }
      const known = /^(INVALID_PHONE|RATE_LIMIT|MIN_ORDER|SOLD_OUT|COUPON|OPTIONS):/.test(err.message)
      return setError(known ? err.message.replace(/^[A-Z_]+:\s*/, '') : `Could not place your order: ${err.message}`)
    }
    const ref = data.order_number
    setPlaced({ ref, total: Number(data.total), subtotal: Number(data.subtotal || data.total), discount: Number(data.discount || 0), deliveryFee: Number(data.delivery_fee || 0), feePending: Boolean(data.delivery_fee_pending), eta: payment !== 'UPI' && r.prep_minutes && data.delivery_date === kitchenToday ? Number(r.prep_minutes) : null, coupon: data.coupon || '', payment, deliveryDate: data.delivery_date, today, items: (data.items || []).filter(i => !String(i.name).startsWith('Note:')) })
    setDialog(true)
    setCustPhone(digits10(phone))
    setPayState(payment === 'UPI' ? { ref, status: 'pending', claimed: false, reason: '' } : null)
    setFeeState(data.delivery_fee_pending ? { ref, status: 'pending' } : null)
    try { localStorage.setItem('last-order-ref', ref); localStorage.setItem(`last-order-ref:${r.slug}`, ref) } catch { /* optional */ }
    try { localStorage.setItem('customer-details', JSON.stringify({ name: name.trim(), phone: phone.trim(), address: address.trim() })); setHasSaved(true) } catch { /* optional */ }
    setQty({}); setNotes(''); setCoupon(null); setCouponText(''); setCouponMsg('')
  }

  return <div className="c-app c-order" style={themeStyle(r.slug)}>
    <header className="c-bar">
      <a className="c-back" href={`/${r.slug}`} aria-label={`Back to ${r.name}`}><Ico n="back" /></a>
      <Mark r={r} size={34} className="c-bar-mark" />
      {others.length === 1 && <a className="c-switch c-switch-logo" href={`/${others[0].slug}`} title={`Switch to ${others[0].name}`}>{logoFor(others[0].slug) && <img className="c-logo" src={logoFor(others[0].slug)} alt="" width="40" height="40" />}<span className="c-switch-text">Switch to <b>{others[0].name}</b></span></a>}
      {others.length > 1 && <a className="c-switch" href="/">All restaurants</a>}
      <p className="c-bar-meta">{r.location && <><PinIcon />{r.location}<span aria-hidden="true"> · </span></>}Delivers {scheduleLabel(r)}</p>
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
          {tab === 'menu' && activeOrder && <button type="button" className="c-active-bar" onClick={() => setTab('orders')}><span>Your order <b>{activeOrder.order_number}</b>: {activeOrder.delivery_fee_pending ? 'waiting for the delivery charge' : activeOrder.status === 'New' ? 'received' : activeOrder.status.toLowerCase()}</span><span aria-hidden="true">›</span></button>}
          <div className="c-tabs" role="tablist" aria-label="Order page"><button type="button" role="tab" aria-selected={tab === 'menu'} className={tab === 'menu' ? 'c-tab on' : 'c-tab'} onClick={() => setTab('menu')}>Menu</button><button type="button" role="tab" aria-selected={tab === 'orders'} className={tab === 'orders' ? 'c-tab on' : 'c-tab'} onClick={() => setTab('orders')}>My orders</button></div>
          {tab === 'orders' && <><MyOrders r={r} all={list} phone={custPhone} setPhone={(v) => { setCustPhone(v); if (v) { try { const o = JSON.parse(localStorage.getItem('customer-details') || '{}') || {}; localStorage.setItem('customer-details', JSON.stringify({ ...o, phone: v })) } catch { /* optional */ } } else { try { localStorage.removeItem('customer-details') } catch { /* optional */ } setHasSaved(false) } }} refresh={placed && placed.ref} onPayClaimed={(ref) => setPayState(s => s && s.ref === ref ? { ...s, claimed: true, reason: '' } : s)} /><button type="button" className="c-btn c-btn-line c-mine-back" onClick={() => setTab('menu')}>Back to menu</button></>}

          <form id="order-form" onSubmit={submit} hidden={tab !== 'menu'}>
            <h1 className="c-h1">Choose your dishes</h1>
            {minOrder > 0 && <p className="c-sub c-min">Minimum order {money(minOrder)}.</p>}
            {reorderNote && <p className="c-note c-reorder" role="status">{reorderNote}</p>}
            {menu === null && <p className="c-note">Loading the menu…</p>}
            {menuError && <p className="c-note c-note-bad">{menuError}</p>}
            {menu && !menu.length && !menuError && <p className="c-note">No dishes are on today's menu yet. Please check back soon.</p>}
            {menu && menu.length > 0 && <div className="c-cats">{menu.length > 15 && <input className="c-input c-dish-search" type="search" aria-label="Search dishes" placeholder="Search dishes" value={dishQ} onChange={e => setDishQ(e.target.value)} />}{groups.length > 1 && <div className="c-chips c-cat-chips" role="navigation" aria-label="Menu sections">{groups.map(([category]) => <button type="button" key={category} className="c-chip" onClick={() => { const el = document.getElementById('cat-' + category.replace(/\s+/g, '-')); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{category}</button>)}</div>}</div>}
            {groups.map(([category, items]) => <section key={category} id={'cat-' + category.replace(/\s+/g, '-')}>
              <h2 className="c-h2 c-cat">{category}</h2>
              <ul className="c-menu">{items.map(d => {
                const hasOpts = needsSheet(d), n = hasOpts ? 0 : (qty[d.id] || 0), left = leftOf(d)
                const out = soldOut(d) || left === 0
                const sub = picked.filter(l => l.dish.id === d.id && hasOpts)
                return <li key={d.id} className={n || sub.length ? 'c-dish on' : out ? 'c-dish sold' : 'c-dish'}>
                  {d.image_url ? <img className="c-dish-photo" src={d.image_url} alt="" loading="lazy" width="160" height="120" /> : <div className="c-dish-photo c-dish-ph" aria-hidden="true"><span>{(d.name || '?').trim().charAt(0).toUpperCase()}</span></div>}
                  <div className="c-dish-main"><span className="c-dish-name">{d.name}</span><span className="c-dish-price">{hasHalf(d) ? `Full ${money(d.selling_price)} · Half ${money(halfPrice(d))}` : <>{hasOpts ? 'from ' : ''}{money(d.selling_price)}</>}</span>{soldOut(d) ? <span className="c-soldout">Sold out today</span> : left === 0 ? <span className="c-soldout">Sold out for this day</span> : left != null && left <= 5 ? <span className="c-left">Only {left} left</span> : null}</div>
                  <div className="c-qty">{out ? null : (n === 0 || hasOpts)
                    ? <button type="button" className="c-add" onClick={() => addDish(d)} aria-label={`Add ${d.name}`} disabled={!canAdd(d)}>Add</button>
                    : <><button type="button" className="c-step" onClick={() => step(d.id, -1)} aria-label={`Remove one ${d.name}`}><Ico n="minus" size={18} /></button><output key={n} className="c-n c-bump" aria-label={`${d.name} quantity`}>{n}</output><button type="button" className="c-step" onClick={() => step(d.id, 1)} aria-label={`Add one more ${d.name}`}><Ico n="plus" size={18} /></button></>}
                  </div>
                  {sub.map(l => <div className="c-subline" key={l.key}><span>{l.label || 'Plain'} · {money(l.unit)}</span><div className="c-qty"><button type="button" className="c-step" onClick={() => step(l.key, -1)} aria-label={`Remove one ${d.name} (${l.label})`}><Ico n="minus" size={18} /></button><output className="c-n" aria-label={`${d.name} (${l.label}) quantity`}>{l.qty}</output><button type="button" className="c-step" onClick={() => step(l.key, 1)} aria-label={`Add one more ${d.name} (${l.label})`} disabled={!canAdd(d)}><Ico n="plus" size={18} /></button></div></div>)}
                </li>
              })}</ul>
            </section>)}

            <h2 className="c-h2 c-cat">Delivery day</h2>
            <p className="c-sub c-sched-note">{r.name} delivers {scheduleLabel(r)}. Choose a day.</p>
            {days === null && <p className="c-note">Checking delivery days…</p>}
            {days && !days.length && <p className="c-note c-note-bad" role="alert">No delivery days are open right now. Please check back soon.</p>}
            {days && days.length > 0 && <div className="c-days" role="radiogroup" aria-label="Delivery day">{days.map(d => { const p = dayParts(d, today); return <label key={d} className={deliveryDate === d ? 'c-day on' : 'c-day'}><input type="radio" name="delivery-day" value={d} checked={deliveryDate === d} onChange={() => setDeliveryDate(d)} /><b>{p.top}</b><span>{p.bottom}</span></label> })}</div>}

            <h2 className="c-h2 c-cat">Delivery details</h2>
            {hasSaved && !editDetails && name.trim() && address.trim() && digits10(phone).length === 10 && <div className="c-deliv-sum"><span>Delivering to <b>{(address.split(',').map(x => x.trim()).filter(Boolean).slice(-2)[0]) || address}</b> · {name.trim().split(' ')[0]} · {digits10(phone).slice(-4).padStart(10, '•')}</span><button type="button" className="c-linkbtn" onClick={() => setEditDetails(true)}>Change</button></div>}
            <div hidden={hasSaved && !editDetails && Boolean(name.trim() && address.trim() && digits10(phone).length === 10)}>
            {hasSaved && <p className="c-saved">Filled in from your last order. <button type="button" className="c-linkbtn" onClick={() => { try { localStorage.removeItem('customer-details') } catch { /* ignore */ } setName(''); setPhone(''); setAddress(''); setHasSaved(false) }}>Not you? Clear</button></p>}
            <label className="c-field"><span>Name</span><input className="c-input" required autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>
            <label className="c-field"><span>Phone number <small>10-digit mobile</small></span><input className="c-input" required maxLength={16} type="tel" inputMode="tel" autoComplete="tel" pattern="[0-9+ \-]{7,20}" title="Enter a valid phone number" value={phone} onChange={e => setPhone(e.target.value)} /></label>
            <label className="c-field"><span>Delivery address</span><textarea className="c-input" required rows={3} autoComplete="street-address" placeholder="House or flat, building, area, landmark" value={address} onChange={e => setAddress(e.target.value)} /></label>
            </div>
            <fieldset className="c-field c-pay"><legend>Payment</legend>
              <div className="c-chips">{PAYMENTS.map(p => <label key={p} className={payment === p ? 'c-chip on' : 'c-chip'}><input type="radio" name="payment" value={p} checked={payment === p} onChange={() => setPayment(p)} />{p}</label>)}</div>
              {payment === 'UPI' && r.upi_id && UPI_RE.test(r.upi_id) && <p className="c-sub c-upi-hint">{distance ? "After the kitchen adds the delivery charge you'll see a QR code and the UPI ID to pay." : "After you place the order you'll see a QR code and the UPI ID to pay."}</p>}
            </fieldset>
            {picked.length > 0 && <div className="c-summary" aria-label="Order summary">
              <div><span>Items</span><b>{money(total)}</b></div>
              {discount > 0 && <div><span>Coupon</span><b>−{money(discount)}</b></div>}
              {distance ? <div><span>Delivery</span><b>Set by the kitchen</b></div> : feeBase > 0 && <div><span>Delivery</span><b>{fee ? money(fee) : 'Free'}</b></div>}
              <div className="c-summary-total"><span>To pay</span><b>{money(payable)}</b></div>
              {!distance && feeBase > 0 && freeAbove != null && fee > 0 && <small>Add {money(freeAbove - total)} more for free delivery.</small>}
              {distance && <small>The kitchen adds a delivery charge based on your distance. You will see it on your order{payment === 'UPI' ? ', and pay then' : ''}.</small>}
            </div>}
            <div className="c-field c-coupon"><span>Coupon code <small>optional</small></span>
              <div className="c-coupon-row"><input className="c-input" aria-label="Coupon code" value={couponText} onChange={e => { setCouponText(e.target.value.toUpperCase()); if (coupon) { setCoupon(null); setCouponMsg('') } }} autoCapitalize="characters" autoCorrect="off" spellCheck="false" maxLength={20} placeholder="e.g. WELCOME50" />
                <button type="button" className="c-btn c-btn-line" disabled={!couponText.trim() || !total} onClick={() => checkCoupon(couponText.trim(), total)}>Apply</button></div>
              {couponMsg && <small className={coupon ? 'c-coupon-ok' : 'c-coupon-bad'} role="status">{couponMsg}{coupon ? ` · you save ${money(discount)}` : ''}</small>}
            </div>
            <label className="c-field"><span>Notes <small>optional</small></span><textarea className="c-input" rows={2} placeholder="Spice level, allergies, delivery instructions" value={notes} onChange={e => setNotes(e.target.value)} /></label>
            {error && <p className="c-note c-note-bad" role="alert">{error}</p>}
          </form>
        </div>}

    {sheet && <OptionSheet dish={sheet} options={optsOf(sheet)} halfPrice={hasHalf(sheet) ? halfPrice(sheet) : null} onClose={() => setSheet(null)} onAdd={(ids) => { step(`${sheet.id}|${ids.slice().sort().join('+')}`, 1); setSheet(null) }} />}
    {isOpen && tab === 'menu' && count > 0 && <div className="c-cart">
      <div className="c-cart-sum"><b>{count} item{count === 1 ? '' : 's'}</b><span key={payable} className="c-bump">{discount > 0 && <s className="c-was">{money(total)}</s>} {money(payable)}</span></div>
      <button form="order-form" className="c-cta c-cta-accent customer-submit" disabled={sending || !deliveryDate || belowMin}>{belowMin ? `Add ${money(minOrder - total)} more` : sending ? 'Placing order…' : 'Place order'}</button>
    </div>}

    {payState && !dialog && !feeState && <div className={payState.status === 'pending' ? 'c-paypop' : 'c-paypop ok'} role="status" aria-live="polite">
      {payState.status === 'pending'
        ? <><span className="c-paypop-dot" aria-hidden="true" /><div><b>{payState.claimed ? 'Payment sent. Waiting for verification' : payState.reason ? 'Payment not verified' : 'Payment confirmation pending'}</b><small>{payState.ref} · {payState.claimed ? `${r.name} is checking your payment and will start cooking once it is verified.` : payState.reason ? `${payState.reason}. Pay again or send the correct transaction ID.` : `Pay, then tap "I've paid". ${r.name} starts cooking once it confirms your UPI payment.`}</small></div></>
        : <><span className="c-paypop-tick" aria-hidden="true">✓</span><div><b>Payment confirmed</b><small>{payState.ref} · The kitchen is getting started.</small></div></>}
    </div>}

    {dialog && placed && <OrderDialog feePending={Boolean(feeState && feeState.status === 'pending')} payStatus={payState && payState.status} payClaimed={Boolean(payState && payState.claimed)} payReason={payState ? payState.reason : ''} onClaimed={onClaimed} r={r} order={placed} copied={copied} onCopy={copyRef} onClose={() => { setDialog(false); setTab('orders'); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />}
  </div>
}

/* Pay by UPI: opens the customer's UPI app with the amount filled in. Shown only when the restaurant has set a UPI ID and the customer chose UPI. */
function QrCode({ text, label }) {
  let m = null
  try { m = qrMatrix(text) } catch { return null }
  const n = m.length, q = 4, d = []
  m.forEach((row, y) => row.forEach((v, x) => { if (v) d.push(`M${x + q} ${y + q}h1v1h-1z`) }))
  return <svg className="c-qr" viewBox={`0 0 ${n + q * 2} ${n + q * 2}`} role="img" aria-label={label} shapeRendering="crispEdges"><rect width="100%" height="100%" fill="#fff" /><path d={d.join('')} fill="#111" /></svg>
}
const UPI_RE = /^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,32}$/
/* The simplest link the UPI apps all accept: only pa, pn, am, cu and tn. The "@" in the UPI ID is left as it is,
   and the name has no "&" or other symbols. Extra fields (such as a transaction ref) make some apps say "request type not supported". */
const upiLink = (r, order) => {
  // Some UPI apps show the name exactly as sent (they do not decode "%20"), so the name has no spaces or symbols.
  const name = String(r.name || 'Kitchen').replace(/&/g, 'and').replace(/[^A-Za-z0-9]/g, '')
  const note = String(order.ref || '').replace(/[^A-Za-z0-9-]/g, '')
  // A personal UPI ID cannot take a pre-filled amount in most apps ("request type not supported"), so leave it out.
  return r.upi_personal ? `upi://pay?pa=${r.upi_id}&pn=${name}&cu=INR` : `upi://pay?pa=${r.upi_id}&pn=${name}&am=${Number(order.total).toFixed(2)}&cu=INR&tn=${note}`
}
/* Choose a size and extras for a dish, then add it to the order. */
function OptionSheet({ dish, options, halfPrice, onClose, onAdd }) {
  const realSizes = options.filter(o => o.kind === 'size'), extras = options.filter(o => o.kind === 'extra')
  const sizes = realSizes.length ? realSizes : halfPrice != null ? [{ id: 'full', name: 'Full plate', price_delta: 0, shown: Number(dish.selling_price) }, { id: 'half', name: 'Half plate', price_delta: 0, shown: halfPrice }] : []
  const [size, setSize] = useState(sizes[0] ? sizes[0].id : ''), [picked, setPicked] = useState([])   // ids of picked extras; the same id twice means two of it
  const countOf = (id) => picked.filter(x => x === id).length, bump = (id, d) => setPicked(p => d > 0 ? (p.length >= 8 ? p : [...p, id]) : (p.includes(id) ? (() => { const i = p.lastIndexOf(id); return [...p.slice(0, i), ...p.slice(i + 1)] })() : p))
  const base = size === 'half' ? halfPrice : Number(dish.selling_price)
  const unit = base + [...(realSizes.length && size ? [size] : []), ...picked].reduce((s, id) => s + Number((options.find(o => o.id === id) || {}).price_delta || 0), 0)
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [])
  const ids = () => [...(realSizes.length ? (size ? [size] : []) : size === 'half' ? ['half'] : []), ...picked]
  return <div className="c-sheet-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="c-sheet" role="dialog" aria-modal="true" aria-label={`Choose options for ${dish.name}`}>
      <h2 className="c-h2">{dish.name}</h2>
      {sizes.length > 0 && <fieldset className="c-opt-group"><legend>Choose a size</legend>{sizes.map(o => <label key={o.id} className={size === o.id ? 'c-opt on' : 'c-opt'}><input type="radio" name="size" checked={size === o.id} onChange={() => setSize(o.id)} /><span>{o.name}</span><b>{o.shown != null ? money(o.shown) : Number(o.price_delta) > 0 ? `+${money(o.price_delta)}` : 'Included'}</b></label>)}</fieldset>}
      {extras.length > 0 && <fieldset className="c-opt-group"><legend>Extras <small>optional</small></legend>{extras.map(o => { const n = countOf(o.id); return <div key={o.id} className={n ? 'c-opt c-opt-x on' : 'c-opt c-opt-x'}><span>{o.name}</span><b>+{money(o.price_delta)}</b><div className="c-qty">{n > 0 && <><button type="button" className="c-step" onClick={() => bump(o.id, -1)} aria-label={`Remove one ${o.name}`}><Ico n="minus" size={16} /></button><output className="c-n" aria-label={`${o.name} quantity`}>{n}</output></>}<button type="button" className="c-step" onClick={() => bump(o.id, 1)} aria-label={`Add ${o.name}`} disabled={picked.length >= 8}><Ico n="plus" size={16} /></button></div></div> })}</fieldset>}
      <div className="c-sheet-foot"><button type="button" className="c-btn c-btn-line" onClick={onClose}>Cancel</button><button type="button" className="c-cta c-cta-accent c-sheet-add" disabled={sizes.length > 0 && !size} onClick={() => onAdd(ids())}>Add · {money(unit)}</button></div>
    </div>
  </div>
}

/* After delivery: 1 to 5 stars and an optional comment. */
function RatingBox({ orderRef, rating, comment, onDone }) {
  const [stars, setStars] = useState(0), [text, setText] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  if (rating) return <p className="c-rated" role="status">Thanks for rating <span className="c-rated-stars" aria-label={`${rating} stars`}>{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>{comment ? ` · “${comment}”` : ''}</p>
  const send = async (e) => {
    e.preventDefault()
    if (!stars || busy || !supabase) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('rate_order', { p_order_number: orderRef, p_rating: stars, p_comment: text.trim() || null })
    setBusy(false)
    if (error) return setErr((error.message || '').replace(/^RATING:\s*/, '') || 'Could not send your rating.')
    onDone && onDone()
  }
  return <form className="c-rate" onSubmit={send}>
    <p className="c-rate-q"><b>How was your order?</b></p>
    <div className="c-stars" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map(n => <button type="button" key={n} role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= stars ? 'on' : ''} onClick={() => setStars(n)}>★</button>)}</div>
    <textarea className="c-input" rows={2} maxLength={300} value={text} onChange={e => setText(e.target.value)} placeholder="Tell us more (optional)" aria-label="Rating comment" />
    {err && <p className="c-note c-note-bad" role="alert">{err}</p>}
    <button className="c-btn c-btn-ink" disabled={!stars || busy}>{busy ? 'Sending…' : 'Send rating'}</button>
  </form>
}

/* "I've paid": the customer can add the UPI transaction ID (optional) and wait while the kitchen verifies the payment. */
function PayClaim({ orderRef, claimed, reason, onDone }) {
  const [txn, setTxn] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const send = async (e) => {
    e.preventDefault()
    if (busy || !supabase) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('claim_payment', { p_order_number: orderRef, p_txn: txn.trim() || null })
    setBusy(false)
    if (error) return setErr((error.message || '').replace(/^PAYMENT:\s*/, '') || 'Could not send. Please try again.')
    setTxn(''); onDone && onDone()
  }
  if (claimed) return <p className="c-claimed" role="status"><b>Payment sent. Waiting for verification.</b> The kitchen has been told and will confirm it shortly.</p>
  return <form className="c-claim" onSubmit={send}>
    {reason && <p className="c-claim-bad" role="alert"><b>Payment not verified:</b> {reason}. Pay again or send the correct transaction ID.</p>}
    <label className="c-claim-field"><span>UPI transaction ID <small>optional</small></span>
      <input className="c-input" aria-label="UPI transaction ID" value={txn} onChange={e => setTxn(e.target.value)} placeholder="e.g. 412345678901" autoCapitalize="characters" autoCorrect="off" spellCheck="false" maxLength={40} /></label>
    {err && <p className="c-note c-note-bad" role="alert">{err}</p>}
    <button className="c-cta c-cta-accent c-claim-btn" disabled={busy}>{busy ? 'Sending…' : "I've paid"}</button>
    <small className="c-claim-note">Tap this after you pay. The transaction ID helps the kitchen find your payment faster.</small>
  </form>
}
function UpiPay({ r, order, show, claimed, reason, onClaimed }) {
  const [copied, setCopied] = useState(false), [copiedAmt, setCopiedAmt] = useState(false)
  if (!show || !r.upi_id || !UPI_RE.test(r.upi_id) || order.payment !== 'UPI') return null
  const link = upiLink(r, order)   // only used inside the QR code
  return <div className="c-upi">
    <p className="c-upi-title">Pay by UPI</p>
    <figure className="c-upi-qr"><QrCode text={link} label={`UPI QR code to pay ${r.name}`} /><figcaption>{r.upi_personal ? 'Scan with any UPI app, then enter the amount below' : 'Scan with any UPI app. The amount is filled in'}</figcaption></figure>
    <div className="c-upi-amount"><span>Amount to pay</span><b>{money(order.total)}</b><button type="button" className="c-btn c-btn-line" onClick={async () => { await copyText(String(Number(order.total).toFixed(2))); setCopiedAmt(true); setTimeout(() => setCopiedAmt(false), 2000) }}>{copiedAmt ? 'Copied' : 'Copy amount'}</button></div>
    <p className="c-upi-id">UPI ID <code>{r.upi_id}</code> <button type="button" className="c-btn c-btn-line" onClick={async () => { await copyText(r.upi_id); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>{copied ? 'Copied' : 'Copy'}</button></p>
    <small className="c-upi-note">You can also copy the UPI ID and amount and pay in your UPI app. Write <b>{order.ref}</b> in the note. After you pay, {r.name} confirms your payment and then starts cooking.</small>
    <PayClaim orderRef={order.ref} claimed={claimed} reason={reason} onDone={onClaimed} />
  </div>
}

/* "Log in" with just a phone number (no OTP): the customer's orders, newest first, a page at a time.
   Tap one to see its items, prices, delivery charge and total. */
const FINAL = ['Delivered', 'Cancelled'], MINE_PAGE = 4
const digits10 = (v) => String(v || '').replace(/\D/g, '').slice(-10)
function MyOrders({ r, all, phone, setPhone, refresh, onPayClaimed }) {
  const [res, setRes] = useState(null), [page, setPage] = useState(0), [sel, setSel] = useState(''), [detail, setDetail] = useState(null), [track, setTrack] = useState(false), [copied, setCopied] = useState(''), [input, setInput] = useState(''), [err, setErr] = useState('')
  const loadList = async () => {
    if (!supabase || !phone) return
    const { data, error } = await supabase.rpc('track_orders_by_phone', { p_phone: phone, p_limit: MINE_PAGE, p_offset: page * MINE_PAGE, p_restaurant: r.slug })
    if (error) return setErr((error.message || '').replace(/^[A-Z_]+:\s*/, ''))
    setErr(''); setRes(data)
  }
  const loadDetail = async () => { if (!supabase || !sel) return; const { data } = await supabase.rpc('track_order', { p_order_number: sel }); if (data) setDetail(data) }
  useEffect(() => { if (refresh) setPage(0) }, [refresh])
  useEffect(() => { setRes(null); loadList() }, [phone, page, refresh])
  useEffect(() => {
    if (!phone || !supabase) return
    const t = setInterval(() => { if (!res || (res.orders || []).some(o => !FINAL.includes(o.status))) loadList() }, 5000)
    return () => clearInterval(t)
  }, [phone, page, res])
  useEffect(() => { setDetail(null); loadDetail() }, [sel])
  useEffect(() => {
    if (!sel || !supabase) return
    const t = setInterval(loadDetail, 5000)
    const k = (e) => { if (e.key === 'Escape') setSel('') }
    document.addEventListener('keydown', k)
    return () => { clearInterval(t); document.removeEventListener('keydown', k) }
  }, [sel])
  const login = (e) => {
    e.preventDefault()
    const v = digits10(input)
    if (v.length !== 10 || !/^[6-9]/.test(v)) return setErr('Enter a valid 10-digit mobile number')
    setErr(''); setPhone(v)
  }
  if (!phone) return <section className="c-mine" aria-label="Your orders">
    <h2 className="c-h2">Your orders</h2>
    <form className="c-mine-login" onSubmit={login}>
      <label className="c-field"><span>Mobile number <small>to see your orders</small></span><input className="c-input" type="tel" inputMode="tel" autoComplete="tel" maxLength={16} value={input} onChange={e => { setInput(e.target.value); setErr('') }} placeholder="10-digit mobile" /></label>
      <button className="c-btn c-btn-line" type="submit">Show my orders</button>
      {err && <p className="c-note c-note-bad" role="alert">{err}</p>}
    </form>
  </section>
  const total = res ? Number(res.total || 0) : 0, pages = Math.max(1, Math.ceil(total / MINE_PAGE)), orders = res ? res.orders || [] : []
  const statusText = (o) => o.status === 'Cancelled' ? 'Cancelled' : o.status === 'New' ? 'Received' : o.status
  const count = (o) => (o.items || []).reduce((s, l) => s + Number(l.quantity || 1), 0)
  const d = sel ? detail : null, rr = d ? (all || []).find(x => x.slug === d.restaurant_slug) || r : r
  const claimed = () => { setDetail(c => c && ({ ...c, payment_claimed: true, payment_reject_reason: null })); onPayClaimed && onPayClaimed(sel) }
  return <section className="c-mine" aria-label="Your orders">
    <h2 className="c-h2">Your orders</h2>
    <p className="c-sub c-mine-who">Signed in as {phone.slice(0, 2)}••••••{phone.slice(-2)} · <button type="button" className="c-linkbtn" onClick={() => { setPhone(''); setRes(null); setSel(''); setInput('') }}>Not you? Sign out</button></p>
    {err && <p className="c-note c-note-bad" role="alert">{err}</p>}
    {res && !orders.length && <p className="c-note">No orders yet for this number. They will show here after you order.</p>}
    <ul className="c-mine-list">
      {orders.map(o => <li key={o.order_number}><button type="button" className="c-mine-row" onClick={() => { setSel(o.order_number); setTrack(false) }}>
        <span className="c-mine-main"><b>{o.order_number}</b><small>{count(o)} item{count(o) === 1 ? '' : 's'} · {money(Number(o.total))}{o.delivery_fee_pending ? ' + delivery' : ''}</small>{o.delivery_fee_pending && <small className="c-mine-wait">Kitchen is adding the delivery charge</small>}</span>
        <span className={o.status === 'Cancelled' ? 'c-mine-status off' : 'c-mine-status'}>{statusText(o)}</span><span aria-hidden="true" className="c-mine-go">›</span>
      </button></li>)}
    </ul>
    {pages > 1 && <nav className="c-mine-pages" aria-label="Order pages"><button type="button" className="c-btn c-btn-line" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</button><span>Page {page + 1} of {pages}</span><button type="button" className="c-btn c-btn-line" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Older</button></nav>}
    {sel && <div className="c-dialog-wrap" onMouseDown={e => { if (e.target === e.currentTarget) setSel('') }}>
      <div className="c-dialog c-mine-dialog" role="dialog" aria-modal="true" aria-label={`Order ${sel}`}>
        {!d ? <p className="c-note">Loading…</p> : (() => {
          const lines = d.lines || [], discount = Number(d.discount || 0), fee = Number(d.delivery_fee || 0), pending = Boolean(d.delivery_fee_pending), cancelled = d.status === 'Cancelled'
          const upiDue = d.payment === 'UPI' && d.payment_status === 'pending' && !pending && !cancelled
          return <>
            <p className="c-dlg-rest">{d.restaurant || r.name}</p>
            <div className="c-dlg-ref"><code>{sel}</code><button type="button" className="c-btn c-btn-ink" onClick={async () => { await copyText(sel); setCopied(sel); setTimeout(() => setCopied(''), 1800) }}>{copied === sel ? 'Copied' : 'Copy'}</button></div>
            <p className="c-mine-status big">{statusText(d)}</p>
            {d.delivery_date && <p className="c-dlg-deliver">Delivery: {deliveryText(d.delivery_date, zonedNow(rr.timezone || 'Asia/Kolkata').date)}</p>}
            <ul className="c-dlg-items" aria-label="Items">
              {lines.map((l, k) => <li key={k}><span>{l.quantity} × {l.name}{l.options ? ` (${l.options})` : ''}</span><span>{money(Number(l.price || 0) * Number(l.quantity || 1))}</span></li>)}
              {discount > 0 && <li><span>Coupon{d.coupon ? ` ${d.coupon}` : ''}</span><span>−{money(discount)}</span></li>}
              {pending ? <li className="c-mine-wait"><span>Delivery</span><span>Kitchen is adding it…</span></li> : (fee > 0 || rr.charge_mode === 'distance') && <li><span>Delivery</span><span>{fee > 0 ? money(fee) : 'Free'}</span></li>}
              <li className="c-mine-total"><span>Total</span><span>{money(Number(d.total))}{pending ? ' + delivery' : ''}</span></li>
            </ul>
            {!cancelled && d.payment && <p className="c-dlg-paywait">{d.payment === 'UPI' ? (d.payment_status === 'pending' ? (pending ? 'UPI: pay once the delivery charge is added' : d.payment_claimed ? 'Payment sent. Waiting for verification' : d.payment_reject_reason ? 'Payment not verified. Please check and send again' : 'UPI payment pending') : 'UPI payment confirmed ✓') : 'Cash on delivery'}</p>}
            {cancelled && d.cancel_reason && <p className="c-note c-note-bad">Cancelled: {d.cancel_reason}</p>}
            <UpiPay r={rr} order={{ ref: sel, total: Number(d.total), payment: 'UPI' }} show={upiDue} claimed={Boolean(d.payment_claimed)} reason={d.payment_reject_reason || ''} onClaimed={claimed} />
            {d.restaurant_slug && !cancelled && <button type="button" className="c-btn c-btn-line c-mine-again" onClick={() => orderAgain(d.restaurant_slug, d.lines)}>Order again</button>}
            <button type="button" className="c-linkbtn c-mine-more" onClick={() => setTrack(t => !t)}>{track ? 'Hide tracking' : 'Track this order'}</button>
            {track && <TrackOrder key={sel} initialRef={sel} compact />}
          </>
        })()}
        <button type="button" className="c-cta c-cta-hero" onClick={() => setSel('')}>Close</button>
      </div>
    </div>}
  </section>
}

/* The centred "order received" confirmation, in the restaurant's own colours */
function OrderDialog({ r, order, copied, onCopy, onClose, payStatus, payClaimed, payReason, onClaimed, feePending }) {
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
      {order.payment === 'UPI' && payStatus === 'pending' && <p className="c-dlg-paywait" role="status">{payClaimed ? 'Payment sent. Waiting for verification' : payReason ? 'Payment not verified' : 'Payment confirmation pending'}</p>}
      {order.payment === 'UPI' && payStatus === 'received' && <p className="c-dlg-paywait ok" role="status">Payment confirmed ✓</p>}
      <p className="c-dlg-line">Your reference is</p>
      <div className="c-dlg-ref"><code>{order.ref}</code><button type="button" className="c-btn c-btn-ink" onClick={onCopy}>{copied ? 'Copied' : 'Copy'}</button></div>
      <p className="c-dlg-total">Total: {money(order.total)}{feePending ? ' + delivery' : ''}</p>
      {order.eta && <p className="c-dlg-deliver">Ready in about {order.eta} minutes</p>}
      {order.discount > 0 && <p className="c-dlg-deliver">Code {order.coupon}: you saved {money(order.discount)}</p>}
      {order.deliveryDate && <p className="c-dlg-deliver">Delivery: {deliveryText(order.deliveryDate, order.today)}</p>}
      {order.items.length > 0 && <ul className="c-dlg-items" aria-label="Your order">{order.items.map((i, k) => <li key={k}><span>{i.quantity} × {i.name}{i.options ? ` (${i.options})` : ''}</span><span>{money(i.price * i.quantity)}</span></li>)}{order.deliveryFee > 0 && <li><span>Delivery</span><span>{money(order.deliveryFee)}</span></li>}</ul>}
      {feePending && <p className="c-dlg-paywait" role="status">The kitchen will add your delivery charge. Close this and keep ordering: the charge shows under Your orders.</p>}
      <UpiPay r={r} order={order} show={payStatus === 'pending' && !feePending} claimed={payClaimed} reason={payReason} onClaimed={onClaimed} />
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
