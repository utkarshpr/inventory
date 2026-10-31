import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './supabase'
import saltSaffronLogo from './assets/salt-saffron-logo.png'
import './styles.css'

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
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
function printTicket(o) {
  const w = window.open('', '_blank', 'width=380,height=640')
  if (!w) return window.alert('Please allow pop-ups to print the ticket.')
  const rows = orderLines(o).map(l => `<tr><td>${esc(l.quantity)}×</td><td>${esc(l.name)}</td><td class="r">${l.price ? '₹' + esc(l.price * l.quantity) : ''}</td></tr>`).join('')
  w.document.write(`<!doctype html><html><head><title>${esc(o.id)}</title><style>body{font:13px/1.45 'Courier New',monospace;margin:18px;color:#000}h1{font-size:16px;margin:0 0 2px}hr{border:0;border-top:1px dashed #000;margin:10px 0}table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}.r{text-align:right}.big{font-size:15px;font-weight:bold}</style></head><body><h1>Salt &amp; Saffron</h1><div>${esc(o.placed || o.time)}</div><hr><div class="big">${esc(o.id)}</div><div>${esc(o.channel)} · ${esc(o.status)}</div><div>${esc(o.customer)}</div>${o.address ? `<div>${esc(o.address)}</div>` : ''}${o.payment ? `<div>Payment: ${esc(o.payment)}</div>` : ''}<hr><table>${rows}</table><hr><div class="big">Total: ₹${esc(o.total)}</div></body></html>`)
  w.document.close(); w.focus(); setTimeout(() => w.print(), 250)
}
function playBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    ;[0, 0.22].forEach((delay, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.type = 'sine'; osc.frequency.value = i ? 1046 : 784
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay)
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + delay + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.2)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.22)
    })
    setTimeout(() => ctx.close(), 800)
  } catch { /* sound is optional */ }
}


function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M4 19a2 2 0 0 1 2-2h14"/></>,
    boxes: <><path d="m12 2 8 4.4v9.2L12 20l-8-4.4V6.4L12 2Z"/><path d="m4 6.4 8 4.4 8-4.4M12 10.8V20"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.3 2.3-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56v.1h-3.25v-.1a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.3-2.3.06-.06A1.7 1.7 0 0 0 6.4 15a1.7 1.7 0 0 0-1.56-1.04h-.1v-3.25h.1A1.7 1.7 0 0 0 6.4 9.67a1.7 1.7 0 0 0-.34-1.88L6 7.73l2.3-2.3.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.04-1.56v-.1h3.25v.1a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.3 2.3-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04h.1v3.25h-.1A1.7 1.7 0 0 0 19.4 15Z"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>, search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>, bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>, more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>, arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>, close: <><path d="m6 6 12 12M18 6 6 18"/></>, calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function Brand({ customer = false }) {
  return <div className={customer ? 'customer-brand salt-brand' : 'brand salt-brand'}><img src={saltSaffronLogo} alt="Salt & Saffron"/><span>Salt<span className="accent">&amp;</span>Saffron</span></div>
}

function AdminLogin({ onBack }) {
  const [email,setEmail]=useState(''), [password,setPassword]=useState(''), [message,setMessage]=useState('')
  const submit=async(e)=>{e.preventDefault(); if(!supabase) return setMessage('Supabase is not configured. Add your URL and anon key to .env.'); setMessage('Signing in…'); const {error}=await supabase.auth.signInWithPassword({email,password}); setMessage(error ? `Sign-in failed: ${error.message}` : '')}
  return <main className="auth-page"><div className="auth-card"><Brand customer/><p className="eyebrow">STAFF WORKSPACE</p><h1>Kitchen sign in</h1><p>Only authorised staff can manage orders, recipes, inventory, and reports.</p><form onSubmit={submit}><label>Username / email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@kitchen.com"/></label><label>Password<input required type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password"/></label><button className="primary customer-submit">Sign in <Icon name="arrow" size={16}/></button>{message && <p className="form-message">{message}</p>}</form>{onBack && <button type="button" className="text-btn back-home" onClick={onBack}>← Back to home</button>}</div></main>
}

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
  const [dateFilter, setDateFilter] = useState('All time')
  const [soundOn, setSoundOn] = useState(() => { try { return localStorage.getItem('kitchen-sound') !== '0' } catch { return true } })
  const soundRef = useRef(soundOn)
  const reloadRef = useRef(null)
  useEffect(() => { soundRef.current = soundOn; try { localStorage.setItem('kitchen-sound', soundOn ? '1' : '0') } catch { /* optional */ } }, [soundOn])
  useEffect(() => { const base = document.title; const reset = () => { if (!document.hidden) document.title = base }; document.addEventListener('visibilitychange', reset); window.addEventListener('focus', reset); return () => { document.removeEventListener('visibilitychange', reset); window.removeEventListener('focus', reset) } }, [])
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [orderFilter, setOrderFilter] = useState('All orders')
  const [settings, setSettings] = useState({ kitchenName: 'Salt&Saffron', location: 'Pune, Maharashtra', currency: 'INR (₹)', taxRate: '5' })
  useEffect(() => {
    if (!supabase) return setSession(null)
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!supabase) return
    const loadKitchenData = async () => {
      const [ordersResult, recipesResult, inventoryResult] = await Promise.all([
        supabase.from('orders').select('*').order('created_at', { ascending: false }),
        supabase.from('recipes').select('*, recipe_ingredients(*)').order('created_at', { ascending: false }),
        supabase.from('inventory_items').select('*').order('name')
      ])
      if (!ordersResult.error) setOrders((ordersResult.data || []).map(o => ({
        id: o.order_number,
        customer: o.customer_name || 'Walk-in guest',
        channel: o.channel,
        total: Number(o.total),
        time: new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: o.status,
        items: o.items || [],
        address: o.delivery_address || '',
        payment: o.payment_method || '',
        placed: new Date(o.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        createdAt: o.created_at,
        avatar: (o.customer_name || 'WG').split(' ').map(x => x[0]).join('').slice(0, 2)
      })))
      if (!recipesResult.error) {
        const list = (recipesResult.data || []).map((r, index) => ({ id:r.id, name:r.name, category:r.category || 'Mains', time:`${r.prep_minutes || 0} min`, foodCost:Number(r.food_cost || 0), price:Number(r.selling_price || 0), isPublished:Boolean(r.is_published), stock:'Good', color:['coral','olive','violet'][index % 3], emoji:'🍽️', ingredients:(r.recipe_ingredients || []).map(ingredientLabel), ingredientRows:(r.recipe_ingredients || []).map(rowToView), steps:(r.instructions || '').split('\n').filter(Boolean) }))
        setRecipeList(list); setSelectedRecipe(current => list.find(r => current && r.id === current.id) || list[0] || null)
      }
      if (!inventoryResult.error) setInventory(mapInventory(inventoryResult.data))
    }
    reloadRef.current = loadKitchenData
    loadKitchenData()
    const refreshInventory = () => supabase.from('inventory_items').select('*').order('name').then(({ data, error }) => { if (!error) setInventory(mapInventory(data)) })
    const liveOrders = supabase.channel('kitchen-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, payload => {
        const o = payload.new
        setOrders(current => current.some(order => order.id === o.order_number) ? current : [{ id:o.order_number, customer:o.customer_name || 'Walk-in guest', channel:o.channel, total:Number(o.total), time:'Just now', status:o.status, items:o.items || [], address:o.delivery_address || '', payment:o.payment_method || '', placed:new Date(o.created_at).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}), createdAt:o.created_at, avatar:(o.customer_name || 'WG').split(' ').map(x=>x[0]).join('').slice(0,2) }, ...current])
        if (o.channel === 'Customer form') {
          notify(`New order ${o.order_number} from ${o.customer_name || 'a customer'}`)
          if (soundRef.current) playBeep()
          if (document.hidden) document.title = '🔔 New order · Salt&Saffron'
        }
        refreshInventory()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, payload => { const o = payload.new; setOrders(current => current.map(order => order.id === o.order_number ? { ...order, status:o.status, total:Number(o.total) } : order)) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, refreshInventory)
      .subscribe()
    return () => { supabase.removeChannel(liveOrders) }
  }, [])
  const formatItems = (items) => Array.isArray(items) ? items.map(item => typeof item === 'string' ? item : `${item.quantity}× ${item.name}`).join(' · ') : items
  const filtered = useMemo(() => orders.filter(o => {
    const textMatch = `${o.customer} ${o.id} ${formatItems(o.items)}`.toLowerCase().includes(query.toLowerCase())
    const statusMatch = orderFilter === 'All orders' || (orderFilter === 'Active' ? o.status !== 'Delivered' : o.status === 'Delivered')
    const channelMatch = channelFilter === 'All channels' || o.channel === channelFilter
    const dateMatch = dateFilter === 'All time' || !o.createdAt || (dateFilter === 'Today' ? daysAgo(o.createdAt, 0) : Date.now() - new Date(o.createdAt).getTime() <= 7 * 864e5)
    return textMatch && statusMatch && channelMatch && dateMatch
  }), [orders, query, orderFilter, channelFilter, dateFilter])
  const notify = (text) => { setToast(text); setTimeout(() => setToast(''), 2600) }
  const nav = [['Overview', 'grid'], ['Orders', 'receipt'], ['Recipes', 'book'], ['Inventory', 'boxes'], ['Reports', 'chart']]
  const setStatus = async (id, status) => { if(supabase){const {error}=await supabase.from('orders').update({status}).eq('order_number',id);if(error)return notify(`Could not update status: ${error.message}`)} setOrders(current => current.map(o => o.id === id ? {...o, status} : o)); notify(`Order updated to ${status}`) }
  const saveOrder = async (details) => { const lines = details.items.filter(item => item.name.trim() && Number(item.quantity) > 0).map(item => ({ name: item.name.trim(), quantity: Number(item.quantity) })); if (!lines.length) return notify('Add at least one item'); const order = { id: newOrderNumber('ORD'), customer: details.customer, channel: details.channel, total: Number(details.total), time: 'Just now', placed: 'Just now', createdAt: new Date().toISOString(), status: 'New', items: lines, address: details.address || '', payment: details.payment || 'Cash on delivery', avatar: details.customer.split(' ').map(x=>x[0]).join('').slice(0,2) }; if (supabase) { const { error } = await supabase.from('orders').insert({ order_number: order.id, customer_name: order.customer, channel: order.channel, total: order.total, status: order.status, items: order.items, delivery_address: order.address || null, payment_method: order.payment }); if (error) return notify(`Could not save order: ${error.message}`) }; setOrders([order, ...orders]); setModal(null); notify(supabase ? 'Order saved to Supabase' : 'New order added') }
  const updateOrder = async (details) => { const lines = details.items.filter(item => item.name.trim() && Number(item.quantity) > 0).map(item => ({ name: item.name.trim(), quantity: Number(item.quantity), ...(item.price != null ? { price: item.price } : {}) })); if (!lines.length) return notify('Add at least one item'); const updated = { ...editingOrder, customer: details.customer, channel: details.channel, total: Number(details.total), items: lines, address: details.address || '', payment: details.payment || editingOrder.payment || 'Cash on delivery', avatar: details.customer.split(' ').map(x=>x[0]).join('').slice(0,2) }; if (supabase) { const { error } = await supabase.from('orders').update({ customer_name: updated.customer, channel: updated.channel, total: updated.total, items: lines, delivery_address: updated.address || null, payment_method: updated.payment }).eq('order_number', updated.id); if (error) return notify(`Could not update order: ${error.message}`) }; setOrders(current => current.map(order => order.id === updated.id ? updated : order)); setEditingOrder(null); notify(supabase ? 'Order updated in Supabase' : 'Order updated') }
  const saveRecipe = async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const rows=parseIngredientLines(f.get('ingredients'),inventory), steps=f.get('steps').split('\n').filter(Boolean); const record={name:f.get('name'),category:f.get('category') || 'Mains',prep_minutes:parseInt(f.get('time')) || 0,selling_price:Number(f.get('price')),food_cost:Number(f.get('foodCost') || 0),instructions:steps.join('\n'),is_published:f.get('isPublished')==='on'}; let recipeId=Date.now(); if(supabase){const {data,error}=await supabase.from('recipes').insert(record).select().single();if(error)return notify(`Could not save recipe: ${error.message}`);recipeId=data.id;const {error:ingredientError}=await supabase.from('recipe_ingredients').insert(rows.map(r=>({recipe_id:data.id,...r})));if(ingredientError)return notify(`Recipe saved, but ingredients failed: ${ingredientError.message}`)} const newRecipe={id:recipeId,name:record.name,category:record.category,time:`${record.prep_minutes} min`,price:record.selling_price,foodCost:record.food_cost,isPublished:record.is_published,stock:'Good',color:'coral',emoji:'🍽️',ingredients:rows.map(ingredientLabel),ingredientRows:rows.map(rowToView),steps};setRecipeList(list=>[...list,newRecipe]);setSelectedRecipe(newRecipe);setModal(null);notify('Recipe and menu price saved') }
  const togglePublished = async (recipe) => { const isPublished=!recipe.isPublished; if(supabase){const {error}=await supabase.from('recipes').update({is_published:isPublished}).eq('id',recipe.id);if(error)return notify(`Could not update menu: ${error.message}`)} setRecipeList(list=>list.map(item=>item.id===recipe.id?{...item,isPublished}:item));notify(isPublished ? `${recipe.name} published to today’s menu` : `${recipe.name} removed from today’s menu`) }
  const updateRecipe = async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const rows=parseIngredientLines(f.get('ingredients'),inventory), steps=f.get('steps').split('\n').filter(Boolean); const record={name:f.get('name'),category:f.get('category') || 'Mains',prep_minutes:parseInt(f.get('time')) || 0,selling_price:Number(f.get('price')),food_cost:Number(f.get('foodCost') || 0),instructions:steps.join('\n'),is_published:f.get('isPublished')==='on'}; if(supabase){const {error}=await supabase.from('recipes').update(record).eq('id',editingRecipe.id);if(error)return notify(`Could not update recipe: ${error.message}`);const {error:delError}=await supabase.from('recipe_ingredients').delete().eq('recipe_id',editingRecipe.id);if(delError)return notify(`Could not update ingredients: ${delError.message}`);const {error:insError}=await supabase.from('recipe_ingredients').insert(rows.map(r=>({recipe_id:editingRecipe.id,...r})));if(insError)return notify(`Could not update ingredients: ${insError.message}`)} const updated={...editingRecipe,name:record.name,category:record.category,time:`${record.prep_minutes} min`,price:record.selling_price,foodCost:record.food_cost,isPublished:record.is_published,ingredients:rows.map(ingredientLabel),ingredientRows:rows.map(rowToView),steps}; setRecipeList(list=>list.map(r=>r.id===updated.id?updated:r)); setSelectedRecipe(updated); setEditingRecipe(null); notify('Recipe updated') }
  const deleteRecipe = async () => { if(!window.confirm(`Delete "${editingRecipe.name}"?`)) return; if(supabase){const {error}=await supabase.from('recipes').delete().eq('id',editingRecipe.id);if(error)return notify(`Could not delete recipe: ${error.message}`)} const remaining=recipeList.filter(r=>r.id!==editingRecipe.id); setRecipeList(remaining); setSelectedRecipe(remaining[0] || null); setEditingRecipe(null); notify('Recipe deleted') }
  const readInventoryForm = (form) => { const f = new FormData(form); return { name: String(f.get('name')).trim(), current_stock: Number(f.get('stock')), unit: f.get('unit'), reorder_level: Number(f.get('reorder')), unit_cost: Number(f.get('cost')) } }
  const toItem = (id, r) => ({ id, name: r.name, stock: r.current_stock, unit: r.unit, reorder: r.reorder_level, cost: r.unit_cost })
  const saveInventory = async (e) => { e.preventDefault(); const record = readInventoryForm(e.currentTarget); let id = Date.now(); if (supabase) { const { data, error } = await supabase.from('inventory_items').insert(record).select().single(); if (error) return notify(`Could not save ingredient: ${error.message}`); id = data.id } setInventory(list => [...list.filter(i => i.id !== id), toItem(id, record)].sort((a, b) => a.name.localeCompare(b.name))); setModal(null); notify('Ingredient saved') }
  const updateInventory = async (e) => { e.preventDefault(); const record = readInventoryForm(e.currentTarget); if (supabase) { const { error } = await supabase.from('inventory_items').update({ ...record, updated_at: new Date().toISOString() }).eq('id', editingItem.id); if (error) return notify(`Could not update ingredient: ${error.message}`) } setInventory(list => list.map(i => i.id === editingItem.id ? toItem(editingItem.id, record) : i).sort((a, b) => a.name.localeCompare(b.name))); setEditingItem(null); notify('Ingredient updated') }
  const deleteInventory = async () => { if (!window.confirm(`Delete "${editingItem.name}"?`)) return; if (supabase) { const { error } = await supabase.from('inventory_items').delete().eq('id', editingItem.id); if (error) return notify(`Could not delete ingredient: ${error.message}`) } setInventory(list => list.filter(i => i.id !== editingItem.id)); setEditingItem(null); notify('Ingredient deleted') }
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
  return <div className="app-shell">
    <aside className="sidebar">
      <Brand/>
      <div className="workspace"><img className="workspace-logo" src={saltSaffronLogo} alt=""/><div><b>Salt&amp;Saffron</b><small>Cloud kitchen · Pune</small></div><span className="chev">⌄</span></div>
      <nav>{nav.map(([label, icon]) => <button className={page === label ? 'nav active' : 'nav'} onClick={() => setPage(label)} key={label}><Icon name={icon}/>{label}{label==='Orders' && <em>{orders.filter(o=>o.status==='New').length}</em>}</button>)}</nav>
      <div className="sidebar-bottom"><button className={page === 'Settings' ? 'nav active' : 'nav'} onClick={() => setPage('Settings')}><Icon name="gear"/>Settings</button><button className="profile" onClick={() => supabase.auth.signOut()}><div className="avatar mauve">UK</div><div><b>{session.user.email}</b><small>Sign out</small></div><span>···</span></button></div>
    </aside>
    <main>
      <header><div><p className="eyebrow">{todayLabel}</p><h1>{page === 'Overview' ? `${greeting}, Utkarsh.` : page}</h1></div><div className="header-actions"><button className="icon-btn" onClick={() => { setPage('Orders'); setTimeout(()=>document.querySelector('.search input')?.focus(),0) }} aria-label="Search orders"><Icon name="search"/></button><button className={soundOn ? 'icon-btn notification' : 'icon-btn notification muted'} onClick={() => { setSoundOn(on => !on); notify(soundOn ? 'New-order sound off' : 'New-order sound on') }} title={soundOn ? 'New-order sound is on' : 'New-order sound is off'} aria-label="Toggle new-order sound"><Icon name="bell"/>{soundOn && <i/>}</button><button className="primary" onClick={() => setModal('order')}><Icon name="plus" size={17}/> New order</button></div></header>
      {page === 'Overview' ? <>
        <section className="hero"><div><span className="hero-kicker">TODAY’S PULSE</span><h2>Keep the kitchen moving.</h2><p>You have <b>{activeCount} active order{activeCount === 1 ? '' : 's'}</b>{lowStock.length ? ` and ${lowStock.length} ingredient${lowStock.length === 1 ? '' : 's'} running low.` : ' and your stock levels look healthy.'}</p><button onClick={() => setPage('Orders')}>View active orders <Icon name="arrow" size={16}/></button></div><div className="hero-doodles"><span>✦</span><strong>☀</strong><i>✳</i></div></section>
        <section className="stats"><Stat label="Today's sales" value={`₹${today.sales.toLocaleString('en-IN')}`} change={pct(today.sales, yesterday.sales)}/><Stat label="Orders" value={today.count} change={pct(today.count, yesterday.count)}/><Stat label="Avg. order value" value={`₹${today.aov}`} change={pct(today.aov, yesterday.aov)}/><Stat label="Food cost" value={`${today.foodPct}%`} change={yesterday.sales ? `${today.foodPct <= yesterday.foodPct ? '↓' : '↑'} ${Math.abs(Math.round((today.foodPct - yesterday.foodPct) * 10) / 10)}%` : 'est.'} good={today.foodPct <= yesterday.foodPct}/></section>
        <section className="content-grid"><div className="panel orders-panel"><div className="panel-heading"><div><h3>Live orders <span className="live-dot">●</span></h3><p>Orders requiring attention</p></div><button className="text-btn" onClick={() => setPage('Orders')}>See all <Icon name="arrow" size={15}/></button></div><OrderTable orders={orders.filter(o => o.status !== 'Delivered').slice(0,3)} onStatus={setStatus} onEdit={setEditingOrder} formatItems={formatItems}/></div><div className="panel insights"><div className="panel-heading"><div><h3>Kitchen insights</h3><p>Things worth your attention</p></div><button className="more" title="Refresh data" aria-label="Refresh data" onClick={() => { reloadRef.current && reloadRef.current(); notify('Data refreshed') }}><Icon name="more"/></button></div>{lowStock.slice(0, 2).map(i => <div className="insight amber" key={i.id}><span>⚠</span><div><b>{i.name} running low</b><p>{i.stock} {i.unit} left · reorder at {i.reorder} {i.unit}</p></div><button onClick={() => setPage('Inventory')}>View</button></div>)}{today.dishes[0] ? <div className="insight lilac"><span>↗</span><div><b>{today.dishes[0].name} is leading today</b><p>{today.dishes[0].qty} sold so far today.</p></div></div> : null}{!lowStock.length && !today.dishes[0] && <div className="insight lilac"><span>✓</span><div><b>All quiet</b><p>Stock looks healthy and no orders yet today.</p></div></div>}<div className="prep"><div><span>ORDER PROGRESS</span><b>{progressPct}% delivered</b></div><div className="progress"><i style={{ width: `${progressPct}%` }}/></div><p>{deliveredToday} of {todayOrders.length} orders today delivered</p></div></div></section>
        <section className="recipe-section"><div className="section-title"><div><h2>Menu intelligence</h2><p>Recipes at a glance — keep your margins healthy.</p></div><button className="text-btn" onClick={() => setPage('Recipes')}>Recipe library <Icon name="arrow" size={15}/></button></div><div className="recipe-cards">{recipeList.slice(0,3).map(r => <RecipeCard key={r.id} r={r} onClick={() => { setSelectedRecipe(r); setPage('Recipes') }}/>)}</div></section>
      </> : page === 'Orders' ? <OrdersPage orders={filtered} recipes={recipeList} onPublish={togglePublished} query={query} setQuery={setQuery} onStatus={setStatus} onEdit={setEditingOrder} formatItems={formatItems} filter={orderFilter} setFilter={setOrderFilter} channelFilter={channelFilter} setChannelFilter={setChannelFilter} dateFilter={dateFilter} setDateFilter={setDateFilter} channels={[...new Set(orders.map(o => o.channel))]}/> : page === 'Recipes' ? <RecipesPage recipes={recipeList} recipe={selectedRecipe} onSelect={setSelectedRecipe} onNew={() => setModal('recipe')} onEdit={setEditingRecipe}/> : page === 'Inventory' ? <InventoryPage inventory={inventory} onNew={() => setModal('inventory')} onEdit={setEditingItem}/> : page === 'Reports' ? <ReportsPage orders={orders} recipeList={recipeList}/> : page === 'Settings' ? <SettingsPage settings={settings} onSave={(next) => { setSettings(next); localStorage.setItem('kitchen-settings', JSON.stringify(next)); notify('Kitchen settings saved') }}/> : <Placeholder page={page} notify={notify}/>} 
    </main>
    {modal && <Modal type={modal} close={() => setModal(null)} save={saveOrder} saveRecipe={saveRecipe} saveInventory={saveInventory} notify={notify}/>} {editingItem && <Modal type="inventory" editing={editingItem} close={() => setEditingItem(null)} saveInventory={updateInventory} onDelete={deleteInventory}/>} {editingRecipe && <Modal type="recipe" editing={editingRecipe} close={() => setEditingRecipe(null)} saveRecipe={updateRecipe} onDelete={deleteRecipe}/>} {editingOrder && <OrderEditor order={editingOrder} close={() => setEditingOrder(null)} onSave={updateOrder} formatItems={formatItems}/>} {toast && <div className="toast">✓ {toast}</div>}
  </div>
}

const Stat=({label,value,change,good,note='vs. yesterday'})=><div className="stat"><p>{label}</p><div><strong>{value}</strong><span className={good?'green':''}>{change}</span></div><small>{note}</small></div>
function OrderTable({orders,onStatus,onEdit,formatItems}) { return <div className="order-table">{orders.map(o => <div className="order-row" key={o.id}><div className="avatar">{o.avatar}</div><div className="order-person"><b>{o.customer}</b><span>{o.id} · {o.channel}</span></div><div className="order-items"><div>{formatItems(o.items)}</div>{(o.address||o.payment) && <small className="order-meta">{o.address && <>📍 {o.address}</>}{o.address && o.payment && ' · '}{o.payment && <>💳 {o.payment}</>}</small>}</div><div className="order-total">₹{o.total}<span>{o.placed || o.time}</span></div><select className={`status status-select ${o.status.toLowerCase()}`} aria-label={`Status for ${o.id}`} value={o.status} onChange={e=>onStatus(o.id,e.target.value)}>{['New','Cooking','Ready','Delivered','Cancelled'].map(status=><option key={status}>{status}</option>)}</select><div className="row-actions"><button className="edit-order" onClick={() => onEdit(o)}>Edit</button><button className="edit-order" onClick={() => printTicket(o)}>Print</button></div></div>)}</div> }
function RecipeCard({r,onClick}) { return <button className="recipe-card" onClick={onClick}><div className={`food-art ${r.color}`}>{r.emoji}<span>✦</span></div><div className="recipe-info"><div><b>{r.name}</b><small>{r.category} · {r.time}</small></div><span className={r.stock==='Low stock'?'stock low':'stock'}>{r.stock}</span></div><div className="recipe-metrics"><span>Food cost <b>{r.foodCost}%</b></span><span>Sell <b>₹{r.price}</b></span></div></button> }
function OrdersPage({orders,recipes,onPublish,query,setQuery,onStatus,onEdit,formatItems,filter,setFilter,channelFilter,setChannelFilter,dateFilter,setDateFilter,channels}) { const published=recipes.filter(recipe=>recipe.isPublished); return <><section className="today-menu"><div className="today-menu-head"><div><p className="eyebrow">CUSTOMER-FACING MENU</p><h2>Today’s menu</h2><p>Publish dishes here — customers will see only these on the order page.</p></div><a className="view-order-link" href="/order" target="_blank" rel="noreferrer">View customer page <Icon name="arrow" size={15}/></a></div><div className="menu-board">{recipes.length===0?<p>Add recipes to build today’s menu.</p>:recipes.map(recipe=><div className={recipe.isPublished?'menu-dish live':'menu-dish'} key={recipe.id}><span>{recipe.emoji}</span><div><b>{recipe.name}</b><small>{recipe.category} · ₹{recipe.price}</small></div><button onClick={()=>onPublish(recipe)}>{recipe.isPublished?'Published':'Publish'}</button></div>)}</div><small className="menu-count">{published.length} dish{published.length===1?'':'es'} live for customers</small></section><section className="page-toolbar"><div className="tabs">{['All orders','Active','Completed'].map(x=><button className={filter===x?'tab active-tab':'tab'} onClick={()=>setFilter(x)} key={x}>{x}</button>)}</div><div className="filters"><select value={channelFilter} onChange={e=>setChannelFilter(e.target.value)} aria-label="Filter by channel"><option>All channels</option>{channels.map(c=><option key={c}>{c}</option>)}</select><select value={dateFilter} onChange={e=>setDateFilter(e.target.value)} aria-label="Filter by date"><option>All time</option><option>Today</option><option>Last 7 days</option></select></div><label className="search"><Icon name="search" size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search order or customer"/></label></section><section className="panel full-orders">{orders.length ? <OrderTable orders={orders} onStatus={onStatus} onEdit={onEdit} formatItems={formatItems}/> : <p className="no-results">No matching orders found.</p>}</section></> }
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
function SettingsPage({settings,onSave}) { const [form,setForm]=useState(settings), [ping,setPing]=useState(''); const change=(key,value)=>setForm(current=>({...current,[key]:value})); const testConnection=async()=>{ if(!supabase) return setPing('Error: Supabase variables are missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env, then restart the app.'); setPing('Pinging Supabase…'); const started=performance.now(); try { const {error}=await supabase.from('orders').select('id',{head:true,count:'exact'}).limit(1); if (error) { const extra=[error.code && `Code: ${error.code}`, error.details, error.hint && `Hint: ${error.hint}`].filter(Boolean).join(' · '); return setPing(`Error: ${error.message}${extra ? ` (${extra})` : ''}`) } setPing(`Pong! Supabase responded in ${Math.round(performance.now()-started)} ms.`) } catch (error) { setPing(`Error: ${error.message || 'Network request failed.'}`) } }; return <section className="settings-page"><div className="panel settings-card"><div className="panel-heading"><div><h3>Kitchen profile</h3><p>Used across your kitchen workspace and reports.</p></div></div><div className="settings-form"><label>Kitchen name<input value={form.kitchenName} onChange={e=>change('kitchenName',e.target.value)}/></label><label>Location<input value={form.location} onChange={e=>change('location',e.target.value)}/></label><div className="two"><label>Currency<select value={form.currency} onChange={e=>change('currency',e.target.value)}><option>INR (₹)</option><option>USD ($)</option><option>GBP (£)</option></select></label><label>Default tax rate<input value={form.taxRate} onChange={e=>change('taxRate',e.target.value)} type="number" min="0" step="0.1"/></label></div><button className="primary" onClick={()=>onSave(form)}>Save kitchen profile</button></div></div><div className="panel connection-card"><div><span className={supabase?'connection-dot connected':'connection-dot'}/><div><h3>Supabase connection</h3><p>{supabase ? 'Your project credentials are configured.' : 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.'}</p>{ping && <p className={ping.startsWith('Pong')?'ping-success':'ping-message'}>{ping}</p>}</div></div><div className="connection-actions"><span className={supabase?'stock':'stock low'}>{supabase?'Configured':'Not configured'}</span><button className="text-btn" onClick={testConnection}>Ping Supabase</button></div></div></section> }
function OrderEditor({order,close,onSave}) {
  const parseLines = (items) => Array.isArray(items) ? items.map(item => typeof item === 'string' ? { quantity: 1, name: item } : item) : (items || '').split(' · ').map(part => { const match = part.match(/(\d+)×\s*(.*)/); return { quantity: match ? match[1] : 1, name: match ? match[2] : part } })
  const [customer, setCustomer] = useState(order?.customer || '')
  const [channel, setChannel] = useState(order?.channel || 'Direct')
  const [total, setTotal] = useState(order?.total || '')
  const [address, setAddress] = useState(order?.address || '')
  const [payment, setPayment] = useState(order?.payment || 'Cash on delivery')
  const [items, setItems] = useState(order ? parseLines(order.items) : [{ name: '', quantity: 1 }])
  const changeItem = (index, field, value) => setItems(current => current.map((item, i) => i === index ? { ...item, [field]: value } : item))
  const submit = (e) => { e.preventDefault(); onSave({ customer, channel, total, items, address, payment }) }
  return <div className="modal-backdrop"><form className="modal order-modal" onSubmit={submit}><button type="button" className="modal-close" onClick={close}><Icon name="close"/></button><span className="eyebrow">ORDERS</span><h2>{order ? `Edit ${order.id}` : 'Record a new order'}</h2><label>Customer name<input required value={customer} onChange={e=>setCustomer(e.target.value)} placeholder="Customer or order name"/></label><div className="two"><label>Channel<select value={channel} onChange={e=>setChannel(e.target.value)}><option>Direct</option><option>Swiggy</option><option>Zomato</option>{channel==='Customer form' && <option>Customer form</option>}</select></label><label>Order total<input required value={total} onChange={e=>setTotal(e.target.value)} type="number" min="0" placeholder="0"/></label></div><label>Delivery address <small>(optional)</small><textarea value={address} onChange={e=>setAddress(e.target.value)} placeholder="House / building, area, landmark"/></label><label>Payment method<select value={payment} onChange={e=>setPayment(e.target.value)}>{['Cash on delivery','UPI','Card on delivery','Bank transfer'].map(m=><option key={m}>{m}</option>)}</select></label><div className="line-items"><div className="line-title"><b>Order items</b><span>Item name and quantity</span></div>{items.map((item,index)=><div className="line-item" key={index}><input aria-label={`Item ${index+1} name`} required value={item.name} onChange={e=>changeItem(index,'name',e.target.value)} placeholder="Item name"/><input aria-label={`Item ${index+1} quantity`} required value={item.quantity} onChange={e=>changeItem(index,'quantity',e.target.value)} type="number" min="1" placeholder="Qty"/><button type="button" aria-label="Remove item" disabled={items.length===1} onClick={()=>setItems(current=>current.filter((_,i)=>i!==index))}>×</button></div>)}<button type="button" className="add-line" onClick={()=>setItems(current=>[...current,{name:'',quantity:1}])}><Icon name="plus" size={15}/> Add another item</button></div><button className="primary submit">{order ? 'Save changes' : 'Add order'} <Icon name="arrow" size={16}/></button></form></div>
}
function TrackOrder({ initialRef }) {
  const [code, setCode] = useState(() => { try { return localStorage.getItem('last-order-ref') || '' } catch { return '' } }), [result, setResult] = useState(null), [msg, setMsg] = useState(''), [active, setActive] = useState('')
  const lookup = async (value, quiet) => {
    const ref = (value || '').trim().toUpperCase()
    if (!ref) return
    if (!supabase) return setMsg('Tracking is not configured yet.')
    if (!quiet) setMsg('Checking…')
    const { data, error } = await supabase.rpc('track_order', { p_order_number: ref })
    if (error) return setMsg(`Could not check: ${error.message}`)
    if (!data) { setResult(null); setActive(''); return setMsg('No order found with that reference number.') }
    setResult(data); setActive(ref); setMsg('')
  }
  useEffect(() => { if (initialRef) { setCode(initialRef); lookup(initialRef) } }, [initialRef])
  useEffect(() => {
    if (!active || ['Delivered', 'Cancelled'].includes(result?.status)) return
    const timer = setInterval(() => lookup(active, true), 15000)
    return () => clearInterval(timer)
  }, [active, result?.status])
  const steps = ['New', 'Cooking', 'Ready', 'Delivered'], current = steps.indexOf(result?.status)
  return <section className="customer-card track-card"><p className="eyebrow">ORDER STATUS</p><h2>Track your order</h2><form className="track-form" onSubmit={e => { e.preventDefault(); lookup(code) }}><input value={code} onChange={e => setCode(e.target.value)} placeholder="Reference number, e.g. WEB-A1B2C3" aria-label="Order reference number"/><button className="primary">Track</button></form>{msg && <p className="form-message">{msg}</p>}{result && (result.status === 'Cancelled' ? <p className="form-message">Order {result.order_number} was cancelled. Please contact the kitchen.</p> : <div className="track-result"><b>{result.order_number}</b><div className="track-steps">{steps.map((step, i) => <div key={step} className={i < current ? 'track-step done' : i === current ? 'track-step now' : 'track-step'}><i/><span>{step === 'New' ? 'Received' : step}</span></div>)}</div><small>Total ₹{result.total} · updates automatically</small></div>)}</section>
}
function CustomerOrderForm() {
  const [name,setName]=useState(''), [phone,setPhone]=useState(''), [address,setAddress]=useState(''), [payment,setPayment]=useState('Cash on delivery'), [notes,setNotes]=useState(''), [menu,setMenu]=useState([]), [items,setItems]=useState([{recipeId:'',quantity:1}]), [status,setStatus]=useState(''), [toast,setToast]=useState(''), [sending,setSending]=useState(false), [lastRef,setLastRef]=useState(''), [copied,setCopied]=useState(false)
  const copyRef=async()=>{ try { await navigator.clipboard.writeText(lastRef) } catch { const box=document.createElement('textarea'); box.value=lastRef; document.body.appendChild(box); box.select(); try { document.execCommand('copy') } catch { /* ignore */ } box.remove() } setCopied(true); setTimeout(()=>setCopied(false),2000) }
  useEffect(()=>{ if(!supabase) return; supabase.from('recipes').select('id,name,selling_price,category').eq('is_published',true).order('name').then(({data,error})=>{if(error) setStatus(`Could not load menu: ${error.message}`); else setMenu(data || [])}) },[])
  const changeItem=(index,field,value)=>setItems(current=>current.map((item,i)=>i===index?{...item,[field]:value}:item))
  const total=items.reduce((sum,item)=>{const recipe=menu.find(r=>r.id===item.recipeId); return sum+(recipe?Number(recipe.selling_price)*Number(item.quantity):0)},0)
  const submit=async(e)=>{ e.preventDefault(); if(sending) return; const picked=items.filter(item=>item.recipeId && Number(item.quantity)>0).map(item=>({recipe_id:item.recipeId,quantity:Number(item.quantity)})); if(!picked.length) return setStatus('Please select at least one menu item.'); if(!supabase) return setStatus('Ordering is not configured yet. Please contact the kitchen.'); setSending(true); setStatus('Sending your order…'); const {data,error}=await supabase.rpc('place_order',{p_name:name.trim(),p_phone:phone.trim(),p_address:address.trim(),p_payment:payment,p_notes:notes.trim(),p_items:picked}); setSending(false); if(error) return setStatus(`Could not place order: ${error.message}`); const orderNumber=data.order_number; setStatus(`Order received! Your reference is ${orderNumber}. Total: ₹${Number(data.total)}.`); setToast(`Order placed! Reference number: ${orderNumber}`); setTimeout(()=>setToast(''),60000); setLastRef(orderNumber); try { localStorage.setItem('last-order-ref', orderNumber) } catch { /* optional */ } setName('');setPhone('');setAddress('');setPayment('Cash on delivery');setNotes('');setItems([{recipeId:'',quantity:1}]) }
  return <main className="customer-page"><Brand customer/><section className="customer-card"><p className="eyebrow">ONLINE ORDER</p><h1>Place your order</h1><p className="customer-intro">Choose from our menu. The kitchen receives your order immediately.</p><form onSubmit={submit}><label>Your name<input required value={name} onChange={e=>setName(e.target.value)} placeholder="Name"/></label><label>Phone number<input required value={phone} onChange={e=>setPhone(e.target.value)} type="tel" pattern="[0-9+ \-]{7,20}" title="Enter a valid phone number" placeholder="Phone number"/></label><label>Delivery address<textarea required value={address} onChange={e=>setAddress(e.target.value)} placeholder="House / building, area, landmark"/></label><label>Payment method<select value={payment} onChange={e=>setPayment(e.target.value)}><option>Cash on delivery</option><option>UPI</option><option>Card on delivery</option><option>Bank transfer</option></select></label><div className="line-items customer-items"><div className="line-title"><b>Your items</b><span>Choose item and quantity</span></div>{items.map((item,index)=>{const selected=menu.find(recipe=>recipe.id===item.recipeId);return <div className="line-item menu-line" key={index}><select required value={item.recipeId} onChange={e=>changeItem(index,'recipeId',e.target.value)}><option value="">Select menu item</option>{menu.map(recipe=><option key={recipe.id} value={recipe.id}>{recipe.name} · ₹{recipe.selling_price}</option>)}</select><input required value={item.quantity} onChange={e=>changeItem(index,'quantity',e.target.value)} type="number" min="1"/><span className="item-price">₹{selected?Number(selected.selling_price)*Number(item.quantity):0}</span><button type="button" aria-label="Remove item" disabled={items.length===1} onClick={()=>setItems(current=>current.filter((_,i)=>i!==index))}>×</button></div>})}<button type="button" className="add-line" onClick={()=>setItems(current=>[...current,{recipeId:'',quantity:1}])}><Icon name="plus" size={15}/> Add another item</button><div className="customer-total"><span>Order total</span><b>₹{total}</b></div></div><label>Order notes <small>(optional)</small><textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Allergies, spice level, or anything else"/></label><button className="primary customer-submit" disabled={sending}>{sending?'Placing order…':'Place order'} <Icon name="arrow" size={16}/></button>{status && <p className={status.startsWith('Order received')?'form-success':'form-message'}>{status}</p>}</form></section><TrackOrder initialRef={lastRef}/>{toast && <div className="toast toast-ref"><span>✓ {toast}</span>{lastRef && <button type="button" onClick={copyRef}>{copied ? 'Copied ✓' : 'Copy'}</button>}<button type="button" aria-label="Dismiss" onClick={()=>setToast('')}>×</button></div>}</main>
}
function Modal({type,close,save,saveRecipe,saveInventory,editing,onDelete}) { if (type === 'order') return <OrderEditor close={close} onSave={save}/>; const recipe = type === 'recipe', inventory = type === 'inventory', submit = recipe ? saveRecipe : saveInventory; return <div className="modal-backdrop"><form className="modal" onSubmit={submit}><button type="button" className="modal-close" onClick={close}><Icon name="close"/></button><span className="eyebrow">{recipe?'RECIPE LIBRARY':'INVENTORY'}</span><h2>{recipe?(editing?'Edit recipe':'Add a new recipe'):(editing?'Edit ingredient':'Add an ingredient')}</h2>{recipe ? <><label>Recipe name<input required name="name" defaultValue={editing?.name} placeholder="e.g. Smoky Paneer Bowl"/></label><div className="two"><label>Menu price<input required name="price" type="number" step="any" defaultValue={editing?.price} placeholder="349"/></label><label>Prep time<input required name="time" defaultValue={editing?.time} placeholder="25 min"/></label></div><div className="two"><label>Category<input name="category" defaultValue={editing?.category} placeholder="Mains"/></label><label>Food cost %<input name="foodCost" type="number" step="any" defaultValue={editing?.foodCost} placeholder="30"/></label></div><label>Ingredients <small>— one per line: name | amount | unit. Use the same name as in Inventory to deduct stock automatically.</small><textarea required name="ingredients" defaultValue={editing ? (editing.ingredientRows || []).map(r => [r.name, r.quantity, r.unit].filter(v => v !== null && v !== undefined && v !== '').join(' | ')).join('\n') : ''} placeholder={'Paneer | 0.25 | kg\nOnion | 0.1 | kg'}/></label><label>Making process<textarea required name="steps" defaultValue={editing?.steps.join('\n')} placeholder="One step per line"/></label><label className="publish-check"><input name="isPublished" type="checkbox" defaultChecked={editing?.isPublished}/> Publish to today’s customer menu</label></> : <><label>Ingredient name<input required name="name" defaultValue={editing?.name} placeholder="e.g. Paneer"/></label><div className="two"><label>Current stock<input required name="stock" type="number" step="any" min="0" defaultValue={editing?.stock} placeholder="0"/></label><label>Unit<input required name="unit" defaultValue={editing?.unit} placeholder="kg, packs, cans"/></label></div><div className="two"><label>Reorder point<input required name="reorder" type="number" step="any" min="0" defaultValue={editing?.reorder} placeholder="0"/></label><label>Unit cost<input required name="cost" type="number" step="any" min="0" defaultValue={editing?.cost} placeholder="0"/></label></div></>}<button className="primary submit">{editing?'Save changes':(recipe?'Save recipe':'Add ingredient')} <Icon name="arrow" size={16}/></button>{editing && <button type="button" className="text-btn" style={{marginTop:12,color:'#c0392b'}} onClick={onDelete}>Delete {recipe?'recipe':'ingredient'}</button>}</form></div> }
function Landing({ onStaff }) {
  return <main className="customer-page landing"><Brand customer/><section className="customer-card landing-card"><p className="eyebrow">WELCOME</p><h1>Hungry? Order in a minute.</h1><p className="customer-intro">Fresh from our kitchen to your door.</p><a className="primary landing-order" href="/order">Order now <Icon name="arrow" size={16}/></a></section><TrackOrder/><button type="button" className="text-btn staff-link" onClick={onStaff}>Staff sign in</button></main>
}
const path = window.location.pathname.replace(/\/+$/, '') || '/'
function Root() {
  const [session, setSession] = useState(undefined), [showLogin, setShowLogin] = useState(path.startsWith('/admin'))
  useEffect(() => {
    if (!supabase) return setSession(null)
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => subscription.unsubscribe()
  }, [])
  if (path === '/order') return <CustomerOrderForm />
  if (session === undefined) return <div className="auth-loading">Loading…</div>
  if (session) return <App />
  if (showLogin) return <AdminLogin onBack={() => { setShowLogin(false); if (path.startsWith('/admin')) window.history.replaceState(null, '', '/') }} />
  return <Landing onStaff={() => setShowLogin(true)} />
}
createRoot(document.getElementById('root')).render(<Root />)
