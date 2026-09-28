import { supabase } from './supabase'
import { itemInfo } from './calc'
import { todayISO } from './dates'
import type { StockItem } from './types'

/** A new pack was opened (food/supply) or a new box arrived (med). */
export async function refill(item: StockItem) {
  if (item.type === 'med') {
    const now = itemInfo(item).countNow ?? Number(item.on_hand ?? 0)
    return supabase.from('stock_items').update({
      on_hand: Math.round((now + Number(item.box_size ?? 0)) * 100) / 100,
      counted_at: new Date().toISOString(),
      in_cart: false, ordered_at: null
    }).eq('id', item.id)
  }
  return supabase.from('stock_items').update({ opened_on: todayISO(), in_cart: false, ordered_at: null }).eq('id', item.id)
}

/** Log one as-needed dose and take it off the count. */
export async function logAsNeeded(item: StockItem, petId: string) {
  const d = new Date()
  const t = d.toTimeString().slice(0, 8)
  const ins = await supabase.from('dose_logs').insert({ item_id: item.id, pet_id: petId, slot_date: todayISO(), slot_time: t })
  if (ins.error) return ins
  const now = itemInfo(item).countNow ?? Number(item.on_hand ?? 0)
  return supabase.from('stock_items').update({
    on_hand: Math.max(0, Math.round((now - Number(item.dose ?? 1)) * 100) / 100),
    counted_at: d.toISOString()
  }).eq('id', item.id)
}
