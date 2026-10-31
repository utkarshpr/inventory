import React, { useEffect, useState } from 'react'
import { supabase } from './supabase'
import saltLogo from './assets/logos/salt-and-saffron.webp'
import chivesLogo from './assets/logos/oven-and-chives.webp'

/* Every restaurant has its own logo, name and colour theme.
   Logos and colours live here (they are part of each brand); names, open/closed
   and everything else come from the `restaurants` table. */

export const LOGOS = { 'salt-and-saffron': saltLogo, 'oven-and-chives': chivesLogo }
export const logoFor = (slug) => LOGOS[slug] || null

// Used until the database answers (or if it can't be reached), so a name + logo is always shown.
const DELIVERY_DEFAULTS = { min_order_value: 0, timezone: 'Asia/Kolkata', delivery_mode: 'daily', delivery_weekdays: [], delivery_anchor: null, advance_days: 6, allow_same_day: true, order_cutoff: null }
export const FALLBACK = [
  { id: null, slug: 'salt-and-saffron', name: 'Salt & Saffron', tagline: 'Cloud kitchen, Pune', order_prefix: 'SS', is_open: true, closed_message: null, whatsapp_url: 'https://chat.whatsapp.com/DGSd2zyxnJJ3vDUPs37OSy?s=cl&p=a&iam=2', ...DELIVERY_DEFAULTS },
  { id: null, slug: 'oven-and-chives', name: 'Oven & Chives', tagline: 'Fresh from the oven', order_prefix: 'OC', is_open: true, closed_message: null, whatsapp_url: 'https://chat.whatsapp.com/G4GsNiGEmGlIwk1EbcFiRM', ...DELIVERY_DEFAULTS },
]

const THEMES = {
  // Terracotta disc, gold rim, cream line-art
  'salt-and-saffron': {
    bg: '#FBF5EC', surface: '#FFFFFF', ink: '#2E1408', muted: '#7B6454', line: '#E9DDCE',
    hero: 'linear-gradient(150deg,#B84E24 0%,#96391A 48%,#6E2609 100%)', heroInk: '#FCEFD8',
    btn: 'linear-gradient(135deg,#B84E24,#8A3216)', btnInk: '#FFF4E0',
    heroBtn: 'linear-gradient(135deg,#F4D58F,#DDA645)', heroBtnInk: '#3A1608',
    accent: 'linear-gradient(135deg,#F4D58F,#DDA645)', accentInk: '#3A1608', accentSolid: '#E2B055',
    dark: '#3A1608', darkInk: '#FCEFD8',
    side: '#3A1608', side2: '#582411', soft: '#FBEBD0', soft2: '#F3D9A8', border: '#E6C78A', text: '#8A4A10',
  },
  // Sage disc, cream ring, deep-forest lettering
  'oven-and-chives': {
    bg: '#F6F5EC', surface: '#FFFFFF', ink: '#1F2E25', muted: '#5F6D61', line: '#DDE0CE',
    hero: 'linear-gradient(150deg,#EAEDDA 0%,#D3DAB9 52%,#B9C79B 100%)', heroInk: '#1F2E25',
    btn: 'linear-gradient(135deg,#34503F,#1D3226)', btnInk: '#F5F1E1',
    heroBtn: 'linear-gradient(135deg,#34503F,#1D3226)', heroBtnInk: '#F5F1E1',
    accent: 'linear-gradient(135deg,#DDE5C2,#BFCD9D)', accentInk: '#1F2E25', accentSolid: '#C2D0A0',
    dark: '#1F3328', darkInk: '#F5F1E1',
    side: '#1F3328', side2: '#2E4B3B', soft: '#EEF1DE', soft2: '#DDE5C2', border: '#BFCD9D', text: '#35553F',
  },
}
// Neutral look for pages that belong to neither restaurant (home, staff sign-in)
const NEUTRAL = {
  bg: '#F5F3EE', surface: '#FFFFFF', ink: '#241F1B', muted: '#6C645D', line: '#E3DED5',
  hero: 'linear-gradient(150deg,#3C3733 0%,#241F1B 100%)', heroInk: '#F5F0E8',
  btn: 'linear-gradient(135deg,#3C3733,#241F1B)', btnInk: '#F5F0E8',
  heroBtn: 'linear-gradient(135deg,#F1E6D2,#DCC9A6)', heroBtnInk: '#241F1B',
  accent: 'linear-gradient(135deg,#F1E6D2,#DCC9A6)', accentInk: '#241F1B', accentSolid: '#DCC9A6',
  dark: '#241F1B', darkInk: '#F5F0E8',
  side: '#241F1B', side2: '#3C3733', soft: '#F1EBDD', soft2: '#E3D8C0', border: '#D2C39F', text: '#6B5B33',
}

export function themeStyle(slug) {
  const t = THEMES[slug] || NEUTRAL
  return {
    '--c-bg': t.bg, '--c-surface': t.surface, '--c-ink': t.ink, '--c-muted': t.muted, '--c-line': t.line,
    '--c-hero': t.hero, '--c-hero-ink': t.heroInk, '--c-btn': t.btn, '--c-btn-ink': t.btnInk,
    '--c-hero-btn': t.heroBtn, '--c-hero-btn-ink': t.heroBtnInk,
    '--c-accent': t.accent, '--c-accent-ink': t.accentInk, '--c-accent-solid': t.accentSolid,
    '--c-dark': t.dark, '--c-dark-ink': t.darkInk,
    '--t-side': t.side, '--t-side-2': t.side2, '--t-soft': t.soft, '--t-soft-2': t.soft2, '--t-border': t.border, '--t-text': t.text,
  }
}

export const closedText = (r) => (r && r.closed_message && r.closed_message.trim()) || "We're closed right now. Please check back soon."

// "Salt & Saffron" -> ["Salt &", "Saffron"] so the big name breaks nicely on phones
export const wordmarkLines = (name) => name.includes(' & ') ? [name.split(' & ')[0] + ' &', name.split(' & ').slice(1).join(' & ')] : [name]

/* Logo + name. Both are always shown together; a monogram stands in only for a restaurant without a bundled logo. */
export function Mark({ r, size = 36, showName = true, className = '' }) {
  const src = logoFor(r.slug)
  const initials = r.name.split(/\s+/).filter(w => /[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return <span className={`c-mark ${className}`}>
    {src
      ? <img className="c-logo" src={src} alt={`${r.name} logo`} width={size} height={size} />
      : <span className="c-logo c-mono" style={{ width: size, height: size }} role="img" aria-label={`${r.name} logo`}>{initials}</span>}
    {showName && <span className="c-mark-name">{r.name}</span>}
  </span>
}

/* The list of restaurants, kept live (open/closed changes arrive instantly). */
export function useRestaurants() {
  const [list, setList] = useState(null), [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    if (!supabase) { setList(FALLBACK); return }
    const load = () => supabase.from('restaurants').select('*').order('sort_order').then(({ data, error: err }) => {
      if (!alive) return
      if (err || !data || !data.length) { setError(err ? err.message : 'No restaurants found'); setList(prev => prev || FALLBACK) }
      else { setError(''); setList(data) }
    })
    load()
    const channel = supabase.channel('restaurants-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurants' }, load).subscribe()
    return () => { alive = false; supabase.removeChannel(channel) }
  }, [])
  return { list, error, setList, reload: () => supabase && supabase.from('restaurants').select('*').order('sort_order').then(({ data }) => data && data.length && setList(data)) }
}

/* ---------- Delivery days (mirrors the database function delivery_dates; the database is the final judge) ---------- */
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5)
const dowOf = (iso) => (dayNum(iso) + 4) % 7                       // 1970-01-01 was a Thursday
export const addDaysIso = (iso, n) => new Date((dayNum(iso) + n) * 864e5).toISOString().slice(0, 10)

/* today's date + time on the restaurant's own clock */
export function zonedNow(tz = 'Asia/Kolkata', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (t) => parts.find(p => p.type === t).value
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}:${get('second')}` }
}

export function deliveryDates(r, now = new Date()) {
  const { date: today, time } = zonedNow(r.timezone || 'Asia/Kolkata', now)
  const cutoff = r.order_cutoff ? (r.order_cutoff.length === 5 ? r.order_cutoff + ':00' : r.order_cutoff) : null
  const weekdays = r.delivery_weekdays || []
  const out = []
  for (let i = 0; i <= (r.advance_days == null ? 6 : r.advance_days); i++) {
    if (i === 0 && (r.allow_same_day === false || (cutoff && time >= cutoff))) continue
    const d = addDaysIso(today, i)
    const mode = r.delivery_mode || 'daily'
    const ok = mode === 'custom' ? weekdays.includes(dowOf(d))
      : mode === 'alternate' ? (((dayNum(d) - dayNum(r.delivery_anchor || today)) % 2) + 2) % 2 === 0
      : true
    if (ok) out.push(d)
  }
  return out
}

export const dateText = (iso) => iso ? `${WEEKDAYS[dowOf(iso)]} ${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}` : ''
export function dayLabel(iso, today) {
  if (!iso) return ''
  const diff = today ? dayNum(iso) - dayNum(today) : null
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : dateText(iso)
}
export function dayParts(iso, today) {
  const diff = dayNum(iso) - dayNum(today)
  return { top: diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : WEEKDAYS[dowOf(iso)], bottom: `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}` }
}
export const deliveryText = (iso, today) => { const l = dayLabel(iso, today), t = dateText(iso); return l === t ? t : `${l}, ${t}` }
export function scheduleLabel(r) {
  if (r.delivery_mode === 'alternate') return 'every other day'
  if (r.delivery_mode === 'custom') {
    const days = [1, 2, 3, 4, 5, 6, 0].filter(d => (r.delivery_weekdays || []).includes(d)).map(d => WEEKDAYS[d])
    return days.length ? `on ${days.join(', ')}` : 'on no days right now'
  }
  return 'every day'
}

/* Tab title, browser colour and icon follow the restaurant being viewed */
const BROWSER_COLOR = { 'salt-and-saffron': '#96391A', 'oven-and-chives': '#D3DAB9' }
export function usePageBrand(r, title) {
  useEffect(() => {
    document.title = title || (r ? `${r.name} · Order online` : 'Order food online')
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta && r && BROWSER_COLOR[r.slug]) meta.setAttribute('content', BROWSER_COLOR[r.slug])
    const logo = r && logoFor(r.slug)
    if (logo) {
      let link = document.querySelector('link[rel="icon"]')
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
      link.type = 'image/webp'; link.href = logo
    }
  }, [r && r.slug, title])
}
