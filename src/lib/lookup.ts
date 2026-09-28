import { supabase } from './supabase'
import type { ItemType, MedForm, UnitLabel } from './types'

export interface LookupVariant {
  label: string
  name?: string
  price?: number
  url?: string
  pack_kg?: number
  units?: number
  pack_text?: string
  /** multipacks of small units (e.g. 12 x 135 g cans) */
  pack_units?: number
  unit_label?: UnitLabel
}

export interface LookupResult {
  name?: string
  brand?: string
  image?: string
  price?: number
  currency?: string
  description?: string
  pack_kg?: number
  units?: number
  pack_text?: string
  pack_units?: number
  unit_label?: UnitLabel
  type?: ItemType
  form?: MedForm
  site?: string
  url?: string
  photo_path?: string
  variants?: LookupVariant[]
  selected?: number
  error?: string
}

export function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s.trim())
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.')
  } catch {
    return false
  }
}

export async function lookupProduct(url: string): Promise<LookupResult> {
  const { data, error } = await supabase.functions.invoke('product-lookup', { body: { url: url.trim() } })
  if (error) {
    // FunctionsHttpError carries the JSON body in context
    try {
      const body = await (error as { context?: Response }).context?.json()
      if (body?.error) return { error: String(body.error) }
    } catch { /* ignore */ }
    return { error: 'Could not read that link. Fill the details in by hand.' }
  }
  return data as LookupResult
}
