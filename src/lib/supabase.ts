import { createClient } from '@supabase/supabase-js'

// Public, browser-safe values. Row level security in the database protects the data.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://gqasnxmvloofdphaminj.supabase.co'
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_CGej31t3OmaTS08fqNjhhw_qg1fy1MK'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
})

export function errMsg(e: unknown): string {
  if (!e) return 'Something went wrong'
  if (typeof e === 'string') return e
  if (typeof e === 'object' && e && 'message' in e) return String((e as { message: unknown }).message)
  return 'Something went wrong'
}
