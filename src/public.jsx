import React, { useEffect, useState } from 'react'
import { supabase } from './supabase'
import logo from './assets/salt-saffron-logo.png'
import './public.css'

const PAYMENTS = ['Cash on delivery', 'UPI', 'Card on delivery', 'Bank transfer']
const STEPS = [['New', 'Received'], ['Cooking', 'Cooking'], ['Ready', 'Ready'], ['Delivered', 'Delivered']]

const icons = {
  back: <path d="M15 5l-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
}
function Ico({ n, size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[n]}</svg>
}

const readSaved = () => { try { return localStorage.getItem('last-order-ref') || '' } catch { return '' } }

async function copyText(text) {
  try { await navigator.clipboard.writeText(text) } catch {
    const box = document.createElement('textarea'); box.value = text; document.body.appendChild(box); box.select()
    try { document.execCommand('copy') } catch { /* ignore */ }
    box.remove()
  }
}

/* ---------- Home ---------- */
export function Landing({ onStaff }) {
  const [savedRef] = useState(readSaved)
  return <div className="c-app c-landing">
    <section className="c-hero">
      <div className="c-hero-top"><img className="c-logo" src={logo} alt="" /><span>Cloud kitchen, Pune</span></div>
      <h1 className="c-wordmark">Salt &amp;<br />Saffron</h1>
      <div className="c-hero-foot">
        <p>Cooked fresh and delivered to your door.</p>
        <a className="c-cta c-cta-ink landing-order" href="/order">Order now</a>
      </div>
    </section>
    <section className="c-track-wrap"><TrackOrder initialRef={savedRef} /></section>
    <button type="button" className="c-staff staff-link" onClick={onStaff}>Staff sign in</button>
  </div>
}

/* ---------- Order tracking ---------- */
export function TrackOrder({ initialRef, compact }) {
  const [code, setCode] = useState(readSaved), [result, setResult] = useState(null), [msg, setMsg] = useState(''), [active, setActive] = useState('')
  const lookup = async (value, quiet) => {
    const ref = (value || '').trim().toUpperCase()
    if (!ref) return
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
        <input className="c-input" value={code} onChange={e => setCode(e.target.value)} placeholder="Reference number" aria-label="Order reference number" autoCapitalize="characters" autoCorrect="off" spellCheck="false" />
        <button className="c-btn c-btn-ink">Track</button>
      </form>
    </>}
    {msg && <p className="c-note">{msg}</p>}
    {result && (result.status === 'Cancelled'
      ? <p className="c-note c-note-bad">Order {result.order_number} was cancelled. Please contact the kitchen.</p>
      : <div className="track-result c-result">
          <div className="c-result-head">{compact ? <span className="c-sub">Order status</span> : <b>{result.order_number}</b>}<span className={result.status === 'Delivered' ? 'c-pill done' : 'c-pill'}>{label}</span></div>
          <ol className="c-steps">{STEPS.map(([status, text], i) => <li key={status} className={i < current ? 'done' : i === current ? 'now' : ''}>{text}</li>)}</ol>
          <p className="c-sub">Total ₹{result.total}. This updates by itself.</p>
        </div>)}
  </div>
}

/* ---------- Customer order page ---------- */
export function CustomerOrderForm() {
  const [menu, setMenu] = useState(null), [menuError, setMenuError] = useState('')
  const [qty, setQty] = useState({})
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [address, setAddress] = useState(''), [payment, setPayment] = useState(PAYMENTS[0]), [notes, setNotes] = useState('')
  const [sending, setSending] = useState(false), [error, setError] = useState(''), [placed, setPlaced] = useState(null)
  const [toast, setToast] = useState(''), [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!supabase) return setMenu([])
    supabase.from('recipes').select('id,name,selling_price,category').eq('is_published', true).order('name').then(({ data, error: err }) => {
      if (err) { setMenuError(`Could not load the menu: ${err.message}`); setMenu([]) } else setMenu(data || [])
    })
  }, [])

  const dishes = menu || []
  const picked = dishes.filter(d => qty[d.id] > 0)
  const count = picked.reduce((n, d) => n + qty[d.id], 0)
  const total = picked.reduce((sum, d) => sum + Number(d.selling_price) * qty[d.id], 0)
  const groups = Object.entries(dishes.reduce((acc, d) => { (acc[d.category || 'Menu'] ||= []).push(d); return acc }, {}))
  const step = (id, delta) => setQty(q => ({ ...q, [id]: Math.max(0, Math.min(50, (q[id] || 0) + delta)) }))

  const copyRef = async () => { if (!placed) return; await copyText(placed.ref); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  const submit = async (e) => {
    e.preventDefault()
    if (sending) return
    if (!picked.length) return setError('Add at least one dish to place an order.')
    if (!supabase) return setError('Ordering is not available right now. Please contact the kitchen.')
    setSending(true); setError('')
    const { data, error: err } = await supabase.rpc('place_order', { p_name: name.trim(), p_phone: phone.trim(), p_address: address.trim(), p_payment: payment, p_notes: notes.trim(), p_items: picked.map(d => ({ recipe_id: d.id, quantity: qty[d.id] })) })
    setSending(false)
    if (err) return setError(`Could not place your order: ${err.message}`)
    const ref = data.order_number
    setPlaced({ ref, total: Number(data.total) })
    setToast(`Order placed. Reference number: ${ref}`)
    setTimeout(() => setToast(''), 60000)
    try { localStorage.setItem('last-order-ref', ref) } catch { /* optional */ }
    setQty({}); setNotes('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return <div className="c-app c-order">
    <header className="c-bar"><a className="c-back" href="/" aria-label="Back to home"><Ico n="back" /></a><span>Salt &amp; Saffron</span></header>
    <div className="c-page">
      {placed && <section className="c-success" aria-live="polite">
        <h2 className="c-h2">Order placed</h2>
        <div className="c-ref-row"><code className="c-ref">{placed.ref}</code><button type="button" className="c-btn c-btn-line" onClick={copyRef}>{copied ? 'Copied' : 'Copy'}</button></div>
        <p className="c-sub">Total ₹{placed.total}. Keep this number to track your order.</p>
        <TrackOrder initialRef={placed.ref} compact />
      </section>}

      <form id="order-form" onSubmit={submit}>
      <h1 className="c-h1">{placed ? 'Order something else' : 'Choose your dishes'}</h1>
      {menu === null && <p className="c-note">Loading the menu…</p>}
      {menuError && <p className="c-note c-note-bad">{menuError}</p>}
      {menu && !menu.length && !menuError && <p className="c-note">No dishes are on today's menu yet. Please check back soon.</p>}
      {groups.map(([category, items]) => <section key={category}>
        <h2 className="c-h2 c-cat">{category}</h2>
        <ul className="c-menu">{items.map(d => {
          const n = qty[d.id] || 0
          return <li key={d.id} className={n ? 'c-dish on' : 'c-dish'}>
            <div className="c-dish-main"><span className="c-dish-name">{d.name}</span><span className="c-dish-price">₹{d.selling_price}</span></div>
            <div className="c-qty">{n === 0
              ? <button type="button" className="c-add" onClick={() => step(d.id, 1)} aria-label={`Add ${d.name}`}>Add</button>
              : <><button type="button" className="c-step" onClick={() => step(d.id, -1)} aria-label={`Remove one ${d.name}`}><Ico n="minus" size={18} /></button><output className="c-n" aria-label={`${d.name} quantity`}>{n}</output><button type="button" className="c-step" onClick={() => step(d.id, 1)} aria-label={`Add one more ${d.name}`}><Ico n="plus" size={18} /></button></>}
            </div>
          </li>
        })}</ul>
      </section>)}

      <h2 className="c-h2 c-cat">Delivery details</h2>
      <label className="c-field"><span>Name</span><input className="c-input" required autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="c-field"><span>Phone number</span><input className="c-input" required type="tel" inputMode="tel" autoComplete="tel" pattern="[0-9+ \-]{7,20}" title="Enter a valid phone number" value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <label className="c-field"><span>Delivery address</span><textarea className="c-input" required rows={3} autoComplete="street-address" placeholder="House or flat, building, area, landmark" value={address} onChange={e => setAddress(e.target.value)} /></label>
      <fieldset className="c-field c-pay"><legend>Payment</legend>
        <div className="c-chips">{PAYMENTS.map(p => <label key={p} className={payment === p ? 'c-chip on' : 'c-chip'}><input type="radio" name="payment" value={p} checked={payment === p} onChange={() => setPayment(p)} />{p}</label>)}</div>
      </fieldset>
      <label className="c-field"><span>Notes <small>optional</small></span><textarea className="c-input" rows={2} placeholder="Spice level, allergies, delivery instructions" value={notes} onChange={e => setNotes(e.target.value)} /></label>
      {error && <p className="c-note c-note-bad" role="alert">{error}</p>}
      </form>
    </div>

    {count > 0 && <div className="c-cart">
      <div className="c-cart-sum"><b>{count} item{count === 1 ? '' : 's'}</b><span>₹{total}</span></div>
      <button form="order-form" className="c-cta c-cta-saffron customer-submit" disabled={sending}>{sending ? 'Placing order…' : 'Place order'}</button>
    </div>}

    {toast && <div className="c-toast" role="status"><span>{toast}</span><button type="button" onClick={copyRef}>{copied ? 'Copied' : 'Copy'}</button><button type="button" className="c-x" aria-label="Dismiss" onClick={() => setToast('')}>×</button></div>}
  </div>
}

/* ---------- Staff sign in ---------- */
export function AdminLogin({ onBack }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [message, setMessage] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    if (!supabase) return setMessage('Sign-in is not available. Add your Supabase URL and anon key to .env.')
    setMessage('Signing in…')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setMessage(error ? `Sign-in failed: ${error.message}` : '')
  }
  return <div className="c-app c-login">
    <header className="c-bar">{onBack ? <button type="button" className="c-back" onClick={onBack} aria-label="Back to home"><Ico n="back" /></button> : <span className="c-back" />}<span>Staff</span></header>
    <form className="c-page" onSubmit={submit}>
      <h1 className="c-h1">Staff sign in</h1>
      <p className="c-sub c-lead">For Salt &amp; Saffron kitchen staff. Customers can order from the home page.</p>
      <label className="c-field"><span>Email</span><input className="c-input" required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@kitchen.com" /></label>
      <label className="c-field"><span>Password</span><input className="c-input" required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button className="c-cta c-cta-ink customer-submit">Sign in</button>
      {message && <p className="c-note" role="status">{message}</p>}
    </form>
  </div>
}
