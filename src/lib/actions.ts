import { supabase } from './supabase'
import { isUnitFood, itemInfo, unitState } from './calc'
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
  if (isUnitFood(item)) return addUnitPack(item)
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

// ───────────── Food tracked by units ─────────────

/** Fold the automatic openings into the stored count, so later changes start from "now". */
function rebased(item: StockItem, now = new Date()) {
  const st = unitState(item, now)
  return { units_left: st.unopened, unit_opened_at: (st.openedAt ?? now).toISOString() }
}

/**
 * A new can was opened now. `n` is how many cans this accounts for:
 * 1 normally, more when the user says some openings weren't logged.
 */
export async function openedUnit(item: StockItem, n = 1) {
  const now = new Date()
  const stored = Math.max(0, Number(item.units_left ?? 0))
  const opens = [...(item.unit_opens ?? []), { at: now.toISOString(), n }].slice(-12)
  return supabase.from('stock_items').update({
    units_left: Math.max(0, stored - n), unit_opened_at: now.toISOString(), unit_opens: opens
  }).eq('id', item.id)
}

/** An order arrived: add one pack of units. */
export async function addUnitPack(item: StockItem) {
  const r = rebased(item)
  return supabase.from('stock_items').update({
    units_left: r.units_left + Number(item.pack_units ?? 0),
    unit_opened_at: r.unit_opened_at,
    in_cart: false, ordered_at: null
  }).eq('id', item.id)
}

/** Count check: "I have N unopened". Keeps the timing of the current can. */
export async function countUnits(item: StockItem, n: number) {
  const r = rebased(item)
  return supabase.from('stock_items').update({ units_left: Math.max(0, Math.round(n)), unit_opened_at: r.unit_opened_at }).eq('id', item.id)
}

/** Change how long one unit lasts from now on (earlier days keep the old rate). */
export async function setUnitDays(item: StockItem, days: number) {
  const r = rebased(item)
  return supabase.from('stock_items').update({ ...r, unit_days: days }).eq('id', item.id)
}
