import { supabase } from './supabase'
import { itemInfo, slotMoment } from './calc'
import { todayISO } from './dates'
import type { DoseLog, StockItem } from './types'

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
  return supabase.from('stock_items').update({
    opened_on: todayISO(), in_cart: false, ordered_at: null,
    ...(item.type === 'food' ? { left_kg: item.pack_kg, left_counted_at: new Date().toISOString() } : {})
  }).eq('id', item.id)
}

/** Food: record how much is actually left right now (e.g. weighed the bag). */
export async function setFoodLeft(item: StockItem, kg: number) {
  return supabase.from('stock_items').update({ left_kg: Math.max(0, kg), left_counted_at: new Date().toISOString() }).eq('id', item.id)
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

export type SlotState = 'pending' | 'auto' | 'given' | 'missed'

/** A scheduled dose: past doses count as given unless marked missed. */
export function slotState(date: string, time: string, log: DoseLog | undefined, now = new Date()): SlotState {
  if (log?.status === 'missed') return 'missed'
  if (log) return 'given'
  return slotMoment(date, time) <= now ? 'auto' : 'pending'
}

/** Pill count is automatic; a missed dose gives its pill back (only if it was already counted). */
async function adjustCount(item: StockItem, date: string, time: string, delta: number) {
  if (!item.counted_at || slotMoment(date, time) <= new Date(item.counted_at)) return { error: null }
  const onHand = Math.max(0, Math.round((Number(item.on_hand ?? 0) + delta) * 100) / 100)
  return supabase.from('stock_items').update({ on_hand: onHand }).eq('id', item.id)
}

/** Tap on a dose: pending → given, given (future) → undo, given/auto (past) → missed, missed → given. */
export async function cycleDose(item: StockItem, petId: string, date: string, time: string, log: DoseLog | undefined) {
  const state = slotState(date, time, log)
  const dose = Number(item.dose ?? 1)
  const future = slotMoment(date, time) > new Date()
  if (state === 'pending') {
    return supabase.from('dose_logs').insert({ item_id: item.id, pet_id: petId, slot_date: date, slot_time: time, status: 'given' })
  }
  if (state === 'given' && future) {
    return supabase.from('dose_logs').delete().eq('id', log!.id)
  }
  if (state === 'missed') {
    const r = await supabase.from('dose_logs').update({ status: 'given', given_at: new Date().toISOString() }).eq('id', log!.id)
    if (r.error) return r
    return adjustCount(item, date, time, -dose)
  }
  // given or auto, in the past → missed
  const r = log
    ? await supabase.from('dose_logs').update({ status: 'missed' }).eq('id', log.id)
    : await supabase.from('dose_logs').insert({ item_id: item.id, pet_id: petId, slot_date: date, slot_time: time, status: 'missed' })
  if (r.error) return r
  return adjustCount(item, date, time, dose)
}
