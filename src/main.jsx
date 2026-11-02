import React, { Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './supabase'
import { PublicRouter, AdminLogin } from './public'
import './styles.css'

// The staff dashboard is a separate chunk: customers never download it.
const StaffApp = lazy(() => import('./staffapp'))

const path = window.location.pathname.replace(/\/+$/, '') || '/'
// Customer pages: /, /<restaurant>, /<restaurant>/order, /<restaurant>/bulk. Staff: / (when signed in) and /admin.
const staffPath = path === '/' || path.startsWith('/admin')
function Root() {
  const [session, setSession] = useState(undefined), [showLogin, setShowLogin] = useState(path.startsWith('/admin'))
  useEffect(() => {
    if (!staffPath) return   // customers never need the sign-in check
    if (!supabase) return setSession(null)
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => subscription.unsubscribe()
  }, [])
  if (!staffPath) return <PublicRouter path={path} onStaff={() => { window.location.href = '/admin' }} />
  if (session === undefined) return <div className="auth-loading">Loading…</div>
  if (session) return <Suspense fallback={<div className="auth-loading">Loading…</div>}><StaffApp /></Suspense>
  if (showLogin) return <AdminLogin onBack={() => { setShowLogin(false); if (path.startsWith('/admin')) window.history.replaceState(null, '', '/') }} />
  return <PublicRouter path="/" onStaff={() => setShowLogin(true)} />
}
createRoot(document.getElementById('root')).render(<Root />)

if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* app works without it */ }) })
