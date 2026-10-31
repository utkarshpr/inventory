import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// The app stays usable with demo data until these values are added to .env.local.
export const supabase = url && key ? createClient(url, key) : null
