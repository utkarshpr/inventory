import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useRestaurants, themeStyle, Mark, zonedNow, addDaysIso, dayLabel, dateText, deliveryText, logoFor } from './restaurants'
import { RestaurantSwitcher, OpenToggle, OrderAlerts, RestaurantSettings, LiveStrip, OrderLimitsSettings, AppInstallCard, systemNotify, GoalCard, CouponsSettings, BackupCard, TeamCard, usePaged, Pager, NeedsAttention, HelpPage } from './staffparts'
import './staff.css'
import { AdminLogin, copyText } from './public'
import { FEAST } from './names'
const PAGE_LABEL = { Bulk: FEAST.page }   // the page id stays 'Bulk'; only the visible name changes

const newOrderNumber = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
const mapInventory = (rows) => (rows || []).map(i => ({ id:i.id, name:i.name, stock:Number(i.current_stock), unit:i.unit, reorder:Number(i.reorder_level), cost:Number(i.unit_cost) }))
const ingredientLabel = (i) => [i.ingredient_name, [i.quantity, i.unit].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
const rowToView = (r) => ({ name:r.ingredient_name, quantity:r.quantity, unit:r.unit, inventoryId:r.inventory_item_id })
const parseIngredientLines = (text, inventory) => String(text || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
  const [name, ...rest] = line.split(/\s*[|·]\s*/)
  const tail = rest.join(' ').trim()
  const m = tail.match(/^(\d*\.?\d+)\s*(.*)$/)
  const match = inventory.find(i => i.name.trim().toLowerCase() === name.trim().toLowerCase())
  return { ingredient_name: name.trim(), quantity: m ? Number(m[1]) : null, unit: m ? (m[2].trim() || null) : (tail || null), inventory_item_id: match ? match.id : null }
})
const orderLines = (o) => (Array.isArray(o.items) ? o.items : []).map(item => {
  if (typeof item === 'string') { const m = item.match(/(\d+)×\s*(.*)/); return { name: (m ? m[2] : item).trim(), quantity: m ? Number(m[1]) : 1, price: null } }
  return item && item.name ? { name: String(item.name), quantity: Number(item.quantity) || 1, price: item.price == null ? null : Number(item.price), options: item.options ? String(item.options) : '' } : null
}).filter(Boolean)
const daysAgo = (iso, n) => { if (!iso) return false; const d = new Date(iso), t = new Date(); t.setDate(t.getDate() - n); return d.toDateString() === t.toDateString() }
function analyse(orders, recipes) {
  const byName = Object.fromEntries(recipes.map(r => [r.name.toLowerCase(), r]))
  const list = orders.filter(o => o.status !== 'Cancelled' && o.paymentStatus !== 'pending')   // UPI orders count once the payment is confirmed
  const dishes = {}
  let sales = 0, cost = 0
  for (const o of list) {
    sales += Number(o.total) || 0
    for (const l of orderLines(o)) {
      if (l.name.startsWith('Note:')) continue
      const r = byName[l.name.toLowerCase()]
      const price = l.price != null ? l.price : (r ? r.price : 0)
      const d = dishes[l.name] || (dishes[l.name] = { name: l.name, qty: 0, revenue: 0 })
      d.qty += l.quantity; d.revenue += price * l.quantity
      if (r) cost += r.price * (r.foodCost / 100) * l.quantity
    }
  }
  const count = list.length
  return { sales, count, aov: count ? Math.round(sales / count) : 0, cost, profit: sales - cost, foodPct: sales ? Math.round(cost / sales * 1000) / 10 : 0, dishes: Object.values(dishes).sort((a, b) => b.qty - a.qty) }
}
const mapOrder = (o) => ({ kind:o.kind || 'normal', bulk:o.bulk || null, id:o.order_number, restaurantId:o.restaurant_id, deliveryDate:o.delivery_date, cancelReason:o.cancel_reason || '', paymentStatus:o.payment_status || 'not_required', deliveryFee:Number(o.delivery_fee || 0), deliveryFeePending:Boolean(o.delivery_fee_pending), rating:o.rating || 0, ratingComment:o.rating_comment || '', paymentClaimedAt:o.payment_claimed_at || '', paymentTxn:o.payment_txn_id || '', paymentRejectReason:o.payment_reject_reason || '', phone:o.customer_phone || '', customer:o.customer_name || 'Walk-in guest', channel:o.channel, total:Number(o.total), time:new Date(o.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }), status:o.status, items:o.items || [], address:o.delivery_address || '', payment:o.payment_method || '', placed:new Date(o.created_at).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }), createdAt:o.created_at, avatar:(o.customer_name || 'WG').split(' ').map(x=>x[0]).join('').slice(0,2) })
// Orders are listed by delivery date: today and later first (soonest first), then earlier days (most recent first)
const deliveryKey = (o) => o.deliveryDate || (o.createdAt ? o.createdAt.slice(0, 10) : '')
// Every admin list: the order placed most recently is on top, whatever its status or delivery day
const sortByDelivery = (list) => [...list].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
function CopyButton({ text, label = 'Copy', aria = 'Copy', className = 'copy-mini' }) {
  const [done, setDone] = useState(false)
  return <button type="button" className={className} disabled={!text} aria-label={aria} onClick={async (e) => { e.stopPropagation(); await copyText(text); setDone(true); setTimeout(() => setDone(false), 1800) }}>{done ? 'Copied' : label}</button>
}
const ticketBrand = { name: 'Kitchen', review: '', logo: '', tagline: '', location: '', help: '' }  // set by the dashboard to the restaurant being managed
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
/* WhatsApp message to the customer about their order (opens WhatsApp with the text ready; staff press send) */
const customerPhone = (o) => { const d = String(o.phone || (String(o.customer || '').split('·')[1] || '')).replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(d) ? d : '' }
function whatsappLink(o, rname) {
  const phone = customerPhone(o); if (!phone) return ''
  const first = String(o.customer || '').split('·')[0].trim().split(' ')[0] || 'there'
  const lines = orderLines(o).filter(l => !String(l.name).startsWith('Note:'))
  const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
  const itemLines = lines.map(l => `• ${l.quantity} × ${l.name}${l.options ? ` (${l.options})` : ''}${l.price ? ` — ${money(Number(l.price) * Number(l.quantity || 1))}` : ''}`)
  const itemsSum = lines.reduce((s, l) => s + Number(l.price || 0) * Number(l.quantity || 1), 0)
  const fee = Number(o.deliveryFee || 0), total = Number(o.total || 0)
  const discount = itemsSum > 0 ? Math.max(0, Math.round(itemsSum + fee - total)) : 0
  const day = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  const cod = /cash/i.test(o.payment || '')
  const pay = o.status === 'Cancelled' ? '' : o.paymentStatus === 'received' ? `Paid ✓${o.payment ? ` (${o.payment})` : ''}` : o.paymentStatus === 'pending' ? 'UPI payment not confirmed yet' : cod ? (o.status === 'Delivered' ? 'Cash on delivery' : `Please pay ${money(total)} in cash on delivery`) : (o.payment || '')
  const head = {
    New: `thank you for your order! We have received it.${o.paymentStatus === 'pending' ? ' We will start cooking as soon as your UPI payment is confirmed.' : ''}`,
    Cooking: 'your order is being prepared now.',
    Ready: 'your order is ready and will be on its way shortly.',
    Delivered: 'your order has been delivered. We hope you enjoy it!',
    Cancelled: `we are sorry, your order has been cancelled.${o.cancelReason ? ` Reason: ${o.cancelReason}.` : ''}`,
  }[o.status] || `an update on your order ${o.id}.`
  const text = [
    `*${rname}*`,
    `Hi ${first}, ${head}`,
    '',
    `Order: ${o.id}`,
    o.placed || o.time ? `Ordered: ${o.placed || o.time}` : '',
    o.deliveryDate ? `Delivery: ${day(o.deliveryDate)}` : '',
    '',
    'Items:',
    ...itemLines,
    '',
    discount > 0 ? `Discount: −${money(discount)}` : '',
    o.deliveryFeePending ? 'Delivery charge: will be added by the kitchen' : fee > 0 ? `Delivery charge: ${money(fee)}` : 'Delivery charge: Free',
    `*Total: ${money(total)}${o.deliveryFeePending ? ' + delivery' : ''}*`,
    pay ? `Payment: ${pay}` : '',
    '',
    o.status === 'Delivered' && ticketBrand.review ? `Enjoyed it? Please review us on Google: ${ticketBrand.review}` : '',
    'Please come back again! 🙏',
    `— ${rname}`,
  ].filter((l, i, arr) => l !== '' || (arr[i - 1] !== '' && i > 0)).join('\n')
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`
}
/* Printed pages: the restaurant's logo as a faint background, a header, and the order laid out so it can be read at a glance. */
const PRINT_CSS = `*{box-sizing:border-box;margin:0;padding:0}body{font:12px/1.35 'Courier New',Courier,monospace;width:220px;margin:0;padding:4px 4px 10px;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head{text-align:center;padding:4px 0 5px;border-bottom:2px solid #000;margin-bottom:4px}
.head .brand{font-size:16px;font-weight:900;letter-spacing:.04em;line-height:1.1}
.head .sub{font-size:10px;margin-top:1px}
.ref{display:flex;justify-content:space-between;font-weight:900;font-size:14px;margin:4px 0 2px}
.tag{font-size:10px;font-weight:700;text-transform:uppercase;border:1px solid #000;padding:0 4px;display:inline-block}
.when{font-weight:800;font-size:12px;margin:3px 0}
.box{border:2px solid #000;padding:3px 5px;margin:4px 0;font-weight:800;text-align:center;font-size:11px;word-break:break-all}
.sec{margin:3px 0;font-size:11px}.sec .l{font-size:9px;text-transform:uppercase;letter-spacing:.07em}
.addr{font-size:11px;font-weight:700;word-break:break-word;white-space:pre-wrap}
hr{border:0;border-top:1px dashed #000;margin:4px 0}
table{width:100%;border-collapse:collapse;font-size:11px}th{font-size:9px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #000;padding:2px 0;text-align:left}
td{padding:3px 0 2px;vertical-align:top;border-bottom:1px dotted #bbb;line-height:1.25}
.q{width:26px;font-weight:900}.r{text-align:right;white-space:nowrap}.n{word-break:break-word}
.opt{font-size:10px;display:block}
.note{border:1px dashed #000;padding:3px 5px;margin:3px 0;font-weight:800;font-size:11px;word-break:break-word}
.tot table{margin-top:3px}.tot td{border:0;padding:1px 0;font-size:12px}.tot .grand td{border-top:2px solid #000;font-size:14px;font-weight:900;padding-top:3px}
.meta{font-size:10px;color:#000;margin:3px 0}
.foot{text-align:center;margin-top:6px;padding-top:5px;border-top:1px dashed #000;font-size:10px;line-height:1.5}.foot b{font-size:12px;display:block}
@page{margin:2mm;size:58mm auto}@media print{body{width:58mm}}`
const printDoc = (title, bodyHtml) => {
  const w = window.open('', '_blank', 'width=320,height=820')
  if (!w) { window.alert('Please allow pop-ups to print.'); return null }
  const sub = [ticketBrand.tagline, ticketBrand.location].filter(Boolean).join(' · ')
  const toolbar = `<style>.tb{display:flex;gap:6px;justify-content:center;padding:8px 4px 4px;border-bottom:1px solid #ccc;margin-bottom:6px;background:#f5f5f5}@media print{.tb{display:none}}.btn{font:bold 11px sans-serif;border:1px solid #888;border-radius:4px;padding:4px 10px;cursor:pointer;background:#fff}.btn:hover{background:#eee}</style><div class="tb"><button class="btn" onclick="window.print()">🖨 Print / Save PDF</button><button class="btn" id="imgBtn">📷 Save as Image</button></div>`
  const h2c = `<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>`
  const dl = `<script>document.getElementById('imgBtn').onclick=function(){const el=document.getElementById('ticket');html2canvas(el,{scale:3,useCORS:true,backgroundColor:'#fff'}).then(c=>{const a=document.createElement('a');a.download=${JSON.stringify(title)}+'.png';a.href=c.toDataURL('image/png');a.click()})}<\/script>`
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style>${h2c}</head><body>${toolbar}<div id="ticket"><div class="head"><div class="brand">${esc(ticketBrand.name)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>${bodyHtml}</div>${dl}</body></html>`)
  w.document.close(); w.focus()
  return w
}
function printTicket(o) {
  const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
  const all = orderLines(o), notes = all.filter(l => String(l.name).startsWith('Note:')), lines = all.filter(l => !String(l.name).startsWith('Note:'))
  const sub = lines.reduce((t, l) => t + Number(l.price || 0) * Number(l.quantity || 1), 0), fee = Number(o.deliveryFee || 0), total = Number(o.total || 0)
  const discount = sub > 0 ? Math.max(0, Math.round(sub + fee - total)) : 0
  const plates = lines.reduce((t, l) => t + Number(l.quantity || 1), 0)
  const b = o.bulk || {}, isBig = o.kind === 'bulk'
  const adv = isBig && Number(b.advance) > 0 && (b.advance_received || (o.payment === 'UPI' && o.paymentStatus === 'received')) ? Number(b.advance) : 0
  const cash = /cash/i.test(o.payment || '')
  const payText = o.status === 'Cancelled' ? 'CANCELLED' : o.paymentStatus === 'received' ? `PAID · ${esc(o.payment || 'UPI')}${adv ? ` (advance ${money(adv)}, balance ${money(Math.max(0, total - adv))} on delivery)` : ''}` : o.paymentStatus === 'pending' ? 'UPI NOT PAID YET' : cash ? `COLLECT ${money(Math.max(0, total - adv))} IN CASH` : esc(o.payment || '')
  const rows = lines.map(l => `<tr><td class="q">${esc(l.quantity)}×</td><td>${esc(l.name)}${l.options ? `<span class="opt">${esc(l.options)}</span>` : ''}</td><td class="r">${l.price ? money(Number(l.price) * Number(l.quantity || 1)) : ''}</td></tr>`).join('')
  const extra = [b.slot && `Time: ${esc(b.slot)}`, b.guests && `Guests: ${esc(b.guests)}`, b.spice && `Spice: ${esc(b.spice)}`].filter(Boolean).join(' · ')
  const phone = customerPhone(o)
  const body = `<div class="ref"><div class="no">${esc(o.id)}</div><div class="tag">${isBig ? 'Big Table' : esc(o.channel || 'Order')}</div></div>
<div class="when">Deliver: ${esc(deliveryText(o.deliveryDate, ''))}</div>
${extra ? `<div class="meta">${extra}</div>` : ''}
<div class="box">${payText}</div>
<div class="sec"><div class="l">Customer</div><b>${esc(String(o.customer || '').split('·')[0].trim() || 'Guest')}</b>${phone ? ` · ${esc(phone)}` : ''}</div>
${o.address ? `<div class="sec"><div class="l">Deliver to</div><div class="addr">${esc(o.address)}</div></div>` : ''}
<table><thead><tr><th>Qty</th><th>Item</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
${notes.map(n => `<div class="note">${esc(String(n.name).replace(/^Note:\s*/, 'NOTE: '))}</div>`).join('')}
<table class="tot"><tr><td>Items (${plates})</td><td class="r">${money(sub)}</td></tr>${discount ? `<tr><td>Discount</td><td class="r">−${money(discount)}</td></tr>` : ''}<tr><td>Delivery</td><td class="r">${o.deliveryFeePending ? 'to be added' : fee ? money(fee) : 'Free'}</td></tr><tr class="grand"><td>Total</td><td class="r">${money(total)}</td></tr></table>
<div class="meta">Placed ${esc(o.placed || o.time || '')} · Status: ${esc(o.status)}</div>
<div class="foot"><b>Thank you! Please come back again.</b>${/^\d{10,15}$/.test(ticketBrand.help) ? `<div>Need help? WhatsApp +${esc(ticketBrand.help)}</div>` : ''}</div>`
  printDoc(o.id, body)
}
// One shared audio context: browsers keep sound blocked until the first tap, so we unlock it early and show when it is not ready.
let audioCtx = null
const getAudio = () => { try { const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return null; if (!audioCtx) audioCtx = new Ctx(); return audioCtx } catch { return null } }
function unlockAudio() { const ctx = getAudio(); if (ctx && ctx.state === 'suspended') ctx.resume(); return ctx }
const audioReady = () => !!audioCtx && audioCtx.state === 'running'
function playBeep() {
  try {
    const ctx = unlockAudio()
    if (!ctx) return
    ;[0, 0.22].forEach((delay, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.value = i ? 1046 : 784
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay)
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + delay + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.2)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.22)
    })
  } catch { /* sound is optional */ }
}


function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M4 19a2 2 0 0 1 2-2h14"/></>,
    boxes: <><path d="m12 2 8 4.4v9.2L12 20l-8-4.4V6.4L12 2Z"/><path d="m4 6.4 8 4.4 8-4.4M12 10.8V20"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    users: <><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.4c1.8.8 3 2.6 3 5.6"/></>,
    rupee: <><path d="M7 5h10M7 9.5h10M7 5c6 0 6 8 0 8l7 6"/></>,
    pot: <><path d="M4 11h16v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6Z"/><path d="M2 11h20M8 8V5M12 8V3M16 8V5"/></>,
    gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.3 2.3-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56v.1h-3.25v-.1a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.3-2.3.06-.06A1.7 1.7 0 0 0 6.4 15a1.7 1.7 0 0 0-1.56-1.04h-.1v-3.25h.1A1.7 1.7 0 0 0 6.4 9.67a1.7 1.7 0 0 0-.34-1.88L6 7.73l2.3-2.3.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.04-1.56v-.1h3.25v.1a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.3 2.3-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04h.1v3.25h-.1A1.7 1.7 0 0 0 19.4 15Z"/></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>, search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>, bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>, more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>, arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>, close: <><path d="m6 6 12 12M18 6 6 18"/></>, calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function Brand({ r }) { return <div className="brand salt-brand"><Mark r={r} size={36} /></div> }


function App() {
  const [session, setSession] = useState(undefined)
  const [page, setPage] = useState('Overview'), [role, setRole] = useState(supabase ? null : 'owner')
  const [orders, setOrders] = useState([])
  const [recipeList, setRecipeList] = useState([])
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [inventory, setInventory] = useState([])
  const [modal, setModal] = useState(null)
  const [editingOrder, setEditingOrder] = useState(null)
  const [editingRecipe, setEditingRecipe] = useState(null)
  const [editingItem, setEditingItem] = useState(null)
  const [channelFilter, setChannelFilter] = useState('All channels')
  const [dateFilter, setDateFilter] = useState('All dates')
  const [soundOn, setSoundOn] = useState(() => { try { return localStorage.getItem('kitchen-sound') !== '0' } catch { return true } })
  const soundRef = useRef(soundOn)
  const [snoozeUntil, setSnoozeUntil] = useState(0), [, setTick] = useState(0)   // sound paused for a while (15 minutes, or until morning)
  useEffect(() => { if (!snoozeUntil) return; const t = setInterval(() => { if (Date.now() >= snoozeUntil) setSnoozeUntil(0); else setTick(x => x + 1) }, 15000); return () => clearInterval(t) }, [snoozeUntil])
  const snoozed = snoozeUntil > Date.now()
  const reloadRef = useRef(null)
  useEffect(() => { soundRef.current = soundOn && !(snoozeUntil > Date.now()); try { localStorage.setItem('kitchen-sound', soundOn ? '1' : '0') } catch { /* optional */ } }, [soundOn, snoozeUntil])
  useEffect(() => { const base = document.title; const reset = () => { if (!document.hidden) document.title = base }; document.addEventListener('visibilitychange', reset); window.addEventListener('focus', reset); return () => { document.removeEventListener('visibilitychange', reset); window.removeEventListener('focus', reset) } }, [])
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [orderFilter, setOrderFilter] = useState('All orders')
  const { list: restaurants, setList: setRestaurants } = useRestaurants()
  const [activeSlug, setActiveSlug] = useState(() => { try { return localStorage.getItem('active-restaurant') || '' } catch { return '' } })
  const active = (restaurants || []).find(r => r.slug === activeSlug) || (restaurants || [])[0] || null
  const activeRef = useRef(null); activeRef.current = active
  const restaurantsRef = useRef([]); restaurantsRef.current = restaurants
  const alertedRef = useRef(new Set()), lastSeenRef = useRef(Date.now())
  const todayIso = active ? zonedNow(active.timezone || 'Asia/Kolkata').date : ''
  const [alerts, setAlerts] = useState([]), [highlight, setHighlight] = useState(''), [closeDialog, setCloseDialog] = useState(null)
  const [live, setLive] = useState(true), [audioOk, setAudioOk] = useState(audioReady()), [secrets, setSecrets] = useState(null), [limits, setLimits] = useState(null), [goal, setGoal] = useState(null)
  const [awake, setAwake] = useState(() => { try { return localStorage.getItem('keep-awake') !== '0' } catch { return true } })
  const awakeSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  const knownRef = useRef(null), liveRef = useRef(true), lastLoadRef = useRef(0)
  useEffect(() => { if (active) document.title = `${active.name} · Kitchen` }, [active && active.slug])
  useEffect(() => {   // unlock sound on the first tap, and keep the strip honest
    const unlock = () => { unlockAudio(); setTimeout(() => setAudioOk(audioReady()), 400) }   // update the strip after the tap has finished, so the page does not jump under the finger
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock)
    const timer = setInterval(() => setAudioOk(audioReady()), 2000)
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); clearInterval(timer) }
  }, [])
  useEffect(() => {   // keep the screen awake while the dashboard is open (the browser releases it whenever the tab is hidden)
    if (!awakeSupported || !awake || !session) return
    let sentinel = null, cancelled = false
    const acquire = async () => { try { if (document.visibilityState !== 'visible') return; sentinel = await navigator.wakeLock.request('screen'); if (cancelled) sentinel.release() } catch { /* not allowed right now */ } }
    acquire()
    const onVisible = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); if (sentinel) { try { sentinel.release() } catch { /* already released */ } } }
  }, [awake, Boolean(session)])
  useEffect(() => {   // a new order stays audible until someone deals with it
    if (!alerts.length) return
    const timer = setInterval(() => { if (soundRef.current) playBeep() }, 25000)
    return () => clearInterval(timer)
  }, [alerts.length > 0])
  useEffect(() => {   // coming back to the screen (or the network) picks up anything missed meanwhile
    if (!session) return
    const catchUp = () => { if (document.visibilityState === 'visible' && reloadRef.current && Date.now() - lastLoadRef.current > 5000) reloadRef.current() }
    document.addEventListener('visibilitychange', catchUp); window.addEventListener('online', catchUp)
    return () => { document.removeEventListener('visibilitychange', catchUp); window.removeEventListener('online', catchUp) }
  }, [Boolean(session)])
  useEffect(() => {   // what this signed-in person may do: owner, cook or delivery
    if (!supabase || !session) return
    supabase.rpc('my_role').then(({ data }) => setRole(data || 'owner'))
  }, [Boolean(session)])
  const loadGoal = () => { if (!supabase) return; supabase.rpc('goal_progress').then(({ data }) => { if (data) setGoal(data) }) }
  useEffect(() => {   // combined sales goal: refresh on the overview, when this restaurant's orders change, and every minute
    if (!session || page !== 'Overview') return
    loadGoal()
    const t = setInterval(loadGoal, 60000)
    return () => clearInterval(t)
  }, [page === 'Overview', Boolean(session), orders.length, orders.map(o => o.status).join('')])
  const saveGoal = async (fields) => { if (supabase) { const { error } = await supabase.from('sales_goal').upsert({ id: true, ...fields }); if (error) return notify(`Could not save the goal: ${error.message}`) } loadGoal(); notify('Goal saved') }
  useEffect(() => {   // order limits (shared by both restaurants) for the settings page
    if (!session || page !== 'Settings') return
    const defaults = { per_phone_hour: 3, per_phone_day: 8, per_connection_hour: 20 }
    if (!supabase) return setLimits(defaults)
    let alive = true
    supabase.from('order_limits').select('*').maybeSingle().then(({ data }) => { if (alive) setLimits(data || defaults) })
    return () => { alive = false }
  }, [page === 'Settings', Boolean(session)])
  useEffect(() => {   // private settings for the settings page
    setSecrets(null)
    if (!session || !active || page !== 'Settings') return
    if (!supabase) return setSecrets({ alert_topic: null })
    let alive = true
    supabase.from('restaurant_secrets').select('*').eq('restaurant_id', active.id).maybeSingle().then(({ data }) => { if (alive) setSecrets(data || { alert_topic: null }) })
    return () => { alive = false }
  }, [active && active.id, page === 'Settings', Boolean(session)])
  useEffect(() => { if (!highlight) return; const t = setTimeout(() => setHighlight(''), 4000); return () => clearTimeout(t) }, [highlight])
  const defaultSettings = { kitchenName: '', location: '', currency: 'INR (₹)', taxRate: '5' }
  const [settings, setSettings] = useState(defaultSettings)
  useEffect(() => {   // kitchen profile is kept per restaurant
    if (!active) return
    const base = { ...defaultSettings, kitchenName: active.name }
    try { const saved = localStorage.getItem(`kitchen-settings:${active.slug}`); setSettings({ ...base, ...(saved ? JSON.parse(saved) : {}), kitchenName: active.name, location: active.location || '' }) }
    catch { setSettings({ ...base, location: active.location || '' }) }
  }, [active && active.slug, active && active.location])
  useEffect(() => {
    if (!supabase) return setSession(null)
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => subscription.unsubscribe()
  }, [])
  // A new customer order alerts staff whichever restaurant is open. The alert names the restaurant it is for.
  const raiseAlert = (order, rest) => {
    if (alertedRef.current.has(order.id)) return
    alertedRef.current.add(order.id)
    setAlerts(a => [{ key: order.id + '-' + Date.now(), restaurantId: rest.id, order, lines: orderLines(order), today: zonedNow(rest.timezone || 'Asia/Kolkata').date }, ...a].slice(0, 8))
    if (soundRef.current) { playBeep(); if (order.kind === 'bulk') { setTimeout(playBeep, 400); setTimeout(playBeep, 800) } }   // bulk orders: a triple beep
    systemNotify(order, rest.name, order.kind === 'bulk' ? 'New BIG TABLE order' : 'New order')
    if (document.hidden) document.title = `🔔 New ${order.kind === 'bulk' ? 'BIG TABLE ' : ''}order · ${rest.name}`
  }
  // A customer pressed "I've paid": a UPI payment waits for staff to verify. Sound + popup, for either restaurant.
  const raiseVerify = (order, rest) => {
    const key = `claim:${order.id}:${order.paymentClaimedAt}`
    if (alertedRef.current.has(key)) return
    alertedRef.current.add(key)
    setAlerts(a => [{ key, kind: 'verify', restaurantId: rest.id, order, lines: orderLines(order), today: zonedNow(rest.timezone || 'Asia/Kolkata').date }, ...a.filter(x => !(x.kind === 'verify' && x.order.id === order.id))].slice(0, 8))
    if (soundRef.current) playBeep()
    systemNotify(order, rest.name, 'Verify payment')
    if (document.hidden) document.title = `🔔 Verify payment · ${rest.name}`
  }
  const dropVerify = (orderId) => setAlerts(a => a.filter(x => !(x.kind === 'verify' && x.order.id === orderId)))
  const catchUpOthers = async (activeId) => {   // orders for the other restaurant that arrived while we were away or offline
    if (!supabase) return
    const since = new Date(lastSeenRef.current - 120000).toISOString()
    const { data, error } = await supabase.from('orders').select('*').in('channel', ['Customer form', 'Bulk order']).eq('status', 'New').gt('created_at', since)
    if (error || !data) return
    data.filter(o => o.restaurant_id !== activeId).forEach(o => { const rest = restaurantsRef.current.find(x => x.id === o.restaurant_id); if (rest) raiseAlert(mapOrder(o), rest) })
    const claims = await supabase.from('orders').select('*').eq('payment_status', 'pending').gt('payment_claimed_at', since)   // payments claimed while we were away, either restaurant
    if (!claims.error && claims.data) claims.data.forEach(o => { const rest = restaurantsRef.current.find(x => x.id === o.restaurant_id); if (rest) raiseVerify(mapOrder(o), rest) })
  }
  useEffect(() => {   // remember when we were last connected, so a catch-up knows how far back to look
    const t = setInterval(() => { if (liveRef.current) lastSeenRef.current = Date.now() }, 30000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (!supabase || !session || !active || !active.id) return
    const rid = active.id
    setOrders([]); setOlderDone(false); setRecipeList([]); setSelectedRecipe(null); setInventory([])
    const loadKitchenData = async () => {
      lastLoadRef.current = Date.now()
      const [ordersResult, recipesResult, inventoryResult] = await Promise.all([
        supabase.from('orders').select('*').eq('restaurant_id', rid).or(`created_at.gte.${new Date(Date.now() - 60 * 864e5).toISOString()},delivery_date.gte.${new Date(Date.now() - 864e5).toISOString().slice(0, 10)},status.in.(New,Cooking,Ready)`).order('created_at', { ascending: false }).limit(1000),
        supabase.from('recipes').select('*, recipe_ingredients(*), recipe_options(*)').eq('restaurant_id', rid).order('created_at', { ascending: false }),
        supabase.from('inventory_items').select('*').eq('restaurant_id', rid).order('name')
      ])
      if (activeRef.current && activeRef.current.id !== rid) return  // switched restaurant while loading
      if (!ordersResult.error) {
        const mapped = (ordersResult.data || []).map(mapOrder)
        const prev = knownRef.current
        if (prev && prev.restaurantId === rid) {   // a reload after being away or offline: alert for customer orders we have not seen yet
          const fresh = mapped.filter(o => !prev.ids.has(o.id) && ['Customer form', 'Bulk order'].includes(o.channel) && o.status === 'New')
          const rest = activeRef.current
          if (rest) fresh.forEach(o => raiseAlert(o, rest))
          catchUpOthers(rid)
        }
        mapped.forEach(o => alertedRef.current.add(o.id))   // already on screen, so never alert for these later
        lastSeenRef.current = Date.now()
        knownRef.current = { restaurantId: rid, ids: new Set(mapped.map(o => o.id)) }
        setOrders(mapped)
      }
      if (!recipesResult.error) {
        const list = (recipesResult.data || []).map((r, index) => ({ id:r.id, name:r.name, category:r.category || 'Mains', diet:r.diet || '', time:`${r.prep_minutes || 0} min`, foodCost:Number(r.food_cost || 0), price:Number(r.selling_price || 0), isPublished:Boolean(r.is_published), dailyLimit:r.daily_limit == null ? '' : r.daily_limit, halfPlate:Boolean(r.half_plate), options:(r.recipe_options || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)), soldOutDate:r.sold_out_date || '', imageUrl:r.image_url || '', stock:'Good', color:['coral','olive','violet'][index % 3], emoji:'🍽️', ingredients:(r.recipe_ingredients || []).map(ingredientLabel), ingredientRows:(r.recipe_ingredients || []).map(rowToView), steps:(r.instructions || '').split('\n').filter(Boolean) }))
        setRecipeList(list); setSelectedRecipe(current => list.find(r => current && r.id === current.id) || list[0] || null)
      }
      if (!inventoryResult.error) setInventory(mapInventory(inventoryResult.data))
    }
    reloadRef.current = loadKitchenData
    loadKitchenData()
  }, [active && active.id, Boolean(session)])
  useEffect(() => {   // live updates from BOTH restaurants
    if (!supabase || !session) return
    const refreshInventory = () => { const rid = activeRef.current && activeRef.current.id; if (!rid) return; supabase.from('inventory_items').select('*').eq('restaurant_id', rid).order('name').then(({ data, error }) => { if (!error) setInventory(mapInventory(data)) }) }
    const channel = supabase.channel('kitchen-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, payload => {
        const o = payload.new, mapped = mapOrder(o)
        lastSeenRef.current = Date.now()
        const owner = restaurantsRef.current.find(x => x.id === o.restaurant_id)
        if (!owner) return
        if (['Customer form', 'Bulk order'].includes(o.channel)) raiseAlert(mapped, owner)   // alerts for BOTH restaurants, whichever one is open
        const rest = activeRef.current
        if (!rest || o.restaurant_id !== rest.id) return   // the order list, badges and stock only ever show the open restaurant
        setOrders(current => current.some(x => x.id === mapped.id) ? current : [{ ...mapped, time: 'Just now' }, ...current])
        if (knownRef.current && knownRef.current.restaurantId === rest.id) knownRef.current.ids.add(mapped.id)
        refreshInventory()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, payload => {
        const o = payload.new
        const owner = restaurantsRef.current.find(x => x.id === o.restaurant_id)
        if (owner && o.payment_status === 'pending' && o.payment_claimed_at && o.status !== 'Cancelled') raiseVerify(mapOrder(o), owner)   // both restaurants
        else if (o.payment_status !== 'pending' || !o.payment_claimed_at || o.status === 'Cancelled') dropVerify(o.order_number)           // handled elsewhere
        if (activeRef.current && o.restaurant_id && o.restaurant_id !== activeRef.current.id) return
        setOrders(current => current.map(x => x.id === o.order_number ? { ...x, status:o.status, total:Number(o.total), paymentStatus:o.payment_status || x.paymentStatus, deliveryFee:Number(o.delivery_fee || 0), deliveryFeePending:Boolean(o.delivery_fee_pending), rating:o.rating || 0, ratingComment:o.rating_comment || '', paymentClaimedAt:o.payment_claimed_at || '', paymentTxn:o.payment_txn_id || '', paymentRejectReason:o.payment_reject_reason || '' } : x))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, payload => { const rest = activeRef.current, row = (payload.new && payload.new.restaurant_id) ? payload.new : payload.old; if (rest && (!row || !row.restaurant_id || row.restaurant_id === rest.id)) refreshInventory() })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') { const wasDown = liveRef.current === false; liveRef.current = true; setLive(true); if (wasDown && reloadRef.current) reloadRef.current() }   // back online: fetch what we missed
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) { liveRef.current = false; setLive(false) }
      })
    return () => { supabase.removeChannel(channel) }
  }, [Boolean(session)])
  const formatItems = (items) => Array.isArray(items) ? items.map(item => typeof item === 'string' ? item : `${item.quantity}× ${item.name}${item.options ? ` (${item.options})` : ''}`).join(' · ') : items
  const normalOrders = useMemo(() => orders.filter(o => o.kind !== 'bulk'), [orders])   // bulk orders have their own page
  const bulkOrders = useMemo(() => orders.filter(o => o.kind === 'bulk'), [orders])
  const filtered = useMemo(() => sortByDelivery(normalOrders.filter(o => {
    const textMatch = `${o.customer} ${o.id} ${o.phone || ''} ${o.address || ''} ${formatItems(o.items)}`.toLowerCase().includes(query.toLowerCase())
    const statusMatch = orderFilter === 'All orders' || o.status === orderFilter
    const channelMatch = channelFilter === 'All channels' || o.channel === channelFilter
    const dk = deliveryKey(o)
    const dateMatch = dateFilter === 'All dates' || (dateFilter === 'Today' ? dk === todayIso : dateFilter === 'Tomorrow' ? dk === addDaysIso(todayIso, 1) : dateFilter === 'Upcoming' ? dk > todayIso : dk < todayIso)
    return textMatch && statusMatch && channelMatch && dateMatch
  }), todayIso), [normalOrders, query, orderFilter, channelFilter, dateFilter, todayIso])
  const notify = (text) => { setToast(text); setTimeout(() => setToast(''), 2600) }
  const nav = [['Overview', 'grid'], ['Orders', 'receipt'], ['Payments', 'rupee'], ['To cook', 'pot'], ['Recipes', 'book'], ['Inventory', 'boxes'], ['Customers', 'users'], ['Bulk', 'boxes'], ['Reports', 'chart'], ['Help', 'book']]
  const SECONDARY = ['Recipes', 'Inventory', 'Customers', 'Bulk', 'Reports', 'Help']   // under "More" on phones
  const ROLE_PAGES = { cook: ['Orders', 'To cook', 'Bulk'], delivery: ['Orders', 'Payments', 'Bulk'], none: [] }
  const isOwner = role === 'owner'   // until we know who is signed in, show nothing owner-only
  const allowed = (p) => p === 'Help' || isOwner || (ROLE_PAGES[role] || []).includes(p)
  const navItems = nav.filter(([l]) => allowed(l))
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => { if (role && !isOwner && !allowed(page)) setPage((ROLE_PAGES[role] || [])[0] || 'Orders') }, [role, page])
  const setStatus = async (id, status, reason = '') => { const cancel_reason = status === 'Cancelled' ? reason : null; if(supabase){const {error}=await supabase.from('orders').update({status, cancel_reason}).eq('order_number',id);if(error)return notify(`Could not update status: ${error.message}`)} setOrders(current => current.map(o => o.id === id ? {...o, status, cancelReason: cancel_reason || ''} : o)); notify(`Order updated to ${status}`) }
  const [cancelFor, setCancelFor] = useState(null)
  const [payFor, setPayFor] = useState(null)   // { order, then } : asking staff to confirm a UPI payment
  const confirmPayment = async (order, then) => {
    const at = new Date().toISOString()
    if (supabase) { const { error } = await supabase.from('orders').update({ payment_status: 'received', payment_confirmed_at: at }).eq('order_number', order.id); if (error) return notify(`Could not confirm the payment: ${error.message}`) }
    setOrders(cur => cur.map(o => o.id === order.id ? { ...o, paymentStatus: 'received' } : o)); setPayFor(null); dropVerify(order.id)
    if (then) await setStatus(order.id, then); else notify(`Payment confirmed for ${order.id}. You can start cooking.`)
  }
  const setCashPaid = async (order, paid) => {   // cash (and other non-UPI) orders: staff note that the money was collected
    const fields = paid ? { payment_status: 'received', payment_confirmed_at: new Date().toISOString() } : { payment_status: 'not_required', payment_confirmed_at: null }
    if (supabase) { const { error } = await supabase.from('orders').update(fields).eq('order_number', order.id); if (error) return notify(`Could not update the payment: ${error.message}`) }
    setOrders(cur => cur.map(o => o.id === order.id ? { ...o, paymentStatus: fields.payment_status } : o))
    notify(paid ? `Cash received for ${order.id}` : `${order.id} marked as not paid`)
  }
  const [chargeFor, setChargeFor] = useState(null), [sheetOpen, setSheetOpen] = useState(false)
  const saveCharge = async (order, fee) => {
    if (supabase) {
      const { data, error } = await supabase.rpc('set_delivery_charge', { p_order_number: order.id, p_fee: fee })
      if (error) return notify((error.message || '').replace(/^CHARGE:\s*/, '') || 'Could not set the delivery charge')
      setOrders(cur => cur.map(o => o.id === order.id ? { ...o, total: Number(data.total), deliveryFee: Number(data.delivery_fee), deliveryFeePending: false } : o))
      notify(`Delivery charge ₹${data.delivery_fee} added to ${order.id}. New total ₹${data.total}.`)
    } else { setOrders(cur => cur.map(o => o.id === order.id ? { ...o, total: o.total - o.deliveryFee + fee, deliveryFee: fee, deliveryFeePending: false } : o)); notify('Delivery charge saved') }
    setChargeFor(null)
  }
  const [rejectFor, setRejectFor] = useState(null)   // an order whose UPI payment staff want to reject
  const rejectPayment = async (order, reason) => {
    if (supabase) { const { error } = await supabase.from('orders').update({ payment_claimed_at: null, payment_reject_reason: reason }).eq('order_number', order.id); if (error) return notify(`Could not reject the payment: ${error.message}`) }
    setOrders(cur => cur.map(o => o.id === order.id ? { ...o, paymentClaimedAt: '', paymentRejectReason: reason } : o)); setRejectFor(null); setPayFor(null); dropVerify(order.id)
    notify(`Payment rejected for ${order.id}. The customer can see why.`)
  }
  const requestStatus = (id, status) => {
    if (status === 'Cancelled') return setCancelFor(id)
    const o = orders.find(x => x.id === id)
    if (o && o.paymentStatus === 'pending' && ['Cooking', 'Ready', 'Delivered'].includes(status)) return setPayFor({ order: o, then: status })
    setStatus(id, status)
  }
  const saveOrder = async (details) => { const lines = details.items.filter(item => item.name.trim() && Number(item.quantity) > 0).map(item => ({ name: item.name.trim(), quantity: Number(item.quantity) })); if (!lines.length) return notify('Add at least one item'); const order = { id: newOrderNumber(active.order_prefix || 'ORD'), customer: details.customer, phone: details.phone, channel: details.channel, total: Number(details.total), time: 'Just now', placed: 'Just now', createdAt: new Date().toISOString(), deliveryDate: details.deliveryDate, status: 'New', items: lines, address: details.address || '', payment: details.payment || 'Cash on delivery', avatar: details.customer.split(' ').map(x=>x[0]).join('').slice(0,2) }; if (supabase) { const { error } = await supabase.from('orders').insert({ restaurant_id: active.id, order_number: order.id, customer_name: order.customer, customer_phone: order.phone, channel: order.channel, total: order.total, status: order.status, items: order.items, delivery_address: order.address, delivery_date: order.deliveryDate, payment_method: order.payment }); if (error) return notify(`Could not save order: ${error.message}`) }; setOrders([order, ...orders]); setModal(null); notify(supabase ? 'Order saved to Supabase' : 'New order added') }
  const updateOrder = async (details) => { const lines = details.items.filter(item => item.name.trim() && Number(item.quantity) > 0).map(item => ({ name: item.name.trim(), quantity: Number(item.quantity), ...(item.price != null ? { price: item.price } : {}) })); if (!lines.length) return notify('Add at least one item'); const updated = { ...editingOrder, customer: details.customer, phone: details.phone, channel: details.channel, total: Number(details.total), items: lines, address: details.address || '', deliveryDate: details.deliveryDate || editingOrder.deliveryDate, payment: details.payment || editingOrder.payment || 'Cash on delivery', avatar: details.customer.split(' ').map(x=>x[0]).join('').slice(0,2) }; if (supabase) { const { error } = await supabase.from('orders').update({ customer_name: updated.customer, customer_phone: updated.phone, channel: updated.channel, total: updated.total, items: lines, delivery_address: updated.address, delivery_date: updated.deliveryDate, payment_method: updated.payment }).eq('order_number', updated.id); if (error) return notify(`Could not update order: ${error.message}`) }; setOrders(current => current.map(order => order.id === updated.id ? updated : order)); setEditingOrder(null); notify(supabase ? 'Order updated in Supabase' : 'Order updated') }
  const saveRecipe = async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const rows=parseIngredientLines(f.get('ingredients'),inventory), steps=f.get('steps').split('\n').filter(Boolean); const record={name:f.get('name'),category:f.get('category') || 'Mains',diet:f.get('diet') || null,prep_minutes:parseInt(f.get('time')) || 0,selling_price:Number(f.get('price')),food_cost:Number(f.get('foodCost') || 0),instructions:steps.join('\n'),is_published:f.get('isPublished')==='on'}; let recipeId=Date.now(); if(supabase){const {data,error}=await supabase.from('recipes').insert({ ...record, restaurant_id: active.id }).select().single();if(error)return notify(`Could not save recipe: ${error.message}`);recipeId=data.id;const {error:ingredientError}=await supabase.from('recipe_ingredients').insert(rows.map(r=>({recipe_id:data.id,...r})));if(ingredientError)return notify(`Recipe saved, but ingredients failed: ${ingredientError.message}`)} const newRecipe={id:recipeId,name:record.name,category:record.category,time:`${record.prep_minutes} min`,price:record.selling_price,foodCost:record.food_cost,isPublished:record.is_published,stock:'Good',color:'coral',emoji:'🍽️',ingredients:rows.map(ingredientLabel),ingredientRows:rows.map(rowToView),steps};setRecipeList(list=>[...list,newRecipe]);setSelectedRecipe(newRecipe);setModal(null);notify('Recipe and menu price saved') }
  const patchRecipe = (id, fields) => { setRecipeList(list => list.map(x => x.id === id ? { ...x, ...fields } : x)); setSelectedRecipe(cur => cur && cur.id === id ? { ...cur, ...fields } : cur) }
  const toggleSoldOut = async (recipe) => {
    const date = recipe.soldOutDate === todayIso ? null : todayIso
    if (supabase) { const { error } = await supabase.from('recipes').update({ sold_out_date: date }).eq('id', recipe.id); if (error) return notify(`Could not update: ${error.message}`) }
    patchRecipe(recipe.id, { soldOutDate: date || '' }); notify(date ? `${recipe.name} is sold out for today` : `${recipe.name} is available again`)
  }
  const shrinkImage = async (file) => {   // phone photos are huge: resize to 800px and compress before uploading
    const draw = (src, w, h) => new Promise((resolve, reject) => {
      const s = Math.min(1, 800 / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s))
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height)
      c.toBlob(b => b ? resolve(b) : reject(new Error('Could not process that photo')), 'image/jpeg', 0.82)
    })
    if (window.createImageBitmap) { try { const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); const out = await draw(bmp, bmp.width, bmp.height); if (bmp.close) bmp.close(); return out } catch { /* try the older way below */ } }
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('NODECODE')); i.src = url })
      return await draw(img, img.naturalWidth || img.width, img.naturalHeight || img.height)
    } catch (e) {
      throw new Error(/heic|heif/i.test(`${file.type} ${file.name}`) ? 'This browser cannot read HEIC photos. On iPhone use Safari, or choose a JPG/PNG (Settings → Camera → Formats → Most Compatible).' : 'This browser could not read that photo. Try a JPG or PNG.')
    } finally { URL.revokeObjectURL(url) }
  }
  const dishPhotoPath = (url) => { const m = (url || '').match(/\/dish-photos\/(.+)$/); return m ? decodeURIComponent(m[1]) : null }
  const uploadPhoto = async (recipe, file) => {
    if (!file) return
    if (file.type && !/^image\//.test(file.type)) return notify('Please choose a photo')
    if (!supabase) return notify('Photos need Supabase')
    try {
      const blob = await shrinkImage(file), path = `${active.id}/${recipe.id}-${Date.now()}.jpg`
      const { error } = await supabase.storage.from('dish-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (error) return notify(`Could not upload: ${error.message}`)
      const url = supabase.storage.from('dish-photos').getPublicUrl(path).data.publicUrl
      const { error: e2 } = await supabase.from('recipes').update({ image_url: url }).eq('id', recipe.id)
      if (e2) return notify(`Could not save the photo: ${e2.message}`)
      const old = dishPhotoPath(recipe.imageUrl); if (old) supabase.storage.from('dish-photos').remove([old])
      patchRecipe(recipe.id, { imageUrl: url }); notify('Photo saved')
    } catch (e) { notify(e.message || 'Could not add the photo') }
  }
  const removePhoto = async (recipe) => {
    if (supabase) { const { error } = await supabase.from('recipes').update({ image_url: null }).eq('id', recipe.id); if (error) return notify(`Could not remove: ${error.message}`); const old = dishPhotoPath(recipe.imageUrl); if (old) supabase.storage.from('dish-photos').remove([old]) }
    patchRecipe(recipe.id, { imageUrl: '' }); notify('Photo removed')
  }
  const saveLimit = async (recipe, text) => {
    const v = String(text).trim() === '' ? null : Math.max(0, Math.floor(Number(text)))
    if (v !== null && Number.isNaN(v)) return notify('Enter a number of plates, or leave it empty for no limit')
    if (supabase) { const { error } = await supabase.from('recipes').update({ daily_limit: v }).eq('id', recipe.id); if (error) return notify(`Could not save the limit: ${error.message}`) }
    patchRecipe(recipe.id, { dailyLimit: v == null ? '' : v }); notify(v == null ? `${recipe.name}: no daily limit` : `${recipe.name}: ${v} plates a day`)
  }
  const toggleHalf = async (recipe) => {
    const on = !recipe.halfPlate
    if (supabase) { const { error } = await supabase.from('recipes').update({ half_plate: on }).eq('id', recipe.id); if (error) return notify(`Could not update: ${error.message}`) }
    patchRecipe(recipe.id, { halfPlate: on }); notify(on ? `Half plate on for ${recipe.name}` : `Half plate off for ${recipe.name}`)
  }
  const addOption = async (recipe, opt) => {
    const row = { recipe_id: recipe.id, kind: opt.kind, name: opt.name.trim(), price_delta: Number(opt.price) || 0, sort_order: (recipe.options || []).length + 1 }
    let saved = { id: 'tmp' + Date.now(), ...row }
    if (supabase) { const { data, error } = await supabase.from('recipe_options').insert(row).select().single(); if (error) return notify(`Could not add the option: ${error.message}`); saved = data }
    patchRecipe(recipe.id, { options: [...(recipe.options || []), saved] }); notify(`Added ${row.name}`)
  }
  const removeOption = async (recipe, opt) => {
    if (supabase) { const { error } = await supabase.from('recipe_options').delete().eq('id', opt.id); if (error) return notify(`Could not remove: ${error.message}`) }
    patchRecipe(recipe.id, { options: (recipe.options || []).filter(o => o.id !== opt.id) }); notify(`Removed ${opt.name}`)
  }
  const togglePublished = async (recipe) => { const isPublished=!recipe.isPublished; if(supabase){const {error}=await supabase.from('recipes').update({is_published:isPublished}).eq('id',recipe.id);if(error)return notify(`Could not update menu: ${error.message}`)} setRecipeList(list=>list.map(item=>item.id===recipe.id?{...item,isPublished}:item));notify(isPublished ? `${recipe.name} published to today’s menu` : `${recipe.name} removed from today’s menu`) }
  const updateRecipe = async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const rows=parseIngredientLines(f.get('ingredients'),inventory), steps=f.get('steps').split('\n').filter(Boolean); const record={name:f.get('name'),category:f.get('category') || 'Mains',diet:f.get('diet') || null,prep_minutes:parseInt(f.get('time')) || 0,selling_price:Number(f.get('price')),food_cost:Number(f.get('foodCost') || 0),instructions:steps.join('\n'),is_published:f.get('isPublished')==='on'}; if(supabase){const {error}=await supabase.from('recipes').update(record).eq('id',editingRecipe.id);if(error)return notify(`Could not update recipe: ${error.message}`);const {error:delError}=await supabase.from('recipe_ingredients').delete().eq('recipe_id',editingRecipe.id);if(delError)return notify(`Could not update ingredients: ${delError.message}`);const {error:insError}=await supabase.from('recipe_ingredients').insert(rows.map(r=>({recipe_id:editingRecipe.id,...r})));if(insError)return notify(`Could not update ingredients: ${insError.message}`)} const updated={...editingRecipe,name:record.name,category:record.category,time:`${record.prep_minutes} min`,price:record.selling_price,foodCost:record.food_cost,isPublished:record.is_published,ingredients:rows.map(ingredientLabel),ingredientRows:rows.map(rowToView),steps}; setRecipeList(list=>list.map(r=>r.id===updated.id?updated:r)); setSelectedRecipe(updated); setEditingRecipe(null); notify('Recipe updated') }
  const deleteRecipe = async () => { if(!window.confirm(`Delete "${editingRecipe.name}"?`)) return; if(supabase){const {error}=await supabase.from('recipes').delete().eq('id',editingRecipe.id);if(error)return notify(`Could not delete recipe: ${error.message}`)} const remaining=recipeList.filter(r=>r.id!==editingRecipe.id); setRecipeList(remaining); setSelectedRecipe(remaining[0] || null); setEditingRecipe(null); notify('Recipe deleted') }
  const readInventoryForm = (form) => { const f = new FormData(form); return { name: String(f.get('name')).trim(), current_stock: Number(f.get('stock')), unit: f.get('unit'), reorder_level: Number(f.get('reorder')), unit_cost: Number(f.get('cost')) } }
  const toItem = (id, r) => ({ id, name: r.name, stock: r.current_stock, unit: r.unit, reorder: r.reorder_level, cost: r.unit_cost })
  const saveInventory = async (e) => { e.preventDefault(); const record = readInventoryForm(e.currentTarget); let id = Date.now(); if (supabase) { const { data, error } = await supabase.from('inventory_items').insert({ ...record, restaurant_id: active.id }).select().single(); if (error) return notify(`Could not save ingredient: ${error.message}`); id = data.id } setInventory(list => [...list.filter(i => i.id !== id), toItem(id, record)].sort((a, b) => a.name.localeCompare(b.name))); setModal(null); notify('Ingredient saved') }
  const updateInventory = async (e) => { e.preventDefault(); const record = readInventoryForm(e.currentTarget); if (supabase) { const { error } = await supabase.from('inventory_items').update({ ...record, updated_at: new Date().toISOString() }).eq('id', editingItem.id); if (error) return notify(`Could not update ingredient: ${error.message}`) } setInventory(list => list.map(i => i.id === editingItem.id ? toItem(editingItem.id, record) : i).sort((a, b) => a.name.localeCompare(b.name))); setEditingItem(null); notify('Ingredient updated') }
  const deleteInventory = async () => { if (!window.confirm(`Delete "${editingItem.name}"?`)) return; if (supabase) { const { error } = await supabase.from('inventory_items').delete().eq('id', editingItem.id); if (error) return notify(`Could not delete ingredient: ${error.message}`) } setInventory(list => list.filter(i => i.id !== editingItem.id)); setEditingItem(null); notify('Ingredient deleted') }
  const pickRestaurant = (slug) => { setActiveSlug(slug); try { localStorage.setItem('active-restaurant', slug) } catch { /* optional */ } setModal(null); setEditingOrder(null); setEditingRecipe(null); setEditingItem(null); setCloseDialog(null); setQuery(''); setChannelFilter('All channels'); setDateFilter('All dates'); setHighlight('') }
  const setOpen = async (open, message) => { if (supabase) { const { error } = await supabase.from('restaurants').update({ is_open: open, closed_message: open ? null : (message || null) }).eq('id', active.id); if (error) return notify(`Could not update ${active.name}: ${error.message}`) } setRestaurants(list => list.map(r => r.id === active.id ? { ...r, is_open: open, closed_message: open ? null : (message || null) } : r)); notify(`${active.name} is now ${open ? 'open' : 'closed'}`) }
  const [olderDone, setOlderDone] = useState(false)
  const loadOlder = async () => {   // orders before the last 60 days are fetched only when asked for
    if (!supabase) return setOlderDone(true)
    const oldest = orders.reduce((a, o) => (o.createdAt && (!a || o.createdAt < a) ? o.createdAt : a), '')
    let q = supabase.from('orders').select('*').eq('restaurant_id', active.id).order('created_at', { ascending: false }).limit(200)
    if (oldest) q = q.lt('created_at', oldest)
    const { data, error } = await q
    if (error) return notify(`Could not load older orders: ${error.message}`)
    const rows = (data || []).map(mapOrder)
    setOrders(list => { const seen = new Set(list.map(x => x.id)); return [...list, ...rows.filter(x => !seen.has(x.id))] })
    if (rows.length < 200) setOlderDone(true)
    notify(rows.length ? `Loaded ${rows.length} older orders` : 'No older orders')
  }
  const markAdvance = async (o) => {   // staff received the advance (cash or UPI)
    const bulk = { ...(o.bulk || {}), advance_received: !(o.bulk && o.bulk.advance_received) }
    if (supabase) { const { error } = await supabase.from('orders').update({ bulk }).eq('order_number', o.id); if (error) return notify(`Could not update: ${error.message}`) }
    setOrders(list => list.map(x => x.id === o.id ? { ...x, bulk } : x)); notify(bulk.advance_received ? `Advance received for ${o.id}` : `Advance undone for ${o.id}`)
  }
  const saveRestaurantSettings = async (fields, secretFields) => { if (supabase) { const { error } = await supabase.from('restaurants').update(fields).eq('id', active.id); if (error) return notify(`Could not save settings: ${error.message}`); if (secretFields) { const { error: secretError } = await supabase.from('restaurant_secrets').upsert({ restaurant_id: active.id, ...secretFields }); if (secretError) return notify(`Saved, but phone alerts failed: ${secretError.message}`); setSecrets(secretFields) } } setRestaurants(list => list.map(r => r.id === active.id ? { ...r, ...fields } : r)); notify(`Settings saved for ${active.name}`) }
  const saveLimits = async (fields) => { if (supabase) { const { error } = await supabase.from('order_limits').upsert({ id: true, ...fields }); if (error) return notify(`Could not save the order limits: ${error.message}`) } setLimits(l => ({ ...l, ...fields })); notify('Order limits saved') }
  const toggleOpen = () => active.is_open ? setCloseDialog({ message: '' }) : setOpen(true)
  const dismissAlert = (key) => setAlerts(a => a.filter(x => x.key !== key))
  const viewAlert = (a) => { const r = restaurants.find(x => x.id === a.restaurantId); if (r && (!active || r.id !== active.id)) pickRestaurant(r.slug); setPage('Orders'); setHighlight(a.order.id); dismissAlert(a.key) }
  ticketBrand.name = active ? active.name : ''
  ticketBrand.review = active ? active.review_url || '' : ''
  ticketBrand.logo = active ? logoFor(active.slug) || '' : ''; ticketBrand.tagline = active ? active.tagline || '' : ''; ticketBrand.location = active ? active.location || '' : ''; ticketBrand.help = active ? active.help_whatsapp || '' : ''
  const todayOrders = orders.filter(o => daysAgo(o.createdAt, 0)), yesterdayOrders = orders.filter(o => daysAgo(o.createdAt, 1))   // sales include bulk orders
  const today = analyse(todayOrders, recipeList), yesterday = analyse(yesterdayOrders, recipeList)
  const pct = (a, b) => b ? `${a >= b ? '↑' : '↓'} ${Math.abs(Math.round((a - b) / b * 100))}%` : 'New'
  const activeCount = orders.filter(o => ['New', 'Cooking', 'Ready'].includes(o.status)).length
  const lowStock = inventory.filter(i => i.stock <= i.reorder)
  const deliveredToday = todayOrders.filter(o => o.status === 'Delivered').length
  const progressPct = todayOrders.length ? Math.round(deliveredToday / todayOrders.length * 100) : 0
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date())), greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const OWNER_NAMES = { 'salt-and-saffron': 'Utkarsh P.', 'oven-and-chives': 'Rashmi R.' }, ownerName = (active && OWNER_NAMES[active.slug]) || 'Utkarsh P.'
  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  if (session === undefined) return <div className="auth-loading">Checking secure workspace…</div>
  if (!session) return <AdminLogin />
  if (!active) return <div className="auth-loading">Loading restaurants…</div>
  return <div className="app-shell" data-page={page} style={themeStyle(active.slug)}>
    <aside className="sidebar">
      <Brand r={active}/>
      <nav>{navItems.map(([label, icon]) => <button className={`${page === label ? 'nav active' : 'nav'}${SECONDARY.includes(label) ? ' secondary' : ''}`} onClick={() => setPage(label)} key={label}><Icon name={icon}/>{PAGE_LABEL[label] || label}{label==='Orders' && <em>{orders.filter(o=>o.status==='New').length}</em>}</button>)}{navItems.some(([l]) => SECONDARY.includes(l)) && <button className={`nav nav-more${SECONDARY.includes(page) ? ' active' : ''}`} onClick={() => setMoreOpen(true)}><Icon name="more"/>More</button>}</nav>
      <div className="sidebar-bottom">{isOwner && <button className={page === 'Settings' ? 'nav active' : 'nav'} onClick={() => setPage('Settings')}><Icon name="gear"/>Settings</button>}<button className="profile" onClick={() => supabase.auth.signOut()}><div className="avatar mauve">UK</div><div><b>{session.user.email}</b><small>Sign out</small></div><span>···</span></button></div>
    </aside>
    <main>
      <div className="rest-bar"><RestaurantSwitcher list={restaurants} active={active} onPick={pickRestaurant}/>{isOwner && <OpenToggle r={active} onToggle={toggleOpen}/>}</div>
      <LiveStrip snoozed={snoozed} snoozeUntil={snoozeUntil} onSnooze={(mins) => { const d = new Date(); const until = mins ? Date.now() + mins * 60000 : (() => { const t = new Date(d); t.setHours(6, 0, 0, 0); if (t <= d) t.setDate(t.getDate() + 1); return t.getTime() })(); setSnoozeUntil(until); notify(mins ? `New-order sound paused for ${mins} minutes` : 'New-order sound paused until 6 am') }} onResume={() => { setSnoozeUntil(0); notify('New-order sound is back') }} live={live} soundOn={soundOn} soundReady={audioOk} onSound={() => { setSoundOn(on => !on); notify(soundOn ? 'New-order sound off' : 'New-order sound on') }} onUnlock={() => { unlockAudio(); setAudioOk(audioReady()); playBeep() }} awake={awake} awakeSupported={awakeSupported} onAwake={() => setAwake(a => { const next = !a; try { localStorage.setItem('keep-awake', next ? '1' : '0') } catch { /* optional */ } return next })}/>
      {!active.is_open && <div className="closed-banner" role="status"><b>{active.name} is closed.</b> Customers see a "closed" message and can't order until you reopen it.</div>}
      <header><div><p className="eyebrow">{todayLabel}</p><h1>{page === 'Overview' ? `${greeting}, ${ownerName}` : (PAGE_LABEL[page] || page)}</h1></div><div className="header-actions"><button className="icon-btn desktop-only" onClick={() => { setPage('Orders'); setTimeout(()=>document.querySelector('.search input')?.focus(),0) }} aria-label="Search orders"><Icon name="search"/></button><button className={soundOn ? 'icon-btn notification' : 'icon-btn notification muted'} onClick={() => { setSoundOn(on => !on); notify(soundOn ? 'New-order sound off' : 'New-order sound on') }} title={soundOn ? 'New-order sound is on' : 'New-order sound is off'} aria-label="Toggle new-order sound"><Icon name="bell"/>{soundOn && <i/>}</button>{isOwner && <button className="icon-btn mobile-only" onClick={() => setPage('Settings')} aria-label="Settings"><Icon name="gear"/></button>}<button className="icon-btn mobile-only" onClick={() => supabase.auth.signOut()} aria-label="Sign out"><Icon name="logout"/></button><button className="primary" onClick={() => setModal('order')}><Icon name="plus" size={17}/> New order</button></div></header>
      <div key={page + (active ? active.slug : '')} className="page-in">{role === null ? <p className="no-results">Loading…</p> : role === 'none' ? <section className="panel no-access"><h3>No access yet</h3><p>Your account does not have a role. Ask the owner to give you one in Settings → Team.</p></section> : page === 'Overview' ? <>
        <section className="hero"><div><span className="hero-kicker">TODAY’S PULSE</span><h2>Keep the kitchen moving.</h2><p>You have <b>{activeCount} active order{activeCount === 1 ? '' : 's'}</b>{lowStock.length ? ` and ${lowStock.length} ingredient${lowStock.length === 1 ? '' : 's'} running low.` : ' and your stock levels look healthy.'}</p><button onClick={() => setPage('Orders')}>View active orders <Icon name="arrow" size={16}/></button></div><div className="hero-doodles"><span>✦</span><strong>☀</strong><i>✳</i></div></section>
        {goal && <GoalCard goal={goal} onSave={saveGoal}/>}
        <NeedsAttention orders={orders} inventory={inventory} go={setPage}/>
        <section className="stats"><Stat label="Today's sales" value={`₹${today.sales.toLocaleString('en-IN')}`} change={pct(today.sales, yesterday.sales)}/><Stat label="Orders" value={today.count} change={pct(today.count, yesterday.count)}/><Stat label="Avg. order value" value={`₹${today.aov}`} change={pct(today.aov, yesterday.aov)}/><Stat label="Food cost" value={`${today.foodPct}%`} change={yesterday.sales ? `${today.foodPct <= yesterday.foodPct ? '↓' : '↑'} ${Math.abs(Math.round((today.foodPct - yesterday.foodPct) * 10) / 10)}%` : 'est.'} good={today.foodPct <= yesterday.foodPct}/></section>
        <section className="content-grid"><div className="panel orders-panel"><div className="panel-heading"><div><h3>Live orders <span className="live-dot">●</span></h3><p>Orders requiring attention</p></div><button className="text-btn" onClick={() => setPage('Orders')}>See all <Icon name="arrow" size={15}/></button></div><OrderTable orders={sortByDelivery(normalOrders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled'), todayIso).slice(0,3)} onStatus={requestStatus} onEdit={setEditingOrder} formatItems={formatItems} highlight={highlight} today={todayIso} rname={active.name} onPay={o => setPayFor({ order: o, then: null })} onCharge={setChargeFor} distance={active.charge_mode === 'distance'}/></div><div className="panel insights"><div className="panel-heading"><div><h3>Kitchen insights</h3><p>Things worth your attention</p></div><button className="more" title="Refresh data" aria-label="Refresh data" onClick={() => { reloadRef.current && reloadRef.current(); notify('Data refreshed') }}><Icon name="more"/></button></div>{lowStock.slice(0, 2).map(i => <div className="insight amber" key={i.id}><span>⚠</span><div><b>{i.name} running low</b><p>{i.stock} {i.unit} left · reorder at {i.reorder} {i.unit}</p></div><button onClick={() => setPage('Inventory')}>View</button></div>)}{today.dishes[0] ? <div className="insight lilac"><span>↗</span><div><b>{today.dishes[0].name} is leading today</b><p>{today.dishes[0].qty} sold so far today.</p></div></div> : null}{!lowStock.length && !today.dishes[0] && <div className="insight lilac"><span>✓</span><div><b>All quiet</b><p>Stock looks healthy and no orders yet today.</p></div></div>}<div className="prep"><div><span>ORDER PROGRESS</span><b>{progressPct}% delivered</b></div><div className="progress"><i style={{ width: `${progressPct}%` }}/></div><p>{deliveredToday} of {todayOrders.length} orders today delivered</p></div></div></section>
        <section className="recipe-section"><div className="section-title"><div><h2>Menu intelligence</h2><p>Recipes at a glance — keep your margins healthy.</p></div><button className="text-btn" onClick={() => setPage('Recipes')}>Recipe library <Icon name="arrow" size={15}/></button></div><div className="recipe-cards">{recipeList.slice(0,3).map(r => <RecipeCard key={r.id} r={r} onClick={() => { setSelectedRecipe(r); setPage('Recipes') }}/>)}</div></section>
      </> : page === 'Customers' ? <CustomersPage restaurant={active} notify={notify}/> : page === 'Payments' ? <PaymentsPage restaurant={active} orders={orders} onPay={o => setPayFor({ order: o, then: null })} onPaid={setCashPaid}/> : page === 'To cook' ? <PrepPage orders={orders} today={todayIso} restaurant={active.name} notify={notify}/> : page === 'Orders' ? <OrdersPage olderDone={olderDone} onLoadOlder={loadOlder} onSheet={() => setSheetOpen(true)} onCharge={setChargeFor} distance={active.charge_mode === 'distance'} statusCounts={{ all: normalOrders.length, ...normalOrders.reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m }, {}) }} onPay={o => setPayFor({ order: o, then: null })} rname={active.name} orders={filtered} recipes={recipeList} onPublish={togglePublished} query={query} setQuery={setQuery} onStatus={requestStatus} onEdit={setEditingOrder} formatItems={formatItems} filter={orderFilter} setFilter={setOrderFilter} channelFilter={channelFilter} setChannelFilter={setChannelFilter} dateFilter={dateFilter} setDateFilter={setDateFilter} channels={[...new Set(normalOrders.map(o => o.channel))]} highlight={highlight} slug={active.slug} today={todayIso}/> : page === 'Recipes' ? <RecipesPage onLimit={saveLimit} onHalf={toggleHalf} onAddOption={addOption} onRemoveOption={removeOption} today={todayIso} onSoldOut={toggleSoldOut} onPhoto={uploadPhoto} onRemovePhoto={removePhoto} recipes={recipeList} recipe={selectedRecipe} onSelect={setSelectedRecipe} onNew={() => setModal('recipe')} onEdit={setEditingRecipe}/> : page === 'Inventory' ? <InventoryPage inventory={inventory} onNew={() => setModal('inventory')} onEdit={setEditingItem}/> : page === 'Reports' ? <ReportsPage orders={orders} recipeList={recipeList}/> : page === 'Settings' ? <>{secrets ? <RestaurantSettings r={active} secrets={secrets} onSave={saveRestaurantSettings}/> : <p className="no-results">Loading settings…</p>}{limits && <OrderLimitsSettings limits={limits} onSave={saveLimits}/>}{isOwner && <TeamCard notify={notify}/>}<AppInstallCard notify={notify} restaurants={restaurants}/><CouponsSettings restaurants={restaurants} notify={notify}/><BackupCard restaurants={restaurants} notify={notify}/><SettingsPage key={`${active.slug}:${settings.kitchenName}:${settings.location}`} settings={settings} onSave={async (next) => { const location = (next.location || '').trim(); if (supabase) { const { error } = await supabase.from('restaurants').update({ location: location || null }).eq('id', active.id); if (error) return notify(`Could not save the location: ${error.message}`) } else setRestaurants(l => l.map(x => x.slug === active.slug ? { ...x, location } : x)); setSettings({ ...next, location }); try { localStorage.setItem(`kitchen-settings:${active.slug}`, JSON.stringify({ currency: next.currency, taxRate: next.taxRate })) } catch { /* optional */ } notify(`Kitchen profile saved for ${active.name}`) }}/></> : page === 'Bulk' ? <BulkPage restaurant={active} orders={bulkOrders} notify={notify} onSave={saveRestaurantSettings} shrinkImage={shrinkImage} today={todayIso} tableProps={{ onStatus: requestStatus, onEdit: setEditingOrder, formatItems, highlight, today: todayIso, rname: active.name, onPay: o => setPayFor({ order: o, then: null }), onCharge: setChargeFor, distance: active.charge_mode === 'distance', onAdvance: markAdvance }}/> : page === 'Help' ? <HelpPage/> : <Placeholder page={page} notify={notify}/>}</div> 
    </main>
    {chargeFor && <ChargeDialog order={chargeFor} close={() => setChargeFor(null)} onSave={(fee) => saveCharge(chargeFor, fee)}/>}
    {sheetOpen && <DeliverySheet orders={orders} today={todayIso} rname={active.name} close={() => setSheetOpen(false)} notify={notify}/>}
    {moreOpen && <div className="more-sheet-wrap" onClick={e => e.target === e.currentTarget && setMoreOpen(false)}><div className="more-sheet" role="dialog" aria-label="More pages">{navItems.filter(([l]) => SECONDARY.includes(l)).map(([l, icon]) => <button key={l} className={page === l ? 'on' : ''} onClick={() => { setPage(l); setMoreOpen(false) }}><Icon name={icon}/>{PAGE_LABEL[l] || l}</button>)}</div></div>}
    {payFor && <PaymentDialog order={payFor.order} then={payFor.then} close={() => setPayFor(null)} onConfirm={() => confirmPayment(payFor.order, payFor.then)} onReject={() => { setRejectFor(payFor.order); setPayFor(null) }} notify={notify}/>}
    {rejectFor && <RejectPaymentDialog order={rejectFor} close={() => setRejectFor(null)} onConfirm={(reason) => rejectPayment(rejectFor, reason)}/>}
    {cancelFor && <CancelDialog id={cancelFor} close={() => setCancelFor(null)} onConfirm={(reason) => { setStatus(cancelFor, 'Cancelled', reason); setCancelFor(null) }}/>}
    {modal && <Modal type={modal} close={() => setModal(null)} save={saveOrder} saveRecipe={saveRecipe} saveInventory={saveInventory} notify={notify}/>} {editingItem && <Modal type="inventory" editing={editingItem} close={() => setEditingItem(null)} saveInventory={updateInventory} onDelete={deleteInventory}/>} {editingRecipe && <Modal type="recipe" editing={editingRecipe} close={() => setEditingRecipe(null)} saveRecipe={updateRecipe} onDelete={deleteRecipe}/>} {editingOrder && <OrderEditor order={editingOrder} close={() => setEditingOrder(null)} onSave={updateOrder} formatItems={formatItems}/>} {closeDialog && <div className="modal-backdrop"><form className="modal" onSubmit={e => { e.preventDefault(); setOpen(false, closeDialog.message); setCloseDialog(null) }}><h2>Close {active.name}?</h2><p className="close-help">Customers won't be able to order from {active.name} until you reopen it. {(restaurants || []).filter(r => r.id !== active.id).map(r => r.name).join(', ')} is not affected.</p><label>Message for customers <small>(optional)</small><input value={closeDialog.message} onChange={e => setCloseDialog({ message: e.target.value })} placeholder="Closed for the evening. Back tomorrow at 11am."/></label><button className="primary submit">Close {active.name}</button><button type="button" className="text-btn close-keep" onClick={() => setCloseDialog(null)}>Keep it open</button></form></div>} <OrderAlerts alerts={alerts} restaurants={restaurants || []} onDismiss={dismissAlert} onView={viewAlert} onAccept={(a) => confirmPayment(a.order)} onReject={(a) => { setRejectFor(a.order); dismissAlert(a.key) }} onClear={() => setAlerts([])}/> {toast && <div className="toast">✓ {toast}</div>}
  </div>
}

const Stat=({label,value,change,good,note='vs. yesterday'})=><div className="stat"><p>{label}</p><div><strong>{value}</strong><span className={good?'green':''}>{change}</span></div><small>{note}</small></div>
const NEXT_STEP = { New: ['Cooking', 'Start cooking'], Cooking: ['Ready', 'Mark ready'], Ready: ['Delivered', 'Mark delivered'] }
/* ---------- Bulk orders (admin) ---------- */
function printInvoice(o, rname) {
  const lines = orderLines(o).filter(l => !String(l.name).startsWith('Note:')), money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
  const sub = lines.reduce((t, l) => t + Number(l.price || 0) * Number(l.quantity || 1), 0), fee = Number(o.deliveryFee || 0)
  const adv = o.bulk && Number(o.bulk.advance) > 0 && (o.bulk.advance_received || (o.payment === 'UPI' && o.paymentStatus === 'received')) ? Number(o.bulk.advance) : 0
  const rows = lines.map(l => `<tr><td>${esc(l.name)}</td><td class="r">${esc(l.quantity)}</td><td class="r">${money(l.price)}</td><td class="r">${money(Number(l.price || 0) * Number(l.quantity || 1))}</td></tr>`).join('')
  const body = `<div class="ref"><div class="no">Invoice ${esc(o.id)}</div><div class="tag">Big Table</div></div><div class="meta">${esc(o.placed || o.time || '')}</div>
<div class="sec"><div class="l">Billed to</div><b>${esc(String(o.customer || '').split('·')[0].trim())}</b> · ${esc(o.phone || '')}<br>${esc(o.address || '')}</div>
<div class="when">Delivery: ${esc(deliveryText(o.deliveryDate, ''))}${o.bulk && o.bulk.slot ? ' · ' + esc(o.bulk.slot) : ''}</div>
<table><thead><tr><th>Item</th><th class="r">Plates</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot"><tr><td>Items</td><td class="r">${money(sub)}</td></tr><tr><td>Delivery charge</td><td class="r">${fee ? money(fee) : 'Free'}</td></tr><tr class="grand"><td>Total</td><td class="r">${money(o.total)}</td></tr>${adv ? `<tr><td>Advance paid</td><td class="r">−${money(adv)}</td></tr><tr class="grand"><td>Balance to pay</td><td class="r">${money(Math.max(0, Number(o.total) - adv))}</td></tr>` : ''}</table>
<div class="meta">Payment: ${esc(o.payment || '')}</div><div class="foot"><b>Thank you! Please come back again.</b></div>`
  printDoc(`Invoice ${o.id}`, body)
}
function BulkRowInfo({ o }) {
  const b = o.bulk || {}, adv = Number(b.advance || 0), got = b.advance_received || (o.payment === 'UPI' && o.paymentStatus === 'received')
  return <div className="bulk-line"><span className="pay-tag verify">BIG TABLE</span>{b.slot && <span>🕒 {b.slot}</span>}{b.guests && <span>👥 {b.guests}</span>}{b.spice && <span>🌶 {b.spice}</span>}{b.packing && <span>📦 {b.packing}</span>}{adv > 0 && <span className={got ? 'pay-tag ok' : 'pay-tag verify'}>Advance ₹{adv} · {got ? 'received' : 'pending'}</span>}</div>
}
const parseTiers = (text) => String(text || '').split(',').map(x => x.trim()).filter(Boolean).map(x => { const [q, p] = x.split(':').map(v => Number(String(v || '').trim())); return { qty: q, price: p } })
const tiersOk = (t) => t.every(x => Number.isInteger(x.qty) && x.qty > 0 && Number.isFinite(x.price) && x.price >= 0)
const tiersText = (tiers) => (tiers || []).map(t => `${t.qty}:${t.price}`).join(', ')
function BulkMenuEditor({ restaurant, notify, shrinkImage }) {
  const [items, setItems] = useState(null), [form, setForm] = useState(null), [busy, setBusy] = useState(false)
  const load = async () => { if (!supabase) return setItems([]); const { data } = await supabase.from('bulk_items').select('*').eq('restaurant_id', restaurant.id).order('sort_order').order('name'); setItems(data || []) }
  useEffect(() => { setItems(null); load() }, [restaurant.id])
  const pg = usePaged(items || [], 10, (items || []).length)
  const blank = { name: '', description: '', price: '', min_qty: '', tiers: '', is_active: true, diet: '' }
  const save = async (e) => {
    e.preventDefault(); if (busy) return
    const tiers = parseTiers(form.tiers)
    if (!form.name.trim() || form.price === '' || Number(form.price) < 0) return notify('Enter a name and a price')
    if (!tiersOk(tiers)) return notify('Price tiers look like 50:230, 100:210 (plates:price)')
    const row = { restaurant_id: restaurant.id, name: form.name.trim(), description: form.description.trim() || null, price: Number(form.price), min_qty: form.min_qty === '' ? null : Math.max(1, Math.floor(Number(form.min_qty))), tiers: tiers.sort((a, b) => a.qty - b.qty), is_active: form.is_active, diet: form.diet || null }
    setBusy(true)
    if (supabase) {
      const { error } = form.id ? await supabase.from('bulk_items').update(row).eq('id', form.id) : await supabase.from('bulk_items').insert(row)
      if (error) { setBusy(false); return notify(`Could not save: ${error.message}`) }
    }
    setBusy(false); setForm(null); await load(); notify(`Saved ${row.name}`)
  }
  const toggle = async (i) => { if (supabase) { const { error } = await supabase.from('bulk_items').update({ is_active: !i.is_active }).eq('id', i.id); if (error) return notify(`Could not update: ${error.message}`) } load() }
  const remove = async (i) => { if (!window.confirm(`Delete ${i.name} from the bulk menu?`)) return; if (supabase) { const { error } = await supabase.from('bulk_items').delete().eq('id', i.id); if (error) return notify(`Could not delete: ${error.message}`) } load() }
  const photo = async (i, file) => {
    if (!file || !supabase) return
    try {
      const blob = await shrinkImage(file), path = `${restaurant.id}/bulk-${i.id}-${Date.now()}.jpg`
      const { error } = await supabase.storage.from('dish-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false }); if (error) return notify(`Could not upload: ${error.message}`)
      const url = supabase.storage.from('dish-photos').getPublicUrl(path).data.publicUrl
      const { error: e2 } = await supabase.from('bulk_items').update({ image_url: url }).eq('id', i.id); if (e2) return notify(`Could not save the photo: ${e2.message}`)
      load(); notify('Photo saved')
    } catch (e) { notify(e.message || 'Could not add the photo') }
  }
  return <section className="panel bulk-menu">
    <div className="panel-heading"><div><h3>Big Table menu</h3><p>Write the items and prices customers see on the Big Table page.</p></div><button type="button" className="primary" onClick={() => setForm(blank)}><Icon name="plus" size={16}/> Add item</button></div>
    {form && <form className="bulk-form" onSubmit={save}>
      <label>Item name<input aria-label="Bulk item name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={80} placeholder="e.g. Veg biryani" autoFocus/></label>
      <label>Short description <small>optional</small><input aria-label="Bulk item description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} maxLength={120}/></label>
      <div className="two"><label>Price per plate (₹)<input aria-label="Bulk item price" value={form.price} onChange={e => setForm({ ...form, price: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal"/></label>
        <label>Minimum plates <small>blank = default</small><input aria-label="Bulk item minimum" value={form.min_qty} onChange={e => setForm({ ...form, min_qty: e.target.value.replace(/\D/g, '') })} inputMode="numeric"/></label></div>
      <label>Price tiers <small>lower price from a quantity, like 50:230, 100:210</small><input aria-label="Bulk item tiers" value={form.tiers} onChange={e => setForm({ ...form, tiers: e.target.value })} placeholder="50:230, 100:210"/></label>
      <label>Veg or non-veg<select aria-label="Bulk item veg or non-veg" value={form.diet || ''} onChange={e => setForm({ ...form, diet: e.target.value })}><option value="">Not set</option><option value="veg">Veg</option><option value="nonveg">Non-veg</option></select></label>
      <label className="bulk-check"><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })}/> Show to customers</label>
      <div className="cancel-actions"><button type="button" className="text-btn" onClick={() => setForm(null)}>Cancel</button><button className="primary app-btn" disabled={busy}>Save item</button></div>
    </form>}
    {items === null ? <p className="no-results">Loading…</p> : items.length === 0 ? <p className="no-results">No Big Table items yet. Add the first one.</p> : <><ul className="bulk-list">{pg.items.map(i => <li key={i.id} className={i.is_active ? 'bulk-row' : 'bulk-row off'}>
      {i.image_url ? <img src={i.image_url} alt="" width="48" height="48"/> : <span className="rc-noimg" aria-hidden="true">🍲</span>}
      <div className="bulk-info"><b>{i.diet === 'veg' ? '🟢 ' : i.diet === 'nonveg' ? '🔴 ' : ''}{i.name}</b><small>₹{Number(i.price)} per plate · min {i.min_qty || restaurant.bulk_min_qty || 10}{(i.tiers || []).length ? ` · tiers ${tiersText(i.tiers)}` : ''}{i.is_active ? '' : ' · hidden'}</small></div>
      <div className="bulk-btns"><label className="text-btn rc-file">Photo<input type="file" accept="image/*" aria-label={`Photo for ${i.name}`} onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; photo(i, f) }}/></label>
        <button type="button" className="text-btn" onClick={() => setForm({ id: i.id, name: i.name, description: i.description || '', price: String(Number(i.price)), min_qty: i.min_qty ? String(i.min_qty) : '', tiers: tiersText(i.tiers), is_active: i.is_active, diet: i.diet || '' })}>Edit</button>
        <button type="button" className="text-btn" onClick={() => toggle(i)}>{i.is_active ? 'Hide' : 'Show'}</button>
        <button type="button" className="text-btn" onClick={() => remove(i)}>Delete</button></div>
    </li>)}</ul><Pager p={pg}/></>}
  </section>
}
function BulkSettingsCard({ restaurant, onSave, notify }) {
  const [f, setF] = useState({ min: String(restaurant.bulk_min_qty ?? 10), lead: String(restaurant.bulk_lead_days ?? 1), adv: String(restaurant.bulk_advance_pct ?? 0), cap: restaurant.bulk_daily_cap == null ? '' : String(restaurant.bulk_daily_cap), slots: restaurant.bulk_slots || '', note: restaurant.bulk_note || '' })
  useEffect(() => { setF({ min: String(restaurant.bulk_min_qty ?? 10), lead: String(restaurant.bulk_lead_days ?? 1), adv: String(restaurant.bulk_advance_pct ?? 0), cap: restaurant.bulk_daily_cap == null ? '' : String(restaurant.bulk_daily_cap), slots: restaurant.bulk_slots || '', note: restaurant.bulk_note || '' }) }, [restaurant.id])
  const num = (v) => v.replace(/\D/g, '')
  const save = (e) => {
    e.preventDefault()
    const min = Number(f.min), lead = Number(f.lead), adv = Number(f.adv), cap = f.cap === '' ? null : Number(f.cap)
    if (!(min >= 1) || lead > 30 || adv > 100 || (cap !== null && cap < 1)) return notify('Check the numbers: minimum 1 or more, notice up to 30 days, advance up to 100%, cap 1 or more')
    onSave({ bulk_min_qty: min, bulk_lead_days: lead, bulk_advance_pct: adv, bulk_daily_cap: cap, bulk_slots: f.slots.trim(), bulk_note: f.note.trim() || null })
  }
  return <form className="panel bulk-settings" onSubmit={save}>
    <h3>Big Table rules for {restaurant.name}</h3>
    <div className="rset-switch"><div><b>Accept UPI for Big Table orders</b><small>{restaurant.bulk_upi_enabled === false ? 'UPI is off for Big Table orders. Customers can only choose cash on delivery.' : 'Customers can pay Big Table orders (or the advance) by UPI. This is separate from the UPI switch for normal orders.'}</small></div>
      <button type="button" role="switch" aria-checked={restaurant.bulk_upi_enabled !== false} aria-label="Accept UPI for bulk orders" className={restaurant.bulk_upi_enabled === false ? 'switch' : 'switch on ok'} onClick={() => onSave({ bulk_upi_enabled: restaurant.bulk_upi_enabled === false })}><i/></button></div>
    <div className="two"><label>Minimum plates per item<input aria-label="Default minimum plates" value={f.min} onChange={e => setF({ ...f, min: num(e.target.value) })} inputMode="numeric"/></label>
      <label>Days of notice needed<input aria-label="Bulk notice days" value={f.lead} onChange={e => setF({ ...f, lead: num(e.target.value) })} inputMode="numeric"/></label></div>
    <div className="two"><label>Advance to pay (%) <small>0 = none</small><input aria-label="Advance percent" value={f.adv} onChange={e => setF({ ...f, adv: num(e.target.value) })} inputMode="numeric"/></label>
      <label>Plates per day cap <small>blank = no cap</small><input aria-label="Bulk daily cap" value={f.cap} onChange={e => setF({ ...f, cap: num(e.target.value) })} inputMode="numeric"/></label></div>
    <label>Delivery times <small>separate with commas</small><input aria-label="Bulk delivery times" value={f.slots} onChange={e => setF({ ...f, slots: e.target.value })} placeholder="9-11 am, 12-2 pm, 5-7 pm"/></label>
    <label>Note shown to customers <small>optional</small><textarea aria-label="Bulk note" rows={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} maxLength={300}/></label>
    <button className="primary app-btn">Save bulk rules</button>
  </form>
}
function BulkPage({ restaurant, orders, notify, onSave, shrinkImage, today, tableProps }) {
  const [tab, setTab] = useState('Orders'), [st, setSt] = useState('All')
  const tabs = ['Orders', 'Prep list', 'Menu', 'Report', 'Settings']
  const live = orders.filter(o => o.status !== 'Cancelled')
  const shown = sortByDelivery(st === 'All' ? orders : orders.filter(o => o.status === st))
  const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
  const plates = (o) => orderLines(o).filter(l => !String(l.name).startsWith('Note:')).reduce((s, l) => s + Number(l.quantity || 1), 0)
  // prep list: plates due per day, per item
  const prep = {}; orders.filter(o => o.status !== 'Cancelled' && o.status !== 'Delivered' && deliveryKey(o) >= today).forEach(o => { const d = deliveryKey(o); prep[d] ||= {}; orderLines(o).filter(l => !String(l.name).startsWith('Note:')).forEach(l => { prep[d][l.name] = (prep[d][l.name] || 0) + Number(l.quantity || 1) }) })
  const prepDays = Object.keys(prep).sort()
  const advanceGot = (o) => o.bulk && Number(o.bulk.advance) > 0 && (o.bulk.advance_received || (o.payment === 'UPI' && o.paymentStatus === 'received')) ? Number(o.bulk.advance) : 0
  const perItem = {}; live.forEach(o => orderLines(o).filter(l => !String(l.name).startsWith('Note:')).forEach(l => { perItem[l.name] = (perItem[l.name] || 0) + Number(l.quantity || 1) }))
  const perDay = {}; live.forEach(o => { const d = deliveryKey(o); perDay[d] = (perDay[d] || 0) + plates(o) })
  const prepText = () => prepDays.map(d => `${dayLabel(d, today)}, ${dateText(d)}\n` + Object.entries(prep[d]).map(([n, q]) => `${q} × ${n}`).join('\n')).join('\n\n')
  return <div className="bulk-page">
    <section className="panel bulk-top"><div><h3>{FEAST.title} · {restaurant.name}</h3><p>{restaurant.bulk_enabled ? `Customers can see "${FEAST.cta}" on their screen.` : 'Big Table orders are off. Customers cannot see them.'}</p></div>
      <button type="button" role="switch" aria-checked={Boolean(restaurant.bulk_enabled)} aria-label="Big Table orders on or off" className={restaurant.bulk_enabled ? 'switch on ok' : 'switch'} onClick={() => onSave({ bulk_enabled: !restaurant.bulk_enabled })}><i/></button></section>
    <div className="bulk-tabs" role="tablist" aria-label="Big Table sections">{tabs.map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'bulk-tab on' : 'bulk-tab'} onClick={() => setTab(t)}>{t}{t === 'Orders' && <i>{orders.length}</i>}</button>)}</div>
    {tab === 'Orders' && <section className="panel orders-panel">
      <div className="bulk-tabs sub" role="tablist" aria-label="Big Table order status">{['All', 'New', 'Cooking', 'Ready', 'Delivered', 'Cancelled'].map(s => <button key={s} role="tab" aria-selected={st === s} className={st === s ? 'bulk-tab on' : 'bulk-tab'} onClick={() => setSt(s)}>{s}<i>{s === 'All' ? orders.length : orders.filter(o => o.status === s).length}</i></button>)}</div>
      {shown.length ? <OrderTable orders={shown} {...tableProps}/> : <p className="no-results">No Big Table orders here yet.</p>}</section>}
    {tab === 'Prep list' && <section className="panel bulk-prep"><div className="panel-heading"><div><h3>Prep list</h3><p>Plates to make, by delivery day.</p></div>{prepDays.length > 0 && <CopyButton text={prepText()} label="Copy" aria="Copy prep list"/>}</div>
      {prepDays.length ? prepDays.map(d => <div key={d} className="bulk-day"><b>{dayLabel(d, today)} <span>{dateText(d)}</span> · {Object.values(prep[d]).reduce((s, q) => s + q, 0)} plates</b><ul>{Object.entries(prep[d]).sort((a, b) => b[1] - a[1]).map(([n, q]) => <li key={n}><span>{n}</span><b>{q}</b></li>)}</ul></div>) : <p className="no-results">No Big Table plates to prepare.</p>}</section>}
    {tab === 'Menu' && <BulkMenuEditor restaurant={restaurant} notify={notify} shrinkImage={shrinkImage}/>}
    {tab === 'Report' && <section className="panel bulk-report"><div className="panel-heading"><div><h3>Big Table report</h3><p>Kept separate from normal sales.</p></div></div>
      <div className="day-end-grid"><div><span>Big Table orders</span><b>{live.length}</b></div><div><span>Plates</span><b>{live.reduce((s, o) => s + plates(o), 0)}</b></div><div><span>Big Table sales</span><b>{money(live.reduce((s, o) => s + Number(o.total || 0), 0))}</b></div><div><span>Advance received</span><b>{money(live.reduce((s, o) => s + advanceGot(o), 0))}</b></div></div>
      <h4>Top items</h4><ul className="bulk-rank">{Object.entries(perItem).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, q]) => <li key={n}><span>{n}</span><b>{q} plates</b></li>)}{!Object.keys(perItem).length && <li>No data yet</li>}</ul>
      <h4>Plates by delivery day</h4><ul className="bulk-rank">{Object.entries(perDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10).map(([d, q]) => <li key={d}><span>{dayLabel(d, today)} · {dateText(d)}</span><b>{q} plates</b></li>)}{!Object.keys(perDay).length && <li>No data yet</li>}</ul></section>}
    {tab === 'Settings' && <BulkSettingsCard restaurant={restaurant} onSave={onSave} notify={notify}/>}
  </div>
}

function OrderTable({orders: allOrders,onStatus,onEdit,formatItems,highlight,today,grouped,rname,onPay,onCharge,distance,onAdvance}) {
  const pg = usePaged(allOrders, 10, allOrders.length + ':' + (allOrders[allOrders.length - 1] || {}).id), orders = pg.items
  const rows = []; let last = null
  orders.forEach(o => {
    const dk = deliveryKey(o)
    if (grouped && dk !== last) {
      last = dk; const n = allOrders.filter(x => deliveryKey(x) === dk).length, rel = dayLabel(dk, today), abs = dateText(dk)
      rows.push(<div className="day-head" key={'head-' + dk}><b>{rel}</b>{rel !== abs && <span>{abs}</span>}<em>{n} order{n === 1 ? '' : 's'}</em></div>)
    }
    rows.push(<div className={o.id === highlight ? 'order-row flash' : 'order-row'} key={o.id}><div className="avatar">{o.avatar}</div><div className="order-person"><b>{o.customer}</b><span>{o.id} · {o.channel}</span>{o.paymentStatus === 'pending' && o.status !== 'Cancelled' && <span className={o.paymentClaimedAt ? 'pay-tag verify' : 'pay-tag'}>{o.paymentClaimedAt ? `UPI · verify payment${o.paymentTxn ? ' · txn ' + o.paymentTxn : ''}` : o.paymentRejectReason ? `UPI · payment rejected: ${o.paymentRejectReason}` : 'UPI · payment pending'}</span>}{o.paymentStatus === 'received' && <span className="pay-tag ok">UPI · paid</span>}{o.deliveryFeePending && o.status !== 'Cancelled' && <span className="pay-tag verify">Delivery charge needed</span>}{!o.deliveryFeePending && o.deliveryFee > 0 && <span className="pay-tag">Delivery ₹{o.deliveryFee}</span>}{o.rating > 0 && <span className="pay-tag ok">★ {o.rating}{o.ratingComment ? ` · ${o.ratingComment}` : ''}</span>}{o.status === 'Cancelled' && o.cancelReason && <span className="cancel-why">Reason: {o.cancelReason}</span>}</div><div className="order-items"><div>{formatItems(o.items)}</div>{o.kind === 'bulk' && <BulkRowInfo o={o}/>}<small className="order-meta"><span className="om-date">🗓 Deliver: {deliveryText(dk, today)}</span>{o.address && <span className="om-addr">📍 <span className="om-text">{o.address}</span> <CopyButton text={o.address} label="Copy" aria="Copy address"/></span>}{o.payment && <span>💳 {o.payment}</span>}</small></div><div className="order-total">₹{o.total}<span>Placed {o.placed || o.time}</span></div><select className={`status status-select ${o.status.toLowerCase()}`} aria-label={`Status for ${o.id}`} value={o.status} onChange={e=>onStatus(o.id,e.target.value)}>{['New','Cooking','Ready','Delivered','Cancelled'].map(status=><option key={status}>{status}</option>)}</select><div className="row-actions">{o.kind === 'bulk' && onAdvance && Number(o.bulk && o.bulk.advance) > 0 && !(o.payment === 'UPI' && o.paymentStatus === 'received') && <button type="button" className="edit-order" onClick={() => onAdvance(o)}>{o.bulk.advance_received ? 'Undo advance' : 'Advance received'}</button>}{o.kind === 'bulk' && <button type="button" className="edit-order" onClick={() => printInvoice(o, rname)}>Invoice</button>}{NEXT_STEP[o.status] && o.paymentStatus !== 'pending' && <button type="button" className="next-step" onClick={() => onStatus(o.id, NEXT_STEP[o.status][0])}>{NEXT_STEP[o.status][1]}</button>}{o.deliveryFeePending && o.status !== 'Cancelled' && <button className="edit-order pay-confirm" onClick={() => onCharge(o)}>Set delivery charge</button>}{!o.deliveryFeePending && distance && !['Delivered', 'Cancelled'].includes(o.status) && <button className="edit-order" onClick={() => onCharge(o)}>Change charge</button>}{o.paymentStatus === 'pending' && o.status !== 'Cancelled' && <button className="edit-order pay-confirm" onClick={() => onPay(o)}>{o.paymentClaimedAt ? 'Verify payment' : 'Confirm payment'}</button>}<button className="edit-order" onClick={() => onEdit(o)}>Open</button><button className="edit-order" onClick={() => printTicket(o)}>Print</button>{whatsappLink(o, rname) ? <a className="edit-order wa-order" href={whatsappLink(o, rname)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${o.customer}`}>WhatsApp</a> : <span className="edit-order wa-none" title="No phone number on this order">No phone</span>}</div></div>)
  })
  return <><div className="order-table">{rows}</div><Pager p={pg} /></>
}
function RecipeCard({r,onClick}) { return <button className="recipe-card" onClick={onClick}><div className={`food-art ${r.color}`}>{r.emoji}<span>✦</span></div><div className="recipe-info"><div><b>{r.name}</b><small>{r.category} · {r.time}</small></div><span className={r.stock==='Low stock'?'stock low':'stock'}>{r.stock}</span></div><div className="recipe-metrics"><span>Food cost <b>{r.foodCost}%</b></span><span>Sell <b>₹{r.price}</b></span></div></button> }
/* Pending orders grouped by dish: how many of each item still need to be cooked. */
function PrepPage({ orders, today, restaurant, notify }) {
  const [stage, setStage] = useState('New'), [day, setDay] = useState('all')
  const stageOk = (o) => stage === 'both' ? (o.status === 'New' || o.status === 'Cooking') : o.status === stage
  const waitingPay = orders.filter(o => o.paymentStatus === 'pending' && o.status === 'New')
  const inStage = orders.filter(o => stageOk(o) && o.paymentStatus !== 'pending')   // can't cook what isn't paid yet
  const days = [...new Set(inStage.map(deliveryKey).filter(Boolean))].sort()
  const dayKey = days.includes(day) || day === 'all' ? day : 'all'
  const picked = inStage.filter(o => dayKey === 'all' || deliveryKey(o) === dayKey)
  const map = new Map()
  picked.forEach(o => orderLines(o).forEach(l => {
    const label = l.name.trim() + (l.options ? ` (${l.options})` : ''), key = label.toLowerCase(), row = map.get(key) || { name: label, qty: 0, orders: new Set(), byDay: {} }
    row.qty += l.quantity; row.orders.add(o.id); const dk = deliveryKey(o); row.byDay[dk] = (row.byDay[dk] || 0) + l.quantity; map.set(key, row)
  }))
  const rows = [...map.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
  const pg = usePaged(rows, 10, dayKey + ':' + stage + ':' + rows.length)
  const totalItems = rows.reduce((n, r) => n + r.qty, 0)
  const stageName = stage === 'New' ? 'not started' : stage === 'Cooking' ? 'being cooked' : 'pending'
  const text = () => `${restaurant} · to cook${dayKey === 'all' ? '' : ' · ' + dayLabel(dayKey, today)}\n` + rows.map(r => `${r.qty} × ${r.name}`).join('\n')
  const copy = async () => { try { await navigator.clipboard.writeText(text()); notify('Cook list copied') } catch { notify('Could not copy') } }
  return <section className="prep-page">
    <div className="panel">
      <div className="panel-heading"><div><h3>To cook · {restaurant}</h3><p>Pending orders added up by dish, so you can cook in batches.</p></div>{rows.length > 0 && <button className="text-btn" onClick={copy}>Copy list</button>}</div>
      <div className="prep-filters" role="group" aria-label="Which orders">
        {[['New', 'Not started'], ['Cooking', 'Cooking'], ['both', 'Both']].map(([k, label]) => <button key={k} className={stage === k ? 'chip on' : 'chip'} onClick={() => setStage(k)}>{label}</button>)}
      </div>
      <div className="prep-filters" role="group" aria-label="Delivery day">
        <button className={dayKey === 'all' ? 'chip on' : 'chip'} onClick={() => setDay('all')}>All days</button>
        {days.map(d => <button key={d} className={dayKey === d ? 'chip on' : 'chip'} onClick={() => setDay(d)}>{dayLabel(d, today)}</button>)}
      </div>
      {waitingPay.length > 0 && <p className="prep-wait" role="status"><b>{waitingPay.length} order{waitingPay.length === 1 ? '' : 's'} waiting for UPI payment.</b> They appear here once you confirm the payment in Orders.</p>}
      {rows.length === 0 ? <p className="no-results prep-empty">Nothing {stageName}{dayKey === 'all' ? '' : ' for ' + dayLabel(dayKey, today).toLowerCase()}. New orders will show up here by themselves.</p> : <>
        <p className="prep-sum"><b>{totalItems}</b> item{totalItems === 1 ? '' : 's'} · <b>{rows.length}</b> dish{rows.length === 1 ? '' : 'es'} · <b>{picked.length}</b> order{picked.length === 1 ? '' : 's'}</p>
        <ul className="prep-list">{pg.items.map(r => <li key={r.name} className="prep-row">
          <span className="prep-qty" aria-label={`${r.qty} to cook`}>{r.qty}</span>
          <span className="prep-main"><b>{r.name}</b><small>in {r.orders.size} order{r.orders.size === 1 ? '' : 's'}{dayKey === 'all' && Object.keys(r.byDay).length > 1 ? ' · ' + Object.keys(r.byDay).sort().map(d => `${dayLabel(d, today)} ${r.byDay[d]}`).join(' · ') : ''}</small></span>
        </li>)}</ul><Pager p={pg} /></>}
    </div>
  </section>
}
/* The kitchen sets the delivery charge for an order, for example by distance. */
const areaOf = (address) => { const parts = String(address || '').split(',').map(x => x.trim()).filter(Boolean); return (parts.length > 1 ? parts[parts.length - 2] : parts[0]) || '' }
const loadRecentCharges = () => { try { return JSON.parse(localStorage.getItem('charge-recents') || '[]') } catch { return [] } }
function ChargeDialog({ order, close, onSave }) {
  const area = areaOf(order.address), recents = loadRecentCharges()
  const suggested = recents.filter(r => area && r.area.toLowerCase() === area.toLowerCase()).concat(recents.filter(r => !area || r.area.toLowerCase() !== area.toLowerCase())).slice(0, 4)
  const [fee, setFee] = useState(order.deliveryFeePending ? '' : String(order.deliveryFee || 0)), [busy, setBusy] = useState(false)
  const ok = /^\d{1,4}$/.test(fee.trim()) && Number(fee) <= 5000
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address || '')}`
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Set delivery charge" onClick={e => e.target === e.currentTarget && close()}>
    <form className="modal cancel-dialog" onSubmit={async e => { e.preventDefault(); if (!ok || busy) return; setBusy(true); try { if (area) localStorage.setItem('charge-recents', JSON.stringify([{ area, fee: Number(fee) }, ...loadRecentCharges().filter(r => r.area.toLowerCase() !== area.toLowerCase())].slice(0, 8))) } catch { /* optional */ } await onSave(Number(fee)); setBusy(false) }}>
      <h3>Delivery charge for {order.id}</h3>
      <p className="cancel-help">{String(order.customer || '').split('·')[0].trim()}'s address. The customer sees the charge and the new total on their order{order.paymentStatus === 'pending' && order.payment === 'UPI' ? ', then pays by UPI' : ''}.</p>
      <div className="charge-addr"><span>{order.address || 'No address'}</span><span className="charge-addr-btns"><CopyButton text={order.address || ''} label="Copy" aria="Copy address"/><a className="text-btn" href={maps} target="_blank" rel="noopener noreferrer">Open in Maps</a></span></div>
      {suggested.length > 0 && <div className="cancel-chips recent" aria-label="Recent areas">{suggested.map(r => <button type="button" key={r.area} className={fee === String(r.fee) ? 'chip on' : 'chip'} onClick={() => setFee(String(r.fee))}>{r.area} ₹{r.fee}</button>)}</div>}
      <div className="cancel-chips">{[0, 20, 30, 40, 50, 80, 100].map(v => <button type="button" key={v} className={fee === String(v) ? 'chip on' : 'chip'} onClick={() => setFee(String(v))}>{v === 0 ? 'Free' : `₹${v}`}</button>)}</div>
      <label>Delivery charge (₹)<input value={fee} onChange={e => setFee(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="Delivery charge amount" placeholder="e.g. 40" autoFocus /></label>
      <p className="pay-warn">Items {`₹${order.total - (order.deliveryFee || 0)}`}{ok ? ` + delivery ₹${Number(fee)} = ₹${order.total - (order.deliveryFee || 0) + Number(fee)}` : ''}.{order.paymentStatus === 'received' ? ' This order is already paid, so the customer pays the charge on delivery.' : ''}</p>
      <div className="cancel-actions"><button type="button" className="text-btn" onClick={close}>Cancel</button><button className="primary app-btn" disabled={!ok || busy}>Save charge</button></div>
    </form>
  </div>
}

/* A printable list for the delivery person: where to go and what to collect. */
function DeliverySheet({ orders, today, rname, close, notify }) {
  const [day, setDay] = useState('all'), [withDelivered, setWithDelivered] = useState(false)
  const open = orders.filter(o => o.status !== 'Cancelled' && (withDelivered || o.status !== 'Delivered'))
  const days = [...new Set(open.map(deliveryKey).filter(Boolean))].sort()
  const dayKey = days.includes(day) || day === 'all' ? day : 'all'
  const list = open.filter(o => dayKey === 'all' || deliveryKey(o) === dayKey).sort((a, b) => deliveryKey(a).localeCompare(deliveryKey(b)) || String(a.createdAt).localeCompare(String(b.createdAt)))
  const due = (o) => o.paymentStatus === 'received' ? { text: 'Paid', amt: 0 } : o.deliveryFeePending ? { text: 'Delivery charge not set', amt: 0 } : o.payment === 'UPI' ? { text: 'UPI payment not confirmed', amt: 0 } : { text: `Collect ₹${o.total}`, amt: Number(o.total) || 0 }
  const cash = list.reduce((n, o) => n + due(o).amt, 0)
  const nameOf = (o) => String(o.customer || 'Guest').split('·')[0].trim()
  const print = () => {
    const w = window.open('', '_blank', 'width=420,height=700'); if (!w) return window.alert('Please allow pop-ups to print.')
    const rows = list.map((o, i) => `<div class="o"><b>${i + 1}. ${esc(nameOf(o))}</b> ${esc(customerPhone(o))}<br>${esc(o.address || 'No address')}<br>${esc(formatItems2(o))}<br><b>${esc(due(o).text)}</b></div>`).join('')
    w.document.write(`<!doctype html><html><head><title>Delivery sheet</title><style>body{font:14px/1.45 system-ui,sans-serif;margin:16px;color:#000}h1{font-size:18px;margin:0 0 4px}.o{border-top:1px dashed #000;padding:10px 0}</style></head><body><h1>${esc(rname)} · delivery sheet</h1><div>${dayKey === 'all' ? 'All days' : esc(dayLabel(dayKey, today))} · ${list.length} orders · cash to collect ₹${cash}</div>${rows}</body></html>`); w.document.close(); w.focus(); w.print()
  }
  const formatItems2 = (o) => orderLines(o).filter(l => !String(l.name).startsWith('Note:')).map(l => `${l.quantity} × ${l.name}${l.options ? ` (${l.options})` : ''}`).join(', ')
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delivery sheet" onClick={e => e.target === e.currentTarget && close()}>
    <div className="modal dsheet">
      <button type="button" className="modal-close" aria-label="Close" onClick={close}><Icon name="close"/></button>
      <h2>Delivery sheet · {rname}</h2>
      <div className="prep-filters" role="group" aria-label="Delivery day"><button className={dayKey === 'all' ? 'chip on' : 'chip'} onClick={() => setDay('all')}>All days</button>{days.map(d => <button key={d} className={dayKey === d ? 'chip on' : 'chip'} onClick={() => setDay(d)}>{dayLabel(d, today)}</button>)}</div>
      <label className="rset-check"><input type="checkbox" checked={withDelivered} onChange={e => setWithDelivered(e.target.checked)} aria-label="Include delivered" />Include delivered orders</label>
      <p className="ds-sum"><b>{list.length}</b> order{list.length === 1 ? '' : 's'} · cash to collect <b>₹{cash}</b></p>
      <ol className="ds-list">{list.map(o => <li key={o.id} className="ds-row">
        <div className="ds-top"><b>{nameOf(o)}</b>{customerPhone(o) && <a className="text-btn" href={`tel:+91${customerPhone(o)}`}>{customerPhone(o)}</a>}<span className={`ds-due ${due(o).amt ? 'cash' : ''}`}>{due(o).text}</span></div>
        <div className="ds-addr"><span>{o.address || 'No address'}</span><CopyButton text={o.address || ''} label="Copy" aria="Copy address"/></div>
        <div className="ds-items">{formatItems2(o)}</div>
        <small>{o.id} · {o.status}{o.deliveryDate ? ` · ${dayLabel(o.deliveryDate, today)}` : ''}</small>
      </li>)}</ol>
      {!list.length && <p className="no-results">Nothing to deliver.</p>}
      <div className="cancel-actions"><button type="button" className="text-btn" onClick={close}>Close</button><button type="button" className="primary app-btn" onClick={print} disabled={!list.length}>Print</button></div>
    </div>
  </div>
}

/* Customers across both restaurants, with an easy WhatsApp message for repeat and lapsed customers. */
function CustomersPage({ restaurant, notify }) {
  const [rows, setRows] = useState(null), [tab, setTab] = useState('All'), [q, setQ] = useState('')
  useEffect(() => { if (!supabase) return setRows([]); let alive = true; supabase.rpc('customer_summary').then(({ data }) => { if (alive) setRows(data || []) }); return () => { alive = false } }, [])
  const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)
  const all = (rows || []).filter(c => !q.trim() || `${c.name} ${c.phone}`.toLowerCase().includes(q.trim().toLowerCase()))
  const repeat = all.filter(c => c.orders >= 2), lapsed = all.filter(c => daysSince(c.last_order) >= 14)
  const shown = tab === 'Repeat' ? repeat : tab === 'Not ordered in 14 days' ? lapsed : all
  const pg = usePaged(shown, 10, tab + ':' + shown.length)
  const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
  const msg = (c) => `Hi ${String(c.name || '').split(' ')[0] || 'there'}, thank you for ordering from ${(c.restaurants || []).join(' and ') || restaurant.name}! We have fresh dishes today. Order here: ${window.location.origin}/${restaurant.slug}/order\n— ${restaurant.name}`
  return <section className="cust-page">
    <div className="pay-tiles"><div className="pay-tile"><span>Customers</span><b>{all.length}</b><small>across both restaurants</small></div><div className="pay-tile ok"><span>Repeat</span><b>{repeat.length}</b><small>ordered 2+ times</small></div><div className="pay-tile wait"><span>Total spend</span><b>{money(all.reduce((n, c) => n + Number(c.spent || 0), 0))}</b><small>paid orders</small></div></div>
    <section className="page-toolbar">
      <div className="tabs status-tabs" role="tablist" aria-label="Customers">{[['All', all.length], ['Repeat', repeat.length], ['Not ordered in 14 days', lapsed.length]].map(([x, n]) => <button role="tab" aria-selected={tab === x} className={tab === x ? 'tab active-tab' : 'tab'} onClick={() => setTab(x)} key={x}>{x}<em className="tab-n">{n}</em></button>)}</div>
      <label className="search"><Icon name="search" size={16}/><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or phone" aria-label="Search customers"/></label>
    </section>
    <section className="panel pay-list">{rows === null ? <p className="no-results">Loading…</p> : shown.length ? <><ul>{pg.items.map(c => <li key={c.phone} className="pay-row">
      <div className="pay-who"><b>{c.name || 'Guest'}</b><span>{c.phone}</span><span className="pay-txn-line">{(c.restaurants || []).join(' · ')}</span></div>
      <div className="pay-amt"><b>{money(c.spent)}</b><span>{c.orders} order{c.orders === 1 ? '' : 's'} · last {daysSince(c.last_order) === 0 ? 'today' : `${daysSince(c.last_order)} day${daysSince(c.last_order) === 1 ? '' : 's'} ago`}</span></div>
      <div className="pay-state"><a className="edit-order" target="_blank" rel="noopener noreferrer" href={`https://wa.me/91${c.phone}?text=${encodeURIComponent(msg(c))}`}>WhatsApp</a><a className="text-btn" href={`tel:+91${c.phone}`}>Call</a></div>
    </li>)}</ul><Pager p={pg} /></> : <p className="no-results">No customers match.</p>}</section>
  </section>
}
/* Who has paid and who has not, for the restaurant being managed. */
function PaymentsPage({ orders, onPay, onPaid, restaurant }) {
  const [tab, setTab] = useState('All'), [q, setQ] = useState(''), [range, setRange] = useState('All dates'), [ost, setOst] = useState('All orders')
  const istDay = (iso) => iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : ''
  const nowIso = new Date().toISOString(), todayStr = istDay(nowIso), weekAgo = istDay(new Date(Date.now() - 6 * 864e5).toISOString())
  const info = (o) => {
    const upi = o.payment === 'UPI'
    if (o.paymentStatus === 'received') return { key: 'paid', label: upi ? 'Paid · UPI' : `Paid · ${o.payment === 'Cash on delivery' ? 'cash' : (o.payment || 'cash').toLowerCase()}` }
    if (upi && o.paymentClaimedAt) return { key: 'verify', label: 'Customer says paid' }
    if (upi) return { key: 'unpaid', label: o.paymentRejectReason ? 'Not paid · rejected' : 'Not paid' }
    return { key: 'unpaid', label: o.status === 'Delivered' ? 'Cash not collected' : 'Pay on delivery' }
  }
  const base = orders.filter(o => o.status !== 'Cancelled').map(o => ({ o, ...info(o) }))
    .filter(r => range === 'All dates' || (range === 'Today' ? istDay(r.o.createdAt) === todayStr : istDay(r.o.createdAt) >= weekAgo))
    .filter(r => ost === 'All orders' || r.o.status === ost)
    .filter(r => !q.trim() || `${r.o.customer} ${r.o.id}`.toLowerCase().includes(q.trim().toLowerCase()))
  const sum = (key) => base.filter(r => r.key === key).reduce((n, r) => n + (Number(r.o.total) || 0), 0)
  const count = (key) => base.filter(r => r.key === key).length
  const order = { verify: 0, unpaid: 1, paid: 2 }
  const rows = base.filter(r => tab === 'All' || r.key === ({ 'Not paid': 'unpaid', 'To verify': 'verify', Paid: 'paid' })[tab])
    .sort((a, b) => String(b.o.createdAt).localeCompare(String(a.o.createdAt)))
  const pg = usePaged(rows, 10, tab + ':' + rows.length)
  const money = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`
  const nameOf = (o) => String(o.customer || 'Guest').split('·')[0].trim()
  return <section className="pay-page">
    <div className="pay-tiles">
      <div className="pay-tile ok"><span>Paid</span><b>{money(sum('paid'))}</b><small>{count('paid')} order{count('paid') === 1 ? '' : 's'}</small></div>
      <div className="pay-tile bad"><span>Not paid</span><b>{money(sum('unpaid'))}</b><small>{count('unpaid')} order{count('unpaid') === 1 ? '' : 's'}</small></div>
      <div className="pay-tile wait"><span>To verify</span><b>{money(sum('verify'))}</b><small>{count('verify')} order{count('verify') === 1 ? '' : 's'}</small></div>
    </div>
    <section className="page-toolbar">
      <div className="tabs" role="tablist" aria-label="Payment status">{[['All', base.length], ['Not paid', count('unpaid')], ['To verify', count('verify')], ['Paid', count('paid')]].map(([x, n]) => <button role="tab" aria-selected={tab === x} className={tab === x ? 'tab active-tab' : 'tab'} onClick={() => setTab(x)} key={x}>{x}<em className="tab-n">{n}</em></button>)}</div>
      <div className="filters"><select value={ost} onChange={e => setOst(e.target.value)} aria-label="Order status"><option>All orders</option><option>New</option><option>Cooking</option><option>Ready</option><option>Delivered</option></select><select value={range} onChange={e => setRange(e.target.value)} aria-label="Payment date"><option>All dates</option><option>Today</option><option>Last 7 days</option></select></div>
      <label className="search"><Icon name="search" size={16}/><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or order number" aria-label="Search payments"/></label>
    </section>
    <section className="panel pay-list">{rows.length ? <><ul>{pg.items.map(({ o, key, label }) => <li key={o.id} className={`pay-row ${key}`}>
      <div className="pay-who"><b>{nameOf(o)}</b><span>{o.id}{customerPhone(o) ? ` · ${customerPhone(o)}` : ''}</span>{o.paymentTxn && <span className="pay-txn-line">Transaction ID <code>{o.paymentTxn}</code></span>}{o.paymentRejectReason && key === 'unpaid' && <span className="pay-txn-line">Rejected: {o.paymentRejectReason}</span>}</div>
      <div className="pay-amt"><b>₹{o.total}</b><span>{o.payment || 'Cash on delivery'} · {o.status}</span></div>
      <div className="pay-state"><span className={`pay-pill ${key}`}>{label}</span>
        {o.payment === 'UPI' && key !== 'paid' && <button className="edit-order pay-confirm" onClick={() => onPay(o)}>{key === 'verify' ? 'Verify payment' : 'Confirm payment'}</button>}
        {o.payment === 'UPI' && key === 'unpaid' && customerPhone(o) && <a className="edit-order" target="_blank" rel="noopener noreferrer" href={`https://wa.me/91${customerPhone(o)}?text=${encodeURIComponent(`Hi ${nameOf(o).split(' ')[0] || 'there'}, your order ${o.id} (₹${o.total}) is waiting for payment.${restaurant && restaurant.upi_id ? ` Please pay by UPI to ${restaurant.upi_id}, then open ${window.location.origin} to track your order and tap "I've paid".` : ''}\n— ${restaurant ? restaurant.name : ''}`)}`}>Remind on WhatsApp</a>}
        {o.payment !== 'UPI' && key === 'unpaid' && <button className="edit-order" onClick={() => onPaid(o, true)}>Mark received</button>}
        {o.payment !== 'UPI' && key === 'paid' && <button className="text-btn" onClick={() => onPaid(o, false)}>Undo</button>}
      </div>
    </li>)}</ul><Pager p={pg} /></> : <p className="no-results">No payments match.</p>}</section>
    <p className="pay-foot">Cancelled orders are not shown. UPI payments are confirmed by you after checking your UPI app. For cash, press Mark received when the money is collected.</p>
  </section>
}
function OrdersPage({olderDone,onLoadOlder,onSheet,onCharge,distance,statusCounts,onPay,rname,orders,recipes,onPublish,query,setQuery,onStatus,onEdit,formatItems,filter,setFilter,channelFilter,setChannelFilter,dateFilter,setDateFilter,channels,highlight,slug,today}) { const published=recipes.filter(recipe=>recipe.isPublished); return <><section className="today-menu"><div className="today-menu-head"><div><p className="eyebrow">CUSTOMER-FACING MENU</p><h2>Today’s menu</h2><p>Publish dishes here — customers will see only these on the order page.</p></div><a className="view-order-link" href={`/${slug}`} target="_blank" rel="noreferrer">View customer page <Icon name="arrow" size={15}/></a></div><div className="menu-board">{recipes.length===0?<p>Add recipes to build today’s menu.</p>:recipes.map(recipe=><div className={recipe.isPublished?'menu-dish live':'menu-dish'} key={recipe.id}><span>{recipe.emoji}</span><div><b>{recipe.name}</b><small>{recipe.category} · ₹{recipe.price}</small></div><button onClick={()=>onPublish(recipe)}>{recipe.isPublished?'Published':'Publish'}</button></div>)}</div><small className="menu-count">{published.length} dish{published.length===1?'':'es'} live for customers</small></section><section className="page-toolbar"><div className="tabs status-tabs" role="tablist" aria-label="Order status">{['All orders','New','Cooking','Ready','Delivered','Cancelled'].map(x=><button role="tab" aria-selected={filter===x} className={filter===x?'tab active-tab':'tab'} onClick={()=>setFilter(x)} key={x}>{x}<em className="tab-n">{x==='All orders'?statusCounts.all:statusCounts[x]||0}</em></button>)}</div><div className="filters"><button type="button" className="text-btn delivery-sheet-btn" onClick={onSheet}>Delivery sheet</button><select value={channelFilter} onChange={e=>setChannelFilter(e.target.value)} aria-label="Filter by channel"><option>All channels</option>{channels.map(c=><option key={c}>{c}</option>)}</select><select value={dateFilter} onChange={e=>setDateFilter(e.target.value)} aria-label="Filter by date"><option>All dates</option><option>Today</option><option>Tomorrow</option><option>Upcoming</option><option>Earlier</option></select></div><label className="search"><Icon name="search" size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search order or customer"/></label></section><section className="panel full-orders">{orders.length ? <OrderTable orders={orders} onStatus={onStatus} onEdit={onEdit} formatItems={formatItems} highlight={highlight} today={today} rname={rname} onPay={onPay} onCharge={onCharge} distance={distance}/> : <p className="no-results">No matching orders found.</p>}{!olderDone && onLoadOlder && <div className="load-older"><button type="button" className="text-btn" onClick={onLoadOlder}>Load older orders</button><small>Showing the last 60 days</small></div>}</section></> }
function RecipeOptionsEditor({ recipe, onAdd, onRemove }) {
  const [kind, setKind] = useState('extra'), [name, setName] = useState(''), [price, setPrice] = useState('')
  const ok = name.trim().length > 0 && (price === '' || Number(price) >= 0)
  return <div className="rc-options"><b>Sizes and extras</b>
    <small>A size is required when a dish has sizes (for example Half or Full). The price is added to the dish price. Extras are optional.</small>
    <ul>{(recipe.options || []).map(o => <li key={o.id}><span>{o.kind === 'size' ? 'Size' : 'Extra'} · {o.name} · +₹{Number(o.price_delta)}</span><button type="button" className="text-btn" aria-label={`Remove ${o.name}`} onClick={() => onRemove(recipe, o)}>Remove</button></li>)}</ul>
    <form className="rc-opt-form" onSubmit={e => { e.preventDefault(); if (!ok) return; onAdd(recipe, { kind, name, price }); setName(''); setPrice('') }}>
      <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Option type"><option value="extra">Extra</option><option value="size">Size</option></select>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name, e.g. Full" maxLength={40} aria-label="Option name" />
      <input value={price} onChange={e => setPrice(e.target.value)} placeholder="+₹" inputMode="numeric" aria-label="Option price" />
      <button className="primary app-btn" disabled={!ok}>Add</button>
    </form></div>
}
function RecipesPage({recipes,recipe,onSelect,onNew,onEdit,today,onSoldOut,onPhoto,onRemovePhoto,onLimit,onHalf,onAddOption,onRemoveOption}) { const pg = usePaged(recipes, 10, recipes.length); if (!recipe) return <section className="empty panel"><div className="empty-icon">🍽️</div><h2>Your recipe library is empty</h2><p>Create a recipe and it will be saved in Supabase.</p><button className="primary" onClick={onNew}>Add recipe</button></section>; return <div className="recipes-layout"><section className="panel recipe-list"><div className="panel-heading"><div><h3>Recipe library</h3><p>{recipes.length} recipes in your kitchen</p></div><button className="round-add" onClick={onNew}><Icon name="plus"/></button></div>{pg.items.map(r=><button className={recipe.id===r.id?'recipe-line selected':'recipe-line'} key={r.id} onClick={()=>onSelect(r)}>{r.imageUrl ? <img className="mini-photo" src={r.imageUrl} alt="" width="40" height="40"/> : <span className={`mini-art ${r.color}`}>{r.emoji}</span>}<div><b>{r.name}</b><small>{r.category} · ₹{r.price}{r.soldOutDate === today ? ' · sold out today' : ''}</small></div><span>›</span></button>)}</section><section className="panel recipe-detail"><div className="detail-top"><div className={`big-art ${recipe.color}`}>{recipe.emoji}</div><div><span className="eyebrow">{recipe.category}</span><h2>{recipe.name}</h2><p>Yield: 1 serving · {recipe.time} total time</p></div><button className="more" title="Edit recipe" onClick={()=>onEdit(recipe)}><Icon name="more"/></button></div><div className="recipe-ctrl">
        <div className="rc-photo">{recipe.imageUrl ? <img src={recipe.imageUrl} alt={`${recipe.name} photo`} width="72" height="72"/> : <span className="rc-noimg" aria-hidden="true">📷</span>}
          <div><b>Dish photo</b><small>Shown to customers on the menu.</small>
            <div className="rc-btns"><label className="text-btn rc-file">{recipe.imageUrl ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" aria-label="Dish photo" onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; onPhoto(recipe, f) }}/></label>{recipe.imageUrl && <button type="button" className="text-btn" onClick={() => onRemovePhoto(recipe)}>Remove</button>}</div></div></div>
        <div className="rc-sold"><div><b>Plates per day</b><small>Stops orders for a day once this many are ordered. Leave empty for no limit.</small></div>
          <input className="rc-limit" type="number" min="0" inputMode="numeric" aria-label="Plates per day" defaultValue={recipe.dailyLimit} key={recipe.id + ':' + recipe.dailyLimit} placeholder="no limit" onBlur={e => { if (String(e.target.value) !== String(recipe.dailyLimit)) onLimit(recipe, e.target.value) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></div>
        <div className="rc-sold"><div><b>Offer a half plate</b><small>{(recipe.options || []).some(o => o.kind === 'size') ? 'Not available while this dish has its own sizes.' : `Half price = full price ÷ 2 + ₹50, so ₹${Math.ceil(Number(recipe.price) / 2) + 50} for this dish. A half plate uses half the ingredients.`}</small></div>
          <button type="button" role="switch" aria-checked={Boolean(recipe.halfPlate)} aria-label={`Half plate: ${recipe.name}`} disabled={(recipe.options || []).some(o => o.kind === 'size')} className={recipe.halfPlate ? 'switch on ok' : 'switch'} onClick={() => onHalf(recipe)}><i/></button></div>
        <RecipeOptionsEditor recipe={recipe} onAdd={onAddOption} onRemove={onRemoveOption}/>
        <div className="rc-sold"><div><b>Sold out today</b><small>Customers see "Sold out" and can't add it. It switches itself off tomorrow.</small></div>
          <button type="button" role="switch" aria-checked={recipe.soldOutDate === today} aria-label={`Sold out today: ${recipe.name}`} className={recipe.soldOutDate === today ? 'switch on' : 'switch'} onClick={() => onSoldOut(recipe)}><i/></button></div>
      </div><div className="cost-banner"><div><span>SELLING PRICE</span><b>₹{recipe.price}</b></div><div><span>FOOD COST</span><b>{recipe.foodCost}%</b></div><div><span>GROSS MARGIN</span><b>{100-recipe.foodCost}%</b></div></div><div className="detail-columns"><div><h3>Ingredients</h3>{recipe.ingredients.map((x,i)=><div className="ingredient" key={x}><span>{i+1}</span>{x}</div>)}</div><div><h3>Making process</h3>{recipe.steps.map((x,i)=><div className="step" key={x}><span>{i+1}</span><p>{x}</p></div>)}</div></div></section></div> }
function Placeholder({page,notify}) { return <div className="empty panel"><div className="empty-icon">{page==='Inventory'?'◫':page==='Settings'?'⚙':'↗'}</div><h2>{page} is ready for you</h2><p>This workspace is set up for {page.toLowerCase()} tracking. Connect Supabase to begin saving live kitchen data.</p><button className="primary" onClick={()=>notify(`${page} setup started`)}>Set up {page}</button></div> }
function InventoryPage({inventory,onNew,onEdit}) { const pg = usePaged(inventory, 10, inventory.length); return <section className="panel data-page"><div className="panel-heading"><div><h3>Ingredient inventory</h3><p>Keep stock levels and reorder points in one place.</p></div><button className="primary" onClick={onNew}><Icon name="plus" size={16}/> Add ingredient</button></div><div className="inventory-head"><span>INGREDIENT</span><span>ON HAND</span><span>REORDER AT</span><span>UNIT COST</span><span>STATUS</span></div>{pg.items.map(i=>{const low=i.stock<=i.reorder;return <div className="inventory-row" key={i.id}><b>{i.name}</b><span>{i.stock} {i.unit}</span><span>{i.reorder} {i.unit}</span><span>₹{i.cost}</span><span className="inv-status"><span className={low?'stock low':'stock'}>{low?'Low stock':'In stock'}</span><button className="edit-order" onClick={()=>onEdit(i)}>Edit</button></span></div>})}<Pager p={pg} /></section> }
function ReportsPage({orders: allOrders,recipeList}) {
  const [view, setView] = useState('Combined')   // Combined = normal + bulk
  const orders = view === 'Normal' ? allOrders.filter(o => o.kind !== 'bulk') : view === 'Bulk' ? allOrders.filter(o => o.kind === 'bulk') : allOrders
  const counted = (l) => l.filter(o => o.status !== 'Cancelled' && o.paymentStatus !== 'pending')
  const split = ['Normal', 'Bulk', 'Combined'].map(k => { const l = counted(k === 'Normal' ? allOrders.filter(o => o.kind !== 'bulk') : k === 'Bulk' ? allOrders.filter(o => o.kind === 'bulk') : allOrders); return { k, n: l.length, sales: l.reduce((s, o) => s + Number(o.total || 0), 0), today: l.filter(o => daysAgo(o.createdAt, 0)).reduce((s, o) => s + Number(o.total || 0), 0) } })
  const all = analyse(orders, recipeList)
  const live = orders.filter(o => o.status !== 'Cancelled' && o.paymentStatus !== 'pending')
  const delivered = orders.filter(o => o.status === 'Delivered').length
  const days = Array.from({ length: 7 }, (_, k) => { const n = 6 - k, d = new Date(); d.setDate(d.getDate() - n); const dayOrders = live.filter(o => daysAgo(o.createdAt, n)); return { label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }), total: dayOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0), count: dayOrders.length } })
  const maxDay = Math.max(1, ...days.map(d => d.total))
  const channels = [...new Set(live.map(o => o.channel))]
  const topDishes = all.dishes.slice(0, 6), maxQty = Math.max(1, ...topDishes.map(d => d.qty))
  const money = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`
  const rated = orders.filter(o => o.rating > 0)
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }))
  live.forEach(o => { if (!o.createdAt) return; const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date(o.createdAt))); hours[h].count++ })
  const maxHour = Math.max(1, ...hours.map(h => h.count))
  const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, k) => ({ label, k, count: 0, sales: 0 }))
  live.forEach(o => { const key = o.deliveryDate || (o.createdAt || '').slice(0, 10); if (!key) return; const dow = (new Date(key + 'T00:00:00Z').getUTCDay() + 6) % 7; weekdays[dow].count++; weekdays[dow].sales += Number(o.total) || 0 })
  const maxWeekday = Math.max(1, ...weekdays.map(w => w.count))
  const soldByName = Object.fromEntries(all.dishes.map(d => [d.name.toLowerCase(), d]))
  const slow = recipeList.filter(r => r.isPublished).map(r => { const d = soldByName[r.name.toLowerCase()]; return { name: r.name, qty: d ? d.qty : 0, revenue: d ? d.revenue : 0 } }).sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name)).slice(0, 5)
  const slowMax = Math.max(1, ...slow.map(d => d.qty))
  const todays = orders.filter(o => daysAgo(o.createdAt, 0)), tLive = todays.filter(o => o.status !== 'Cancelled')
  const sum = (l) => l.reduce((s, o) => s + Number(o.total || 0), 0)
  const dayEnd = { orders: tLive.length, cancelled: todays.length - tLive.length, sales: sum(tLive), upiPaid: sum(tLive.filter(o => o.paymentStatus === 'received')), upiOwed: sum(tLive.filter(o => o.paymentStatus === 'pending')), cash: sum(tLive.filter(o => o.payment === 'Cash on delivery')), cashDone: sum(tLive.filter(o => o.payment === 'Cash on delivery' && o.status === 'Delivered')), open: tLive.filter(o => o.status !== 'Delivered').length }
  const bulkToday = { n: tLive.filter(o => o.kind === 'bulk').length, sum: sum(tLive.filter(o => o.kind === 'bulk')) }
  const bulkAll = live.filter(o => o.kind === 'bulk')
  const printDayEnd = () => { const w = window.open('', '_blank'); if (!w) return; const row = (a, b) => `<tr><td>${esc(a)}</td><td style="text-align:right"><b>${esc(b)}</b></td></tr>`; w.document.write(`<!doctype html><title>Day-end report</title><body style="font:16px system-ui;max-width:420px;margin:24px auto"><h2>Day-end report</h2><p>${esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p><table style="width:100%;border-collapse:collapse;line-height:2">${row('Orders (not cancelled)', dayEnd.orders)}${row('Cancelled', dayEnd.cancelled)}${row('Sales', money(dayEnd.sales))}${row('UPI received', money(dayEnd.upiPaid))}${row('UPI not yet confirmed', money(dayEnd.upiOwed))}${row('Cash on delivery (total)', money(dayEnd.cash))}${row('Cash already delivered', money(dayEnd.cashDone))}${row('Orders still open', dayEnd.open)}</table><script>window.print()<\/script>`); w.document.close() }
  const rupee = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
  return <><section className="panel report-split" aria-label="Normal, bulk and combined sales"><div className="panel-heading"><div><h3>Sales: normal, Big Table and total</h3><p>Cancelled orders and unconfirmed UPI payments are left out.</p></div></div>
    <div className="split-grid">{split.map(s => <div key={s.k} className={s.k === 'Combined' ? 'split-card total' : 'split-card'}><span>{s.k === 'Combined' ? 'Total (normal + Big Table)' : s.k === 'Normal' ? 'Normal orders' : 'Big Table orders'}</span><b>{rupee(s.sales)}</b><small>{s.n} order{s.n === 1 ? '' : 's'} · {rupee(s.today)} today</small></div>)}</div>
    <div className="bulk-tabs sub" role="tablist" aria-label="Show report for">{['Combined', 'Normal', 'Bulk'].map(v => <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'bulk-tab on' : 'bulk-tab'} onClick={() => setView(v)}>{v === 'Combined' ? 'Combined report' : v === 'Normal' ? 'Normal report' : 'Big Table report'}</button>)}</div></section>
  <section className="panel day-end" aria-label="Day-end report"><div className="panel-heading"><div><h3>Today so far</h3><p>For closing the day: sales, cash and UPI{bulkToday.n > 0 ? ` · includes ${bulkToday.n} Big Table order${bulkToday.n === 1 ? '' : 's'} (${money(bulkToday.sum)})` : ''}</p></div><button type="button" className="text-btn" onClick={printDayEnd}>Print</button></div><div className="day-end-grid"><div><span>Orders</span><b>{dayEnd.orders}</b></div><div><span>Sales</span><b>{money(dayEnd.sales)}</b></div><div><span>UPI received</span><b>{money(dayEnd.upiPaid)}</b></div><div><span>UPI not confirmed</span><b>{money(dayEnd.upiOwed)}</b></div><div><span>Cash to collect</span><b>{money(dayEnd.cash - dayEnd.cashDone)}</b></div><div><span>Still open</span><b>{dayEnd.open}</b></div></div></section><section className="report-stats"><Stat label="Recorded sales" value={money(all.sales)} change="Live" note={bulkAll.length ? `excludes cancelled · includes ${money(bulkAll.reduce((s, o) => s + Number(o.total || 0), 0))} Big Table orders` : 'excludes cancelled'}/><Stat label="Orders tracked" value={all.count} change={`${delivered} delivered`} note="last 60 days"/><Stat label="Average order value" value={money(all.aov)} change="Live" note="per order"/><Stat label="Est. gross profit" value={money(all.profit)} change={all.sales ? `${Math.round(all.profit / all.sales * 100)}% margin` : '—'} good note="sales minus recipe food cost"/></section>
  <section className="panel data-page"><div className="panel-heading"><div><h3>Sales — last 7 days</h3><p>Daily totals from recorded orders.</p></div></div>{days.map(d => <div className="report-row" key={d.label}><b>{d.label}</b><div className="bar"><i style={{ width: `${Math.round(d.total / maxDay * 100)}%` }}/></div><span>{money(d.total)}</span><small>{d.count}</small></div>)}</section>
  <section className="panel data-page report-gap"><div className="panel-heading"><div><h3>Best-selling dishes</h3><p>By quantity sold, with revenue.</p></div></div>{topDishes.length ? topDishes.map(d => <div className="report-row" key={d.name}><b title={d.name}>{d.name}</b><div className="bar"><i style={{ width: `${Math.round(d.qty / maxQty * 100)}%` }}/></div><span>{money(d.revenue)}</span><small>{d.qty}×</small></div>) : <p className="no-results">No dishes sold yet.</p>}</section>
  <section className="panel data-page report-gap"><div className="panel-heading"><div><h3>Sales by channel</h3><p>Share of recorded sales.</p></div></div>{channels.length ? channels.map(channel => { const total = live.filter(o => o.channel === channel).reduce((n, o) => n + (Number(o.total) || 0), 0), width = all.sales ? Math.round(total / all.sales * 100) : 0; return <div className="report-row" key={channel}><b>{channel}</b><div className="bar"><i style={{ width: `${width}%` }}/></div><span>{money(total)}</span><small>{width}%</small></div> }) : <p className="no-results">No orders yet.</p>}</section>
  <section className="panel data-page report-gap" aria-label="Busy hours"><div className="panel-heading"><div><h3>Busiest hours</h3><p>When orders are placed (India time), last 60 days.</p></div></div>{hours.some(h => h.count) ? hours.filter(h => h.count || (h.hour >= 9 && h.hour <= 22)).map(h => <div className="report-row" key={h.hour}><b>{hourLabel(h.hour)}</b><div className="bar"><i style={{ width: `${Math.round(h.count / maxHour * 100)}%` }}/></div><span>{h.count ? `${h.count} order${h.count === 1 ? '' : 's'}${h.count === maxHour ? ' · peak' : ''}` : ''}</span></div>) : <p className="no-results">No orders yet.</p>}</section>
  <section className="panel data-page report-gap" aria-label="Busy days"><div className="panel-heading"><div><h3>Busiest days of the week</h3><p>Orders by the day they are delivered.</p></div></div>{weekdays.some(w => w.count) ? weekdays.map(w => <div className="report-row" key={w.label}><b>{w.label}</b><div className="bar"><i style={{ width: `${Math.round(w.count / maxWeekday * 100)}%` }}/></div><span>{money(w.sales)}</span><small>{w.count}</small></div>) : <p className="no-results">No orders yet.</p>}</section>
  <section className="panel data-page report-gap" aria-label="Slow sellers"><div className="panel-heading"><div><h3>Slow sellers</h3><p>Dishes on the menu that sold least. Think about promoting or replacing them.</p></div></div>{slow.length ? slow.map(d => <div className="report-row" key={d.name}><b title={d.name}>{d.name}</b><div className="bar"><i style={{ width: `${Math.round(d.qty / (slowMax || 1) * 100)}%` }}/></div><span>{d.qty ? money(d.revenue) : 'never ordered'}</span><small>{d.qty}×</small></div>) : <p className="no-results">Add dishes to the menu to see this.</p>}</section>
  <section className="panel data-page report-gap" aria-label="Customer ratings"><div className="panel-heading"><div><h3>Customer ratings</h3><p>Stars customers give after delivery.</p></div></div>{rated.length ? <><p className="rate-sum"><b>{(rated.reduce((n, o) => n + o.rating, 0) / rated.length).toFixed(1)}</b> ★ average from {rated.length} rating{rated.length === 1 ? '' : 's'}</p>{[5, 4, 3, 2, 1].map(n => { const c = rated.filter(o => o.rating === n).length; return <div className="report-row" key={n}><b>{n} ★</b><div className="bar"><i style={{ width: `${Math.round(c / rated.length * 100)}%` }}/></div><span>{c}</span><small>{Math.round(c / rated.length * 100)}%</small></div> })}<ul className="rate-list">{rated.filter(o => o.ratingComment).sort((a, b) => a.rating - b.rating).slice(0, 6).map(o => <li key={o.id}><b>{'★'.repeat(o.rating)}{'☆'.repeat(5 - o.rating)}</b> {o.ratingComment}<small>{o.id} · {String(o.customer || '').split('·')[0].trim()}</small></li>)}</ul></> : <p className="no-results">No ratings yet. Customers can rate an order once it is delivered.</p>}</section></> }
function SettingsPage({settings,onSave}) { const [form,setForm]=useState(settings), [ping,setPing]=useState(''); const change=(key,value)=>setForm(current=>({...current,[key]:value})); const testConnection=async()=>{ if(!supabase) return setPing('Error: Supabase variables are missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, then restart the app.'); setPing('Pinging Supabase…'); const started=performance.now(); try { const {error}=await supabase.from('orders').select('id',{head:true,count:'exact'}).limit(1); if (error) { const extra=[error.code && `Code: ${error.code}`, error.details, error.hint && `Hint: ${error.hint}`].filter(Boolean).join(' · '); return setPing(`Error: ${error.message}${extra ? ` (${extra})` : ''}`) } setPing(`Pong! Supabase responded in ${Math.round(performance.now()-started)} ms.`) } catch (error) { setPing(`Error: ${error.message || 'Network request failed.'}`) } }; return <section className="settings-page"><div className="panel settings-card"><div className="panel-heading"><div><h3>Kitchen profile</h3><p>Used across your kitchen workspace and reports.</p></div></div><div className="settings-form"><label>Kitchen name<input value={form.kitchenName} disabled/></label><label>Location (shown to customers)<input value={form.location} onChange={e=>change('location',e.target.value)} placeholder="e.g. Pune" maxLength={60}/></label><div className="two"><label>Currency<select value={form.currency} onChange={e=>change('currency',e.target.value)}><option>INR (₹)</option><option>USD ($)</option><option>GBP (£)</option></select></label><label>Default tax rate<input value={form.taxRate} onChange={e=>change('taxRate',e.target.value)} type="number" min="0" step="0.1"/></label></div><button className="primary" onClick={()=>onSave(form)}>Save kitchen profile</button></div></div><div className="panel connection-card"><div><span className={supabase?'connection-dot connected':'connection-dot'}/><div><h3>Supabase connection</h3><p>{supabase ? 'Your project credentials are configured.' : 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.'}</p>{ping && <p className={ping.startsWith('Pong')?'ping-success':'ping-message'}>{ping}</p>}</div></div><div className="connection-actions"><span className={supabase?'stock':'stock low'}>{supabase?'Configured':'Not configured'}</span><button className="text-btn" onClick={testConnection}>Ping Supabase</button></div></div></section> }
function RejectPaymentDialog({ order, close, onConfirm }) {
  const [reason, setReason] = useState('')
  const quick = ['Payment not received yet', 'Amount is less than the order total', 'Transaction ID does not match']
  const ok = reason.trim().length >= 3
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Reject payment" onClick={e => e.target === e.currentTarget && close()}>
    <form className="modal cancel-dialog" onSubmit={e => { e.preventDefault(); if (ok) onConfirm(reason.trim()) }}>
      <h3>Reject the payment for {order.id}?</h3>
      <p className="cancel-help">The order stays open. The customer sees this reason and can pay again or send the right transaction ID.</p>
      <div className="cancel-chips">{quick.map(q => <button type="button" key={q} className={reason === q ? 'chip on' : 'chip'} onClick={() => setReason(q)}>{q}</button>)}</div>
      <label>Reason<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={200} rows={3} placeholder="Tell the customer why" autoFocus /></label>
      <div className="cancel-actions"><button type="button" className="text-btn" onClick={close}>Back</button><button className="primary danger" disabled={!ok}>Reject payment</button></div>
    </form>
  </div>
}
function PaymentDialog({ order, then, close, onConfirm, onReject, notify }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm UPI payment" onClick={e => e.target === e.currentTarget && close()}>
    <div className="modal pay-dialog">
      <h3>Did you receive the UPI payment?</h3>
      <p className="cancel-help">Check your UPI app or bank for <b>₹{order.total}</b> from <b>{String(order.customer || '').split('·')[0].trim()}</b>{customerPhone(order) ? ` (${customerPhone(order)})` : ''}. Use the order number <b>{order.id}</b> to match it.</p>
      {order.paymentClaimedAt ? <p className="pay-txn"><b>Customer says they paid.</b>{order.paymentTxn ? <> Transaction ID: <code>{order.paymentTxn}</code> <CopyButton text={order.paymentTxn} label="Copy" aria="Copy transaction ID"/></> : ' They did not send a transaction ID.'}</p> : order.paymentRejectReason ? <p className="pay-txn">Rejected earlier: {order.paymentRejectReason}</p> : <p className="pay-txn">The customer has not said they paid yet.</p>}
      <p className="pay-warn">{then ? `Only confirm if the money has arrived. ${order.id} then moves to ${then}.` : 'Only confirm if the money has arrived. After this the order can be cooked.'}</p>
      <div className="cancel-actions"><button type="button" className="text-btn" onClick={close}>Not yet</button><button type="button" className="text-btn" onClick={onReject}>Reject payment</button><button type="button" className="primary app-btn" onClick={onConfirm}>Yes, payment received</button></div>
    </div>
  </div>
}
function CancelDialog({ id, close, onConfirm }) {
  const [reason, setReason] = useState('')
  const quick = ['Item out of stock', 'Outside our delivery area', 'Kitchen closed that day', 'Customer asked to cancel', 'Could not reach customer']
  const ok = reason.trim().length >= 3
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Cancel order" onClick={e => e.target === e.currentTarget && close()}>
    <form className="modal cancel-dialog" onSubmit={e => { e.preventDefault(); if (ok) onConfirm(reason.trim()) }}>
      <h3>Cancel order {id}?</h3>
      <p className="cancel-help">The customer will see this reason when they track their order.</p>
      <div className="cancel-chips">{quick.map(q => <button type="button" key={q} className={reason === q ? 'chip on' : 'chip'} onClick={() => setReason(q)}>{q}</button>)}</div>
      <label>Reason<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={200} rows={3} placeholder="Tell the customer why" autoFocus /></label>
      <div className="cancel-actions"><button type="button" className="text-btn" onClick={close}>Keep order</button><button className="primary danger" disabled={!ok}>Cancel order</button></div>
    </form>
  </div>
}
function OrderEditor({order,close,onSave}) {
  const parseLines = (items) => Array.isArray(items) ? items.map(item => typeof item === 'string' ? { quantity: 1, name: item } : item) : (items || '').split(' · ').map(part => { const match = part.match(/(\d+)×\s*(.*)/); return { quantity: match ? match[1] : 1, name: match ? match[2] : part } })
  const [locked, setLocked] = useState(Boolean(order))   // existing orders open read-only; editing has to be switched on
  const [customer, setCustomer] = useState(order?.customer || '')
  const [phone, setPhone] = useState(order?.phone || '')
  const [channel, setChannel] = useState(order?.channel || 'Direct')
  const [total, setTotal] = useState(order?.total || '')
  const [address, setAddress] = useState(order?.address || '')
  const [deliveryDate, setDeliveryDate] = useState(order?.deliveryDate || new Date().toLocaleDateString('en-CA'))
  const [payment, setPayment] = useState(order?.payment || 'Cash on delivery')
  const [items, setItems] = useState(order ? parseLines(order.items) : [{ name: '', quantity: 1 }])
  const [formError, setFormError] = useState('')
  const changeItem = (index, field, value) => setItems(current => current.map((item, i) => i === index ? { ...item, [field]: value } : item))
  const submit = (e) => {
    e.preventDefault()
    if (locked) return
    const digits = phone.replace(/\D/g, '').slice(-10)
    if (digits.length !== 10 || !/^[6-9]/.test(digits)) return setFormError('Enter a valid 10-digit mobile number for the customer.')
    if (!address.trim()) return setFormError('Delivery address is required.')
    if (!deliveryDate) return setFormError('Choose a delivery date.')
    setFormError(''); onSave({ customer, phone: digits, channel, total, items, address: address.trim(), payment, deliveryDate })
  }
  return <div className="modal-backdrop"><form className={locked ? 'modal order-modal is-locked' : 'modal order-modal'} onSubmit={submit}>
    <button type="button" className="modal-close" aria-label="Close" onClick={close}><Icon name="close"/></button>
    <span className="eyebrow">ORDERS</span>
    <h2>{order ? (locked ? order.id : `Edit ${order.id}`) : 'Record a new order'}</h2>
    {order && <div className={locked ? 'lock-bar' : 'lock-bar open'} role="status"><span>{locked ? 'Viewing only. Editing is off.' : 'Editing is on. Changes are saved when you press Save.'}</span>{locked && <button type="button" className="lock-btn" onClick={() => setLocked(false)}>Enable editing</button>}</div>}
    <label>Customer name<input required readOnly={locked} value={customer} onChange={e=>setCustomer(e.target.value)} placeholder="Customer or order name"/></label>
    <label>Customer phone <small>required</small><input required readOnly={locked} value={phone} onChange={e=>setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="off" maxLength={16} placeholder="10-digit mobile number" aria-label="Customer phone"/></label>
    <div className="two"><label>Channel<select disabled={locked} value={channel} onChange={e=>setChannel(e.target.value)}><option>Direct</option><option>Swiggy</option><option>Zomato</option>{channel==='Customer form' && <option>Customer form</option>}</select></label><label>Order total<input required readOnly={locked} value={total} onChange={e=>setTotal(e.target.value)} type="number" min="0" placeholder="0"/></label></div>
    <div className="addr-field"><div className="addr-head"><label htmlFor="order-address">Delivery address <small>required</small></label><CopyButton text={address} label="Copy address" aria="Copy address"/></div><textarea id="order-address" required readOnly={locked} rows={3} value={address} onChange={e=>setAddress(e.target.value)} placeholder="House / building, area, landmark"/></div>
    <label>Delivery date<input type="date" required readOnly={locked} value={deliveryDate} onChange={e=>setDeliveryDate(e.target.value)}/></label>
    <label>Payment method<select disabled={locked} value={payment} onChange={e=>setPayment(e.target.value)}>{[...new Set(['Cash on delivery','UPI', payment])].map(m=><option key={m}>{m}</option>)}</select></label>
    <div className="line-items"><div className="line-title"><b>Order items</b><span>Item name and quantity</span></div>{items.map((item,index)=><div className="line-item" key={index}><input aria-label={`Item ${index+1} name`} required readOnly={locked} value={item.name} onChange={e=>changeItem(index,'name',e.target.value)} placeholder="Item name"/><input aria-label={`Item ${index+1} quantity`} required readOnly={locked} value={item.quantity} onChange={e=>changeItem(index,'quantity',e.target.value)} type="number" min="1" placeholder="Qty"/><button type="button" aria-label="Remove item" disabled={locked || items.length===1} onClick={()=>setItems(current=>current.filter((_,i)=>i!==index))}>×</button></div>)}{!locked && <button type="button" className="add-line" onClick={()=>setItems(current=>[...current,{name:'',quantity:1}])}><Icon name="plus" size={15}/> Add another item</button>}</div>
    {formError && <p className="form-error" role="alert">{formError}</p>}
    {locked ? <button type="button" className="primary submit" onClick={close}>Close</button> : <button className="primary submit">{order ? 'Save changes' : 'Add order'} <Icon name="arrow" size={16}/></button>}
  </form></div>
}
function Modal({type,close,save,saveRecipe,saveInventory,editing,onDelete}) { if (type === 'order') return <OrderEditor close={close} onSave={save}/>; const recipe = type === 'recipe', inventory = type === 'inventory', submit = recipe ? saveRecipe : saveInventory; return <div className="modal-backdrop"><form className="modal" onSubmit={submit}><button type="button" className="modal-close" onClick={close}><Icon name="close"/></button><span className="eyebrow">{recipe?'RECIPE LIBRARY':'INVENTORY'}</span><h2>{recipe?(editing?'Edit recipe':'Add a new recipe'):(editing?'Edit ingredient':'Add an ingredient')}</h2>{recipe ? <><label>Recipe name<input required name="name" defaultValue={editing?.name} placeholder="e.g. Smoky Paneer Bowl"/></label><div className="two"><label>Menu price<input required name="price" type="number" step="any" defaultValue={editing?.price} placeholder="349"/></label><label>Prep time<input required name="time" defaultValue={editing?.time} placeholder="25 min"/></label></div><div className="two"><label>Category<input name="category" defaultValue={editing?.category} placeholder="Mains"/></label><label>Veg or non-veg<select name="diet" aria-label="Veg or non-veg" defaultValue={editing?.diet || ''}><option value="">Not set</option><option value="veg">Veg</option><option value="nonveg">Non-veg</option></select></label><label>Food cost %<input name="foodCost" type="number" step="any" defaultValue={editing?.foodCost} placeholder="30"/></label></div><label>Ingredients <small>— one per line: name | amount | unit. Use the same name as in Inventory to deduct stock automatically.</small><textarea required name="ingredients" defaultValue={editing ? (editing.ingredientRows || []).map(r => [r.name, r.quantity, r.unit].filter(v => v !== null && v !== undefined && v !== '').join(' | ')).join('\n') : ''} placeholder={'Paneer | 0.25 | kg\nOnion | 0.1 | kg'}/></label><label>Making process<textarea required name="steps" defaultValue={editing?.steps.join('\n')} placeholder="One step per line"/></label><label className="publish-check"><input name="isPublished" type="checkbox" defaultChecked={editing?.isPublished}/> Publish to today’s customer menu</label></> : <><label>Ingredient name<input required name="name" defaultValue={editing?.name} placeholder="e.g. Paneer"/></label><div className="two"><label>Current stock<input required name="stock" type="number" step="any" min="0" defaultValue={editing?.stock} placeholder="0"/></label><label>Unit<input required name="unit" defaultValue={editing?.unit} placeholder="kg, packs, cans"/></label></div><div className="two"><label>Reorder point<input required name="reorder" type="number" step="any" min="0" defaultValue={editing?.reorder} placeholder="0"/></label><label>Unit cost<input required name="cost" type="number" step="any" min="0" defaultValue={editing?.cost} placeholder="0"/></label></div></>}<button className="primary submit">{editing?'Save changes':(recipe?'Save recipe':'Add ingredient')} <Icon name="arrow" size={16}/></button>{editing && <button type="button" className="text-btn" style={{marginTop:12,color:'#c0392b'}} onClick={onDelete}>Delete {recipe?'recipe':'ingredient'}</button>}</form></div> }

export default App
