import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './supabase'
import { useRestaurants, themeStyle, Mark, zonedNow, addDaysIso, dayLabel, dateText, deliveryText } from './restaurants'
import { RestaurantSwitcher, OpenToggle, OrderAlerts, RestaurantSettings, LiveStrip, OrderLimitsSettings, AppInstallCard, systemNotify, GoalCard } from './staffparts'
import './styles.css'
import './staff.css'
import { PublicRouter, AdminLogin, copyText } from './public'

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
  return item && item.name ? { name: String(item.name), quantity: Number(item.quantity) || 1, price: item.price == null ? null : Number(item.price) } : null
}).filter(Boolean)
const daysAgo = (iso, n) => { if (!iso) return false; const d = new Date(iso), t = new Date(); t.setDate(t.getDate() - n); return d.toDateString() === t.toDateString() }
function analyse(orders, recipes) {
  const byName = Object.fromEntries(recipes.map(r => [r.name.toLowerCase(), r]))
  const list = orders.filter(o => o.status !== 'Cancelled')
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
const mapOrder = (o) => ({ id:o.order_number, restaurantId:o.restaurant_id, deliveryDate:o.delivery_date, cancelReason:o.cancel_reason || '', phone:o.customer_phone || '', customer:o.customer_name || 'Walk-in guest', channel:o.channel, total:Number(o.total), time:new Date(o.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }), status:o.status, items:o.items || [], address:o.delivery_address || '', payment:o.payment_method || '', placed:new Date(o.created_at).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }), createdAt:o.created_at, avatar:(o.customer_name || 'WG').split(' ').map(x=>x[0]).join('').slice(0,2) })
// Orders are listed by delivery date: today and later first (soonest first), then earlier days (most recent first)
const deliveryKey = (o) => o.deliveryDate || (o.createdAt ? o.createdAt.slice(0, 10) : '')
const sortByDelivery = (list, today) => [...list].sort((a, b) => {
  const da = deliveryKey(a), db = deliveryKey(b), fa = da >= today, fb = db >= today
  if (fa !== fb) return fa ? -1 : 1
  if (da !== db) return fa ? (da < db ? -1 : 1) : (da > db ? -1 : 1)
  return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1
})
function CopyButton({ text, label = 'Copy', aria = 'Copy', className = 'copy-mini' }) {
  const [done, setDone] = useState(false)
  return <button type="button" className={className} disabled={!text} aria-label={aria} onClick={async (e) => { e.stopPropagation(); await copyText(text); setDone(true); setTimeout(() => setDone(false), 1800) }}>{done ? 'Copied' : label}</button>
}
const ticketBrand = { name: 'Kitchen' }  // set by the dashboard to the restaurant being managed
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
function printTicket(o) {
  const w = window.open('', '_blank', 'width=380,height=640')
  if (!w) return window.alert('Please allow pop-ups to print the ticket.')
  const rows = orderLines(o).map(l => `<tr><td>${esc(l.quantity)}×</td><td>${esc(l.name)}</td><td class="r">${l.price ? '₹' + esc(l.price * l.quantity) : ''}</td></tr>`).join('')
  w.document.write(`<!doctype html><html><head><title>${esc(o.id)}</title><style>body{font:13px/1.45 'Courier New',monospace;margin:18px;color:#000}h1{font-size:16px;margin:0 0 2px}hr{border:0;border-top:1px dashed #000;margin:10px 0}table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}.r{text-align:right}.big{font-size:15px;font-weight:bold}</style></head><body><h1>${esc(ticketBrand.name)}</h1><div>${esc(o.placed || o.time)}</div><div class="big">Deliver: ${esc(deliveryText(o.deliveryDate, ''))}</div><hr><div class="big">${esc(o.id)}</div><div>${esc(o.channel)} · ${esc(o.status)}</div><div>${esc(o.customer)}</div>${o.address ? `<div>${esc(o.address)}</div>` : ''}${o.payment ? `<div>Payment: ${esc(o.payment)}</div>` : ''}<hr><table>${rows}</table><hr><div class="big">Total: ₹${esc(o.total)}</div></body></html>`)
  w.document.close(); w.focus(); setTimeout(() => w.print(), 250)
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
  const [page, setPage] = useState('Overview')
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
  const reloadRef = useRef(null)
  useEffect(() => { soundRef.current = soundOn; try { localStorage.setItem('kitchen-sound', soundOn ? '1' : '0') } catch { /* optional */ } }, [soundOn])
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
    if (soundRef.current) playBeep()
    systemNotify(order, rest.name)
    if (document.hidden) document.title = `🔔 New order · ${rest.name}`
  }
  const catchUpOthers = async (activeId) => {   // orders for the other restaurant that arrived while we were away or offline
    if (!supabase) return
    const since = new Date(lastSeenRef.current - 120000).toISOString()
    const { data, error } = await supabase.from('orders').select('*').eq('channel', 'Customer form').eq('status', 'New').gt('created_at', since)
    if (error || !data) return
    data.filter(o => o.restaurant_id !== activeId).forEach(o => { const rest = restaurantsRef.current.find(x => x.id === o.restaurant_id); if (rest) raiseAlert(mapOrder(o), rest) })
  }
  useEffect(() => {   // remember when we were last connected, so a catch-up knows how far back to look
    const t = setInterval(() => { if (liveRef.current) lastSeenRef.current = Date.now() }, 30000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (!supabase || !session || !active || !active.id) return
    const rid = active.id
    setOrders([]); setRecipeList([]); setSelectedRecipe(null); setInventory([])
    const loadKitchenData = async () => {
      lastLoadRef.current = Date.now()
      const [ordersResult, recipesResult, inventoryResult] = await Promise.all([
        supabase.from('orders').select('*').eq('restaurant_id', rid).order('created_at', { ascending: false }),
        supabase.from('recipes').select('*, recipe_ingredients(*)').eq('restaurant_id', rid).order('created_at', { ascending: false }),
        supabase.from('inventory_items').select('*').eq('restaurant_id', rid).order('name')
      ])
      if (activeRef.current && activeRef.current.id !== rid) return  // switched restaurant while loading
      if (!ordersResult.error) {
        const mapped = (ordersResult.data || []).map(mapOrder)
        const prev = knownRef.current
        if (prev && prev.restaurantId === rid) {   // a reload after being away or offline: alert for customer orders we have not seen yet
          const fresh = mapped.filter(o => !prev.ids.has(o.id) && o.channel === 'Customer form' && o.status === 'New')
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
        const list = (recipesResult.data || []).map((r, index) => ({ id:r.id, name:r.name, category:r.category || 'Mains', time:`${r.prep_minutes || 0} min`, foodCost:Number(r.food_cost || 0), price:Number(r.selling_price || 0), isPublished:Boolean(r.is_published), stock:'Good', color:['coral','olive','violet'][index % 3], emoji:'🍽️', ingredients:(r.recipe_ingredients || []).map(ingredientLabel), ingredientRows:(r.recipe_ingredients || []).map(rowToView), steps:(r.instructions || '').split('\n').filter(Boolean) }))
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
        if (o.channel === 'Customer form') raiseAlert(mapped, owner)   // alerts for BOTH restaurants, whichever one is open
        const rest = activeRef.current
        if (!rest || o.restaurant_id !== rest.id) return   // the order list, badges and stock only ever show the open restaurant
        setOrders(current => current.some(x => x.id === mapped.id) ? current : [{ ...mapped, time: 'Just now' }, ...current])
        if (knownRef.current && knownRef.current.restaurantId === rest.id) knownRef.current.ids.add(mapped.id)
        refreshInventory()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, payload => { const o = payload.new; if (activeRef.current && o.restaurant_id && o.restaurant_id !== activeRef.current.id) return; setOrders(current => current.map(x => x.id === o.order_number ? { ...x, status:o.status, total:Number(o.total) } : x)) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, payload => { const rest = activeRef.current, row = (payload.new && payload.new.restaurant_id) ? payload.new : payload.old; if (rest && (!row || !row.restaurant_id || row.restaurant_id === rest.id)) refreshInventory() })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') { const wasDown = liveRef.current === false; liveRef.current = true; setLive(true); if (wasDown && reloadRef.current) reloadRef.current() }   // back online: fetch what we missed
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) { liveRef.current = false; setLive(false) }
      })
    return () => { supabase.removeChannel(channel) }
  }, [Boolean(session)])
  const formatItems = (items) => Array.isArray(items) ? items.map(item => typeof item === 'string' ? item : `${item.quantity}× ${item.name}`).join(' · ') : items
  const filtered = useMemo(() => sortByDelivery(orders.filter(o => {
    const textMatch = `${o.customer} ${o.id} ${formatItems(o.items)}`.toLowerCase().includes(query.toLowerCase())
    const statusMatch = orderFilter === 'All orders' || (orderFilter === 'Active' ? o.status !== 'Delivered' : o.status === 'Delivered')
    const channelMatch = channelFilter === 'All channels' || o.channel === channelFilter
    const dk = deliveryKey(o)
    const dateMatch = dateFilter === 'All dates' || (dateFilter === 'Today' ? dk === todayIso : dateFilter === 'Tomorrow' ? dk === addDaysIso(todayIso, 1) : dateFilter === 'Upcoming' ? dk > todayIso : dk < todayIso)
    return textMatch && statusMatch && channelMatch && dateMatch
  }), todayIso), [orders, query, orderFilter, channelFilter, dateFilter, todayIso])
  const notify = (text) => { setToast(text); setTimeout(() => setToast(''), 2600) }
  const nav = [['Overview', 'grid'], ['Orders', 'receipt'], ['To cook', 'pot'], ['Recipes', 'book'], ['Inventory', 'boxes'], ['Reports', 'chart']]
  const setStatus = async (id, status, reason = '') => { const cancel_reason = status === 'Cancelled' ? reason : null; if(supabase){const {error}=await supabase.from('orders').update({status, cancel_reason}).eq('order_number',id);if(error)return notify(`Could not update status: ${error.message}`)} setOrders(current => current.map(o => o.id === id ? {...o, status, cancelReason: cancel_reason || ''} : o)); notify(`Order updated to ${status}`) }
  const [cancelFor, setCancelFor] = useState(null)
  const requestStatus = (id, status) => status === 'Cancelled' ? setCancelFor(id) : setStatus(id, status)
  const saveOrder = async (details) => { const lines = details.items.filter(item => item.name.trim() && Number(item.quantity) > 0).map(item => ({ name: item.name.trim(), quantity: Number(item.quantity) })); if (!lines.length) return notify('Add at least one item'); const order = { id: newOrderNumber(active.order_prefix || 'ORD'), customer: details.customer, phone: details.phone, channel: details.channel, total: Number(details.total), time: 'Just now', placed: 'Just now', createdAt: new Date().toISOString(), deliveryDate: details.deliveryDate, status: 'New', items: lines, address: details.address || '', payment: details.payment || 'Cash on delivery', avatar: details.customer.split(' ').map(x=>x[0]).join('').slice(0,2) }; if (supabase) { const { error } = await supabase.from('orders').insert({ restaurant_id: active.id, order_number: order.id, customer_name: order.customer, customer_phone: order.phone, channel: order.channel, total: order.total, status: order.status, items: order.items, delivery_address: order.address, delivery_date: order.deliveryDate, payment_method: order.payment }); if (error) return notify(`Could not save order: ${error.message}`) }; setOrders([order, ...orders]); setModal(null); notify(supabase ? 'Order saved to Supabase' : 'New order added') }
  const updateOrder = async (details) => { const lines = details.items.filter(item => item.name.trim() && Number(item.quantity) > 0).map(item => ({ name: item.name.trim(), quantity: Number(item.quantity), ...(item.price != null ? { price: item.price } : {}) })); if (!lines.length) return notify('Add at least one item'); const updated = { ...editingOrder, customer: details.customer, phone: details.phone, channel: details.channel, total: Number(details.total), items: lines, address: details.address || '', deliveryDate: details.deliveryDate || editingOrder.deliveryDate, payment: details.payment || editingOrder.payment || 'Cash on delivery', avatar: details.customer.split(' ').map(x=>x[0]).join('').slice(0,2) }; if (supabase) { const { error } = await supabase.from('orders').update({ customer_name: updated.customer, customer_phone: updated.phone, channel: updated.channel, total: updated.total, items: lines, delivery_address: updated.address, delivery_date: updated.deliveryDate, payment_method: updated.payment }).eq('order_number', updated.id); if (error) return notify(`Could not update order: ${error.message}`) }; setOrders(current => current.map(order => order.id === updated.id ? updated : order)); setEditingOrder(null); notify(supabase ? 'Order updated in Supabase' : 'Order updated') }
  const saveRecipe = async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const rows=parseIngredientLines(f.get('ingredients'),inventory), steps=f.get('steps').split('\n').filter(Boolean); const record={name:f.get('name'),category:f.get('category') || 'Mains',prep_minutes:parseInt(f.get('time')) || 0,selling_price:Number(f.get('price')),food_cost:Number(f.get('foodCost') || 0),instructions:steps.join('\n'),is_published:f.get('isPublished')==='on'}; let recipeId=Date.now(); if(supabase){const {data,error}=await supabase.from('recipes').insert({ ...record, restaurant_id: active.id }).select().single();if(error)return notify(`Could not save recipe: ${error.message}`);recipeId=data.id;const {error:ingredientError}=await supabase.from('recipe_ingredients').insert(rows.map(r=>({recipe_id:data.id,...r})));if(ingredientError)return notify(`Recipe saved, but ingredients failed: ${ingredientError.message}`)} const newRecipe={id:recipeId,name:record.name,category:record.category,time:`${record.prep_minutes} min`,price:record.selling_price,foodCost:record.food_cost,isPublished:record.is_published,stock:'Good',color:'coral',emoji:'🍽️',ingredients:rows.map(ingredientLabel),ingredientRows:rows.map(rowToView),steps};setRecipeList(list=>[...list,newRecipe]);setSelectedRecipe(newRecipe);setModal(null);notify('Recipe and menu price saved') }
  const togglePublished = async (recipe) => { const isPublished=!recipe.isPublished; if(supabase){const {error}=await supabase.from('recipes').update({is_published:isPublished}).eq('id',recipe.id);if(error)return notify(`Could not update menu: ${error.message}`)} setRecipeList(list=>list.map(item=>item.id===recipe.id?{...item,isPublished}:item));notify(isPublished ? `${recipe.name} published to today’s menu` : `${recipe.name} removed from today’s menu`) }
  const updateRecipe = async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const rows=parseIngredientLines(f.get('ingredients'),inventory), steps=f.get('steps').split('\n').filter(Boolean); const record={name:f.get('name'),category:f.get('category') || 'Mains',prep_minutes:parseInt(f.get('time')) || 0,selling_price:Number(f.get('price')),food_cost:Number(f.get('foodCost') || 0),instructions:steps.join('\n'),is_published:f.get('isPublished')==='on'}; if(supabase){const {error}=await supabase.from('recipes').update(record).eq('id',editingRecipe.id);if(error)return notify(`Could not update recipe: ${error.message}`);const {error:delError}=await supabase.from('recipe_ingredients').delete().eq('recipe_id',editingRecipe.id);if(delError)return notify(`Could not update ingredients: ${delError.message}`);const {error:insError}=await supabase.from('recipe_ingredients').insert(rows.map(r=>({recipe_id:editingRecipe.id,...r})));if(insError)return notify(`Could not update ingredients: ${insError.message}`)} const updated={...editingRecipe,name:record.name,category:record.category,time:`${record.prep_minutes} min`,price:record.selling_price,foodCost:record.food_cost,isPublished:record.is_published,ingredients:rows.map(ingredientLabel),ingredientRows:rows.map(rowToView),steps}; setRecipeList(list=>list.map(r=>r.id===updated.id?updated:r)); setSelectedRecipe(updated); setEditingRecipe(null); notify('Recipe updated') }
  const deleteRecipe = async () => { if(!window.confirm(`Delete "${editingRecipe.name}"?`)) return; if(supabase){const {error}=await supabase.from('recipes').delete().eq('id',editingRecipe.id);if(error)return notify(`Could not delete recipe: ${error.message}`)} const remaining=recipeList.filter(r=>r.id!==editingRecipe.id); setRecipeList(remaining); setSelectedRecipe(remaining[0] || null); setEditingRecipe(null); notify('Recipe deleted') }
  const readInventoryForm = (form) => { const f = new FormData(form); return { name: String(f.get('name')).trim(), current_stock: Number(f.get('stock')), unit: f.get('unit'), reorder_level: Number(f.get('reorder')), unit_cost: Number(f.get('cost')) } }
  const toItem = (id, r) => ({ id, name: r.name, stock: r.current_stock, unit: r.unit, reorder: r.reorder_level, cost: r.unit_cost })
  const saveInventory = async (e) => { e.preventDefault(); const record = readInventoryForm(e.currentTarget); let id = Date.now(); if (supabase) { const { data, error } = await supabase.from('inventory_items').insert({ ...record, restaurant_id: active.id }).select().single(); if (error) return notify(`Could not save ingredient: ${error.message}`); id = data.id } setInventory(list => [...list.filter(i => i.id !== id), toItem(id, record)].sort((a, b) => a.name.localeCompare(b.name))); setModal(null); notify('Ingredient saved') }
  const updateInventory = async (e) => { e.preventDefault(); const record = readInventoryForm(e.currentTarget); if (supabase) { const { error } = await supabase.from('inventory_items').update({ ...record, updated_at: new Date().toISOString() }).eq('id', editingItem.id); if (error) return notify(`Could not update ingredient: ${error.message}`) } setInventory(list => list.map(i => i.id === editingItem.id ? toItem(editingItem.id, record) : i).sort((a, b) => a.name.localeCompare(b.name))); setEditingItem(null); notify('Ingredient updated') }
  const deleteInventory = async () => { if (!window.confirm(`Delete "${editingItem.name}"?`)) return; if (supabase) { const { error } = await supabase.from('inventory_items').delete().eq('id', editingItem.id); if (error) return notify(`Could not delete ingredient: ${error.message}`) } setInventory(list => list.filter(i => i.id !== editingItem.id)); setEditingItem(null); notify('Ingredient deleted') }
  const pickRestaurant = (slug) => { setActiveSlug(slug); try { localStorage.setItem('active-restaurant', slug) } catch { /* optional */ } setModal(null); setEditingOrder(null); setEditingRecipe(null); setEditingItem(null); setCloseDialog(null); setQuery(''); setChannelFilter('All channels'); setDateFilter('All dates'); setHighlight('') }
  const setOpen = async (open, message) => { if (supabase) { const { error } = await supabase.from('restaurants').update({ is_open: open, closed_message: open ? null : (message || null) }).eq('id', active.id); if (error) return notify(`Could not update ${active.name}: ${error.message}`) } setRestaurants(list => list.map(r => r.id === active.id ? { ...r, is_open: open, closed_message: open ? null : (message || null) } : r)); notify(`${active.name} is now ${open ? 'open' : 'closed'}`) }
  const saveRestaurantSettings = async (fields, secretFields) => { if (supabase) { const { error } = await supabase.from('restaurants').update(fields).eq('id', active.id); if (error) return notify(`Could not save settings: ${error.message}`); if (secretFields) { const { error: secretError } = await supabase.from('restaurant_secrets').upsert({ restaurant_id: active.id, ...secretFields }); if (secretError) return notify(`Saved, but phone alerts failed: ${secretError.message}`); setSecrets(secretFields) } } setRestaurants(list => list.map(r => r.id === active.id ? { ...r, ...fields } : r)); notify(`Settings saved for ${active.name}`) }
  const saveLimits = async (fields) => { if (supabase) { const { error } = await supabase.from('order_limits').upsert({ id: true, ...fields }); if (error) return notify(`Could not save the order limits: ${error.message}`) } setLimits(l => ({ ...l, ...fields })); notify('Order limits saved') }
  const toggleOpen = () => active.is_open ? setCloseDialog({ message: '' }) : setOpen(true)
  const dismissAlert = (key) => setAlerts(a => a.filter(x => x.key !== key))
  const viewAlert = (a) => { const r = restaurants.find(x => x.id === a.restaurantId); if (r && (!active || r.id !== active.id)) pickRestaurant(r.slug); setPage('Orders'); setHighlight(a.order.id); dismissAlert(a.key) }
  ticketBrand.name = active ? active.name : ''
  const todayOrders = orders.filter(o => daysAgo(o.createdAt, 0)), yesterdayOrders = orders.filter(o => daysAgo(o.createdAt, 1))
  const today = analyse(todayOrders, recipeList), yesterday = analyse(yesterdayOrders, recipeList)
  const pct = (a, b) => b ? `${a >= b ? '↑' : '↓'} ${Math.abs(Math.round((a - b) / b * 100))}%` : 'New'
  const activeCount = orders.filter(o => ['New', 'Cooking', 'Ready'].includes(o.status)).length
  const lowStock = inventory.filter(i => i.stock <= i.reorder)
  const deliveredToday = todayOrders.filter(o => o.status === 'Delivered').length
  const progressPct = todayOrders.length ? Math.round(deliveredToday / todayOrders.length * 100) : 0
  const hour = new Date().getHours(), greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
  if (session === undefined) return <div className="auth-loading">Checking secure workspace…</div>
  if (!session) return <AdminLogin />
  if (!active) return <div className="auth-loading">Loading restaurants…</div>
  return <div className="app-shell" data-page={page} style={themeStyle(active.slug)}>
    <aside className="sidebar">
      <Brand r={active}/>
      <nav>{nav.map(([label, icon]) => <button className={page === label ? 'nav active' : 'nav'} onClick={() => setPage(label)} key={label}><Icon name={icon}/>{label}{label==='Orders' && <em>{orders.filter(o=>o.status==='New').length}</em>}</button>)}</nav>
      <div className="sidebar-bottom"><button className={page === 'Settings' ? 'nav active' : 'nav'} onClick={() => setPage('Settings')}><Icon name="gear"/>Settings</button><button className="profile" onClick={() => supabase.auth.signOut()}><div className="avatar mauve">UK</div><div><b>{session.user.email}</b><small>Sign out</small></div><span>···</span></button></div>
    </aside>
    <main>
      <div className="rest-bar"><RestaurantSwitcher list={restaurants} active={active} onPick={pickRestaurant}/><OpenToggle r={active} onToggle={toggleOpen}/></div>
      <LiveStrip live={live} soundOn={soundOn} soundReady={audioOk} onSound={() => { setSoundOn(on => !on); notify(soundOn ? 'New-order sound off' : 'New-order sound on') }} onUnlock={() => { unlockAudio(); setAudioOk(audioReady()); playBeep() }} awake={awake} awakeSupported={awakeSupported} onAwake={() => setAwake(a => { const next = !a; try { localStorage.setItem('keep-awake', next ? '1' : '0') } catch { /* optional */ } return next })}/>
      {!active.is_open && <div className="closed-banner" role="status"><b>{active.name} is closed.</b> Customers see a "closed" message and can't order until you reopen it.</div>}
      <header><div><p className="eyebrow">{todayLabel}</p><h1>{page === 'Overview' ? `${greeting}, Utkarsh.` : page}</h1></div><div className="header-actions"><button className="icon-btn desktop-only" onClick={() => { setPage('Orders'); setTimeout(()=>document.querySelector('.search input')?.focus(),0) }} aria-label="Search orders"><Icon name="search"/></button><button className={soundOn ? 'icon-btn notification' : 'icon-btn notification muted'} onClick={() => { setSoundOn(on => !on); notify(soundOn ? 'New-order sound off' : 'New-order sound on') }} title={soundOn ? 'New-order sound is on' : 'New-order sound is off'} aria-label="Toggle new-order sound"><Icon name="bell"/>{soundOn && <i/>}</button><button className="icon-btn mobile-only" onClick={() => setPage('Settings')} aria-label="Settings"><Icon name="gear"/></button><button className="icon-btn mobile-only" onClick={() => supabase.auth.signOut()} aria-label="Sign out"><Icon name="logout"/></button><button className="primary" onClick={() => setModal('order')}><Icon name="plus" size={17}/> New order</button></div></header>
      <div key={page + (active ? active.slug : '')} className="page-in">{page === 'Overview' ? <>
        <section className="hero"><div><span className="hero-kicker">TODAY’S PULSE</span><h2>Keep the kitchen moving.</h2><p>You have <b>{activeCount} active order{activeCount === 1 ? '' : 's'}</b>{lowStock.length ? ` and ${lowStock.length} ingredient${lowStock.length === 1 ? '' : 's'} running low.` : ' and your stock levels look healthy.'}</p><button onClick={() => setPage('Orders')}>View active orders <Icon name="arrow" size={16}/></button></div><div className="hero-doodles"><span>✦</span><strong>☀</strong><i>✳</i></div></section>
        {goal && <GoalCard goal={goal} onSave={saveGoal}/>}
        <section className="stats"><Stat label="Today's sales" value={`₹${today.sales.toLocaleString('en-IN')}`} change={pct(today.sales, yesterday.sales)}/><Stat label="Orders" value={today.count} change={pct(today.count, yesterday.count)}/><Stat label="Avg. order value" value={`₹${today.aov}`} change={pct(today.aov, yesterday.aov)}/><Stat label="Food cost" value={`${today.foodPct}%`} change={yesterday.sales ? `${today.foodPct <= yesterday.foodPct ? '↓' : '↑'} ${Math.abs(Math.round((today.foodPct - yesterday.foodPct) * 10) / 10)}%` : 'est.'} good={today.foodPct <= yesterday.foodPct}/></section>
        <section className="content-grid"><div className="panel orders-panel"><div className="panel-heading"><div><h3>Live orders <span className="live-dot">●</span></h3><p>Orders requiring attention</p></div><button className="text-btn" onClick={() => setPage('Orders')}>See all <Icon name="arrow" size={15}/></button></div><OrderTable orders={sortByDelivery(orders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled'), todayIso).slice(0,3)} onStatus={requestStatus} onEdit={setEditingOrder} formatItems={formatItems} highlight={highlight} today={todayIso}/></div><div className="panel insights"><div className="panel-heading"><div><h3>Kitchen insights</h3><p>Things worth your attention</p></div><button className="more" title="Refresh data" aria-label="Refresh data" onClick={() => { reloadRef.current && reloadRef.current(); notify('Data refreshed') }}><Icon name="more"/></button></div>{lowStock.slice(0, 2).map(i => <div className="insight amber" key={i.id}><span>⚠</span><div><b>{i.name} running low</b><p>{i.stock} {i.unit} left · reorder at {i.reorder} {i.unit}</p></div><button onClick={() => setPage('Inventory')}>View</button></div>)}{today.dishes[0] ? <div className="insight lilac"><span>↗</span><div><b>{today.dishes[0].name} is leading today</b><p>{today.dishes[0].qty} sold so far today.</p></div></div> : null}{!lowStock.length && !today.dishes[0] && <div className="insight lilac"><span>✓</span><div><b>All quiet</b><p>Stock looks healthy and no orders yet today.</p></div></div>}<div className="prep"><div><span>ORDER PROGRESS</span><b>{progressPct}% delivered</b></div><div className="progress"><i style={{ width: `${progressPct}%` }}/></div><p>{deliveredToday} of {todayOrders.length} orders today delivered</p></div></div></section>
        <section className="recipe-section"><div className="section-title"><div><h2>Menu intelligence</h2><p>Recipes at a glance — keep your margins healthy.</p></div><button className="text-btn" onClick={() => setPage('Recipes')}>Recipe library <Icon name="arrow" size={15}/></button></div><div className="recipe-cards">{recipeList.slice(0,3).map(r => <RecipeCard key={r.id} r={r} onClick={() => { setSelectedRecipe(r); setPage('Recipes') }}/>)}</div></section>
      </> : page === 'To cook' ? <PrepPage orders={orders} today={todayIso} restaurant={active.name} notify={notify}/> : page === 'Orders' ? <OrdersPage orders={filtered} recipes={recipeList} onPublish={togglePublished} query={query} setQuery={setQuery} onStatus={requestStatus} onEdit={setEditingOrder} formatItems={formatItems} filter={orderFilter} setFilter={setOrderFilter} channelFilter={channelFilter} setChannelFilter={setChannelFilter} dateFilter={dateFilter} setDateFilter={setDateFilter} channels={[...new Set(orders.map(o => o.channel))]} highlight={highlight} slug={active.slug} today={todayIso}/> : page === 'Recipes' ? <RecipesPage recipes={recipeList} recipe={selectedRecipe} onSelect={setSelectedRecipe} onNew={() => setModal('recipe')} onEdit={setEditingRecipe}/> : page === 'Inventory' ? <InventoryPage inventory={inventory} onNew={() => setModal('inventory')} onEdit={setEditingItem}/> : page === 'Reports' ? <ReportsPage orders={orders} recipeList={recipeList}/> : page === 'Settings' ? <>{secrets ? <RestaurantSettings r={active} secrets={secrets} onSave={saveRestaurantSettings}/> : <p className="no-results">Loading settings…</p>}{limits && <OrderLimitsSettings limits={limits} onSave={saveLimits}/>}<AppInstallCard notify={notify} restaurant={active}/><SettingsPage key={`${active.slug}:${settings.kitchenName}:${settings.location}`} settings={settings} onSave={async (next) => { const location = (next.location || '').trim(); if (supabase) { const { error } = await supabase.from('restaurants').update({ location: location || null }).eq('id', active.id); if (error) return notify(`Could not save the location: ${error.message}`) } else setRestaurants(l => l.map(x => x.slug === active.slug ? { ...x, location } : x)); setSettings({ ...next, location }); try { localStorage.setItem(`kitchen-settings:${active.slug}`, JSON.stringify({ currency: next.currency, taxRate: next.taxRate })) } catch { /* optional */ } notify(`Kitchen profile saved for ${active.name}`) }}/></> : <Placeholder page={page} notify={notify}/>}</div> 
    </main>
    {cancelFor && <CancelDialog id={cancelFor} close={() => setCancelFor(null)} onConfirm={(reason) => { setStatus(cancelFor, 'Cancelled', reason); setCancelFor(null) }}/>}
    {modal && <Modal type={modal} close={() => setModal(null)} save={saveOrder} saveRecipe={saveRecipe} saveInventory={saveInventory} notify={notify}/>} {editingItem && <Modal type="inventory" editing={editingItem} close={() => setEditingItem(null)} saveInventory={updateInventory} onDelete={deleteInventory}/>} {editingRecipe && <Modal type="recipe" editing={editingRecipe} close={() => setEditingRecipe(null)} saveRecipe={updateRecipe} onDelete={deleteRecipe}/>} {editingOrder && <OrderEditor order={editingOrder} close={() => setEditingOrder(null)} onSave={updateOrder} formatItems={formatItems}/>} {closeDialog && <div className="modal-backdrop"><form className="modal" onSubmit={e => { e.preventDefault(); setOpen(false, closeDialog.message); setCloseDialog(null) }}><h2>Close {active.name}?</h2><p className="close-help">Customers won't be able to order from {active.name} until you reopen it. {(restaurants || []).filter(r => r.id !== active.id).map(r => r.name).join(', ')} is not affected.</p><label>Message for customers <small>(optional)</small><input value={closeDialog.message} onChange={e => setCloseDialog({ message: e.target.value })} placeholder="Closed for the evening. Back tomorrow at 11am."/></label><button className="primary submit">Close {active.name}</button><button type="button" className="text-btn close-keep" onClick={() => setCloseDialog(null)}>Keep it open</button></form></div>} <OrderAlerts alerts={alerts} restaurants={restaurants || []} onDismiss={dismissAlert} onView={viewAlert} onClear={() => setAlerts([])}/> {toast && <div className="toast">✓ {toast}</div>}
  </div>
}

const Stat=({label,value,change,good,note='vs. yesterday'})=><div className="stat"><p>{label}</p><div><strong>{value}</strong><span className={good?'green':''}>{change}</span></div><small>{note}</small></div>
function OrderTable({orders,onStatus,onEdit,formatItems,highlight,today,grouped}) {
  const rows = []; let last = null
  orders.forEach(o => {
    const dk = deliveryKey(o)
    if (grouped && dk !== last) {
      last = dk; const n = orders.filter(x => deliveryKey(x) === dk).length, rel = dayLabel(dk, today), abs = dateText(dk)
      rows.push(<div className="day-head" key={'head-' + dk}><b>{rel}</b>{rel !== abs && <span>{abs}</span>}<em>{n} order{n === 1 ? '' : 's'}</em></div>)
    }
    rows.push(<div className={o.id === highlight ? 'order-row flash' : 'order-row'} key={o.id}><div className="avatar">{o.avatar}</div><div className="order-person"><b>{o.customer}</b><span>{o.id} · {o.channel}</span>{o.status === 'Cancelled' && o.cancelReason && <span className="cancel-why">Reason: {o.cancelReason}</span>}</div><div className="order-items"><div>{formatItems(o.items)}</div><small className="order-meta"><span className="om-date">🗓 {deliveryText(dk, today)}</span>{o.address && <span className="om-addr">📍 <span className="om-text">{o.address}</span> <CopyButton text={o.address} label="Copy" aria="Copy address"/></span>}{o.payment && <span>💳 {o.payment}</span>}</small></div><div className="order-total">₹{o.total}<span>{o.placed || o.time}</span></div><select className={`status status-select ${o.status.toLowerCase()}`} aria-label={`Status for ${o.id}`} value={o.status} onChange={e=>onStatus(o.id,e.target.value)}>{['New','Cooking','Ready','Delivered','Cancelled'].map(status=><option key={status}>{status}</option>)}</select><div className="row-actions"><button className="edit-order" onClick={() => onEdit(o)}>Open</button><button className="edit-order" onClick={() => printTicket(o)}>Print</button></div></div>)
  })
  return <div className="order-table">{rows}</div>
}
function RecipeCard({r,onClick}) { return <button className="recipe-card" onClick={onClick}><div className={`food-art ${r.color}`}>{r.emoji}<span>✦</span></div><div className="recipe-info"><div><b>{r.name}</b><small>{r.category} · {r.time}</small></div><span className={r.stock==='Low stock'?'stock low':'stock'}>{r.stock}</span></div><div className="recipe-metrics"><span>Food cost <b>{r.foodCost}%</b></span><span>Sell <b>₹{r.price}</b></span></div></button> }
/* Pending orders grouped by dish: how many of each item still need to be cooked. */
function PrepPage({ orders, today, restaurant, notify }) {
  const [stage, setStage] = useState('New'), [day, setDay] = useState('all')
  const stageOk = (o) => stage === 'both' ? (o.status === 'New' || o.status === 'Cooking') : o.status === stage
  const inStage = orders.filter(stageOk)
  const days = [...new Set(inStage.map(deliveryKey).filter(Boolean))].sort()
  const dayKey = days.includes(day) || day === 'all' ? day : 'all'
  const picked = inStage.filter(o => dayKey === 'all' || deliveryKey(o) === dayKey)
  const map = new Map()
  picked.forEach(o => orderLines(o).forEach(l => {
    const key = l.name.trim().toLowerCase(), row = map.get(key) || { name: l.name.trim(), qty: 0, orders: new Set(), byDay: {} }
    row.qty += l.quantity; row.orders.add(o.id); const dk = deliveryKey(o); row.byDay[dk] = (row.byDay[dk] || 0) + l.quantity; map.set(key, row)
  }))
  const rows = [...map.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
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
      {rows.length === 0 ? <p className="no-results prep-empty">Nothing {stageName}{dayKey === 'all' ? '' : ' for ' + dayLabel(dayKey, today).toLowerCase()}. New orders will show up here by themselves.</p> : <>
        <p className="prep-sum"><b>{totalItems}</b> item{totalItems === 1 ? '' : 's'} · <b>{rows.length}</b> dish{rows.length === 1 ? '' : 'es'} · <b>{picked.length}</b> order{picked.length === 1 ? '' : 's'}</p>
        <ul className="prep-list">{rows.map(r => <li key={r.name} className="prep-row">
          <span className="prep-qty" aria-label={`${r.qty} to cook`}>{r.qty}</span>
          <span className="prep-main"><b>{r.name}</b><small>in {r.orders.size} order{r.orders.size === 1 ? '' : 's'}{dayKey === 'all' && Object.keys(r.byDay).length > 1 ? ' · ' + Object.keys(r.byDay).sort().map(d => `${dayLabel(d, today)} ${r.byDay[d]}`).join(' · ') : ''}</small></span>
        </li>)}</ul></>}
    </div>
  </section>
}
function OrdersPage({orders,recipes,onPublish,query,setQuery,onStatus,onEdit,formatItems,filter,setFilter,channelFilter,setChannelFilter,dateFilter,setDateFilter,channels,highlight,slug,today}) { const published=recipes.filter(recipe=>recipe.isPublished); return <><section className="today-menu"><div className="today-menu-head"><div><p className="eyebrow">CUSTOMER-FACING MENU</p><h2>Today’s menu</h2><p>Publish dishes here — customers will see only these on the order page.</p></div><a className="view-order-link" href={`/${slug}`} target="_blank" rel="noreferrer">View customer page <Icon name="arrow" size={15}/></a></div><div className="menu-board">{recipes.length===0?<p>Add recipes to build today’s menu.</p>:recipes.map(recipe=><div className={recipe.isPublished?'menu-dish live':'menu-dish'} key={recipe.id}><span>{recipe.emoji}</span><div><b>{recipe.name}</b><small>{recipe.category} · ₹{recipe.price}</small></div><button onClick={()=>onPublish(recipe)}>{recipe.isPublished?'Published':'Publish'}</button></div>)}</div><small className="menu-count">{published.length} dish{published.length===1?'':'es'} live for customers</small></section><section className="page-toolbar"><div className="tabs">{['All orders','Active','Completed'].map(x=><button className={filter===x?'tab active-tab':'tab'} onClick={()=>setFilter(x)} key={x}>{x}</button>)}</div><div className="filters"><select value={channelFilter} onChange={e=>setChannelFilter(e.target.value)} aria-label="Filter by channel"><option>All channels</option>{channels.map(c=><option key={c}>{c}</option>)}</select><select value={dateFilter} onChange={e=>setDateFilter(e.target.value)} aria-label="Filter by date"><option>All dates</option><option>Today</option><option>Tomorrow</option><option>Upcoming</option><option>Earlier</option></select></div><label className="search"><Icon name="search" size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search order or customer"/></label></section><section className="panel full-orders">{orders.length ? <OrderTable orders={orders} onStatus={onStatus} onEdit={onEdit} formatItems={formatItems} highlight={highlight} today={today} grouped/> : <p className="no-results">No matching orders found.</p>}</section></> }
function RecipesPage({recipes,recipe,onSelect,onNew,onEdit}) { if (!recipe) return <section className="empty panel"><div className="empty-icon">🍽️</div><h2>Your recipe library is empty</h2><p>Create a recipe and it will be saved in Supabase.</p><button className="primary" onClick={onNew}>Add recipe</button></section>; return <div className="recipes-layout"><section className="panel recipe-list"><div className="panel-heading"><div><h3>Recipe library</h3><p>{recipes.length} recipes in your kitchen</p></div><button className="round-add" onClick={onNew}><Icon name="plus"/></button></div>{recipes.map(r=><button className={recipe.id===r.id?'recipe-line selected':'recipe-line'} key={r.id} onClick={()=>onSelect(r)}><span className={`mini-art ${r.color}`}>{r.emoji}</span><div><b>{r.name}</b><small>{r.category} · ₹{r.price}</small></div><span>›</span></button>)}</section><section className="panel recipe-detail"><div className="detail-top"><div className={`big-art ${recipe.color}`}>{recipe.emoji}</div><div><span className="eyebrow">{recipe.category}</span><h2>{recipe.name}</h2><p>Yield: 1 serving · {recipe.time} total time</p></div><button className="more" title="Edit recipe" onClick={()=>onEdit(recipe)}><Icon name="more"/></button></div><div className="cost-banner"><div><span>SELLING PRICE</span><b>₹{recipe.price}</b></div><div><span>FOOD COST</span><b>{recipe.foodCost}%</b></div><div><span>GROSS MARGIN</span><b>{100-recipe.foodCost}%</b></div></div><div className="detail-columns"><div><h3>Ingredients</h3>{recipe.ingredients.map((x,i)=><div className="ingredient" key={x}><span>{i+1}</span>{x}</div>)}</div><div><h3>Making process</h3>{recipe.steps.map((x,i)=><div className="step" key={x}><span>{i+1}</span><p>{x}</p></div>)}</div></div></section></div> }
function Placeholder({page,notify}) { return <div className="empty panel"><div className="empty-icon">{page==='Inventory'?'◫':page==='Settings'?'⚙':'↗'}</div><h2>{page} is ready for you</h2><p>This workspace is set up for {page.toLowerCase()} tracking. Connect Supabase to begin saving live kitchen data.</p><button className="primary" onClick={()=>notify(`${page} setup started`)}>Set up {page}</button></div> }
function InventoryPage({inventory,onNew,onEdit}) { return <section className="panel data-page"><div className="panel-heading"><div><h3>Ingredient inventory</h3><p>Keep stock levels and reorder points in one place.</p></div><button className="primary" onClick={onNew}><Icon name="plus" size={16}/> Add ingredient</button></div><div className="inventory-head"><span>INGREDIENT</span><span>ON HAND</span><span>REORDER AT</span><span>UNIT COST</span><span>STATUS</span></div>{inventory.map(i=>{const low=i.stock<=i.reorder;return <div className="inventory-row" key={i.id}><b>{i.name}</b><span>{i.stock} {i.unit}</span><span>{i.reorder} {i.unit}</span><span>₹{i.cost}</span><span className="inv-status"><span className={low?'stock low':'stock'}>{low?'Low stock':'In stock'}</span><button className="edit-order" onClick={()=>onEdit(i)}>Edit</button></span></div>})}</section> }
function ReportsPage({orders,recipeList}) {
  const all = analyse(orders, recipeList)
  const live = orders.filter(o => o.status !== 'Cancelled')
  const delivered = orders.filter(o => o.status === 'Delivered').length
  const days = Array.from({ length: 7 }, (_, k) => { const n = 6 - k, d = new Date(); d.setDate(d.getDate() - n); const dayOrders = live.filter(o => daysAgo(o.createdAt, n)); return { label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }), total: dayOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0), count: dayOrders.length } })
  const maxDay = Math.max(1, ...days.map(d => d.total))
  const channels = [...new Set(live.map(o => o.channel))]
  const topDishes = all.dishes.slice(0, 6), maxQty = Math.max(1, ...topDishes.map(d => d.qty))
  const money = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`
  return <><section className="report-stats"><Stat label="Recorded sales" value={money(all.sales)} change="Live" note="excludes cancelled"/><Stat label="Orders tracked" value={all.count} change={`${delivered} delivered`} note="all time"/><Stat label="Average order value" value={money(all.aov)} change="Live" note="per order"/><Stat label="Est. gross profit" value={money(all.profit)} change={all.sales ? `${Math.round(all.profit / all.sales * 100)}% margin` : '—'} good note="sales minus recipe food cost"/></section>
  <section className="panel data-page"><div className="panel-heading"><div><h3>Sales — last 7 days</h3><p>Daily totals from recorded orders.</p></div></div>{days.map(d => <div className="report-row" key={d.label}><b>{d.label}</b><div className="bar"><i style={{ width: `${Math.round(d.total / maxDay * 100)}%` }}/></div><span>{money(d.total)}</span><small>{d.count}</small></div>)}</section>
  <section className="panel data-page report-gap"><div className="panel-heading"><div><h3>Best-selling dishes</h3><p>By quantity sold, with revenue.</p></div></div>{topDishes.length ? topDishes.map(d => <div className="report-row" key={d.name}><b title={d.name}>{d.name}</b><div className="bar"><i style={{ width: `${Math.round(d.qty / maxQty * 100)}%` }}/></div><span>{money(d.revenue)}</span><small>{d.qty}×</small></div>) : <p className="no-results">No dishes sold yet.</p>}</section>
  <section className="panel data-page report-gap"><div className="panel-heading"><div><h3>Sales by channel</h3><p>Share of recorded sales.</p></div></div>{channels.length ? channels.map(channel => { const total = live.filter(o => o.channel === channel).reduce((n, o) => n + (Number(o.total) || 0), 0), width = all.sales ? Math.round(total / all.sales * 100) : 0; return <div className="report-row" key={channel}><b>{channel}</b><div className="bar"><i style={{ width: `${width}%` }}/></div><span>{money(total)}</span><small>{width}%</small></div> }) : <p className="no-results">No orders yet.</p>}</section></> }
function SettingsPage({settings,onSave}) { const [form,setForm]=useState(settings), [ping,setPing]=useState(''); const change=(key,value)=>setForm(current=>({...current,[key]:value})); const testConnection=async()=>{ if(!supabase) return setPing('Error: Supabase variables are missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, then restart the app.'); setPing('Pinging Supabase…'); const started=performance.now(); try { const {error}=await supabase.from('orders').select('id',{head:true,count:'exact'}).limit(1); if (error) { const extra=[error.code && `Code: ${error.code}`, error.details, error.hint && `Hint: ${error.hint}`].filter(Boolean).join(' · '); return setPing(`Error: ${error.message}${extra ? ` (${extra})` : ''}`) } setPing(`Pong! Supabase responded in ${Math.round(performance.now()-started)} ms.`) } catch (error) { setPing(`Error: ${error.message || 'Network request failed.'}`) } }; return <section className="settings-page"><div className="panel settings-card"><div className="panel-heading"><div><h3>Kitchen profile</h3><p>Used across your kitchen workspace and reports.</p></div></div><div className="settings-form"><label>Kitchen name<input value={form.kitchenName} disabled/></label><label>Location (shown to customers)<input value={form.location} onChange={e=>change('location',e.target.value)} placeholder="e.g. Pune" maxLength={60}/></label><div className="two"><label>Currency<select value={form.currency} onChange={e=>change('currency',e.target.value)}><option>INR (₹)</option><option>USD ($)</option><option>GBP (£)</option></select></label><label>Default tax rate<input value={form.taxRate} onChange={e=>change('taxRate',e.target.value)} type="number" min="0" step="0.1"/></label></div><button className="primary" onClick={()=>onSave(form)}>Save kitchen profile</button></div></div><div className="panel connection-card"><div><span className={supabase?'connection-dot connected':'connection-dot'}/><div><h3>Supabase connection</h3><p>{supabase ? 'Your project credentials are configured.' : 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.'}</p>{ping && <p className={ping.startsWith('Pong')?'ping-success':'ping-message'}>{ping}</p>}</div></div><div className="connection-actions"><span className={supabase?'stock':'stock low'}>{supabase?'Configured':'Not configured'}</span><button className="text-btn" onClick={testConnection}>Ping Supabase</button></div></div></section> }
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
    <label>Payment method<select disabled={locked} value={payment} onChange={e=>setPayment(e.target.value)}>{['Cash on delivery','UPI','Card on delivery','Bank transfer'].map(m=><option key={m}>{m}</option>)}</select></label>
    <div className="line-items"><div className="line-title"><b>Order items</b><span>Item name and quantity</span></div>{items.map((item,index)=><div className="line-item" key={index}><input aria-label={`Item ${index+1} name`} required readOnly={locked} value={item.name} onChange={e=>changeItem(index,'name',e.target.value)} placeholder="Item name"/><input aria-label={`Item ${index+1} quantity`} required readOnly={locked} value={item.quantity} onChange={e=>changeItem(index,'quantity',e.target.value)} type="number" min="1" placeholder="Qty"/><button type="button" aria-label="Remove item" disabled={locked || items.length===1} onClick={()=>setItems(current=>current.filter((_,i)=>i!==index))}>×</button></div>)}{!locked && <button type="button" className="add-line" onClick={()=>setItems(current=>[...current,{name:'',quantity:1}])}><Icon name="plus" size={15}/> Add another item</button>}</div>
    {formError && <p className="form-error" role="alert">{formError}</p>}
    {locked ? <button type="button" className="primary submit" onClick={close}>Close</button> : <button className="primary submit">{order ? 'Save changes' : 'Add order'} <Icon name="arrow" size={16}/></button>}
  </form></div>
}
function Modal({type,close,save,saveRecipe,saveInventory,editing,onDelete}) { if (type === 'order') return <OrderEditor close={close} onSave={save}/>; const recipe = type === 'recipe', inventory = type === 'inventory', submit = recipe ? saveRecipe : saveInventory; return <div className="modal-backdrop"><form className="modal" onSubmit={submit}><button type="button" className="modal-close" onClick={close}><Icon name="close"/></button><span className="eyebrow">{recipe?'RECIPE LIBRARY':'INVENTORY'}</span><h2>{recipe?(editing?'Edit recipe':'Add a new recipe'):(editing?'Edit ingredient':'Add an ingredient')}</h2>{recipe ? <><label>Recipe name<input required name="name" defaultValue={editing?.name} placeholder="e.g. Smoky Paneer Bowl"/></label><div className="two"><label>Menu price<input required name="price" type="number" step="any" defaultValue={editing?.price} placeholder="349"/></label><label>Prep time<input required name="time" defaultValue={editing?.time} placeholder="25 min"/></label></div><div className="two"><label>Category<input name="category" defaultValue={editing?.category} placeholder="Mains"/></label><label>Food cost %<input name="foodCost" type="number" step="any" defaultValue={editing?.foodCost} placeholder="30"/></label></div><label>Ingredients <small>— one per line: name | amount | unit. Use the same name as in Inventory to deduct stock automatically.</small><textarea required name="ingredients" defaultValue={editing ? (editing.ingredientRows || []).map(r => [r.name, r.quantity, r.unit].filter(v => v !== null && v !== undefined && v !== '').join(' | ')).join('\n') : ''} placeholder={'Paneer | 0.25 | kg\nOnion | 0.1 | kg'}/></label><label>Making process<textarea required name="steps" defaultValue={editing?.steps.join('\n')} placeholder="One step per line"/></label><label className="publish-check"><input name="isPublished" type="checkbox" defaultChecked={editing?.isPublished}/> Publish to today’s customer menu</label></> : <><label>Ingredient name<input required name="name" defaultValue={editing?.name} placeholder="e.g. Paneer"/></label><div className="two"><label>Current stock<input required name="stock" type="number" step="any" min="0" defaultValue={editing?.stock} placeholder="0"/></label><label>Unit<input required name="unit" defaultValue={editing?.unit} placeholder="kg, packs, cans"/></label></div><div className="two"><label>Reorder point<input required name="reorder" type="number" step="any" min="0" defaultValue={editing?.reorder} placeholder="0"/></label><label>Unit cost<input required name="cost" type="number" step="any" min="0" defaultValue={editing?.cost} placeholder="0"/></label></div></>}<button className="primary submit">{editing?'Save changes':(recipe?'Save recipe':'Add ingredient')} <Icon name="arrow" size={16}/></button>{editing && <button type="button" className="text-btn" style={{marginTop:12,color:'#c0392b'}} onClick={onDelete}>Delete {recipe?'recipe':'ingredient'}</button>}</form></div> }
const path = window.location.pathname.replace(/\/+$/, '') || '/'
function Root() {
  const [session, setSession] = useState(undefined), [showLogin, setShowLogin] = useState(path.startsWith('/admin'))
  useEffect(() => {
    if (!supabase) return setSession(null)
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => subscription.unsubscribe()
  }, [])
  // Customer pages: /, /<restaurant>, /<restaurant>/order. Staff: / (when signed in) and /admin.
  const staffPath = path === '/' || path.startsWith('/admin')
  if (!staffPath) return <PublicRouter path={path} onStaff={() => { window.location.href = '/admin' }} />
  if (session === undefined) return <div className="auth-loading">Loading…</div>
  if (session) return <App />
  if (showLogin) return <AdminLogin onBack={() => { setShowLogin(false); if (path.startsWith('/admin')) window.history.replaceState(null, '', '/') }} />
  return <PublicRouter path="/" onStaff={() => setShowLogin(true)} />
}
createRoot(document.getElementById('root')).render(<Root />)

if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* app works without it */ }) })
