import { supabase } from './supabase'
import { isCountItem, isWeightFood, itemInfo } from './calc'
import { addDays, todayISO } from './dates'
import type { Expense, ExpenseCategory, ItemType, StockItem } from './types'

export const CATEGORIES: { id: ExpenseCategory; label: string }[] = [
  { id: 'food', label: 'Food' },
  { id: 'med', label: 'Meds' },
  { id: 'supply', label: 'Supplies' },
  { id: 'vet', label: 'Vet' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'grooming', label: 'Grooming' },
  { id: 'shipping', label: 'Shipping' },
  { id: 'other', label: 'Other' }
]

export function categoryLabel(c: ExpenseCategory): string {
  return CATEGORIES.find((x) => x.id === c)?.label ?? c
}

export const categoryOf = (t: ItemType): ExpenseCategory => (t === 'food' ? 'food' : t === 'med' ? 'med' : 'supply')

export const round2 = (n: number) => Math.round(n * 100) / 100

/** Buying it isn't part of normal monthly spending: something used now and then and not bought again. */
export const isOneOffItem = (it: StockItem) => isCountItem(it) && !it.rebuy

/** A pet's share of an expense: split evenly between the pets on it. */
export function petShare(e: Pick<Expense, 'amount' | 'pet_ids'>, petId: string): number {
  if (!e.pet_ids.includes(petId)) return 0
  return Number(e.amount) / e.pet_ids.length
}

/**
 * A pet's share of a stock item. Kibble tracked by weight splits by how many grams each pet eats;
 * everything else splits evenly between the pets on it.
 */
export function itemShare(it: StockItem, petId: string): number {
  const sp = it.stock_item_pets
  if (!sp.some((p) => p.pet_id === petId)) return 0
  if (isWeightFood(it)) {
    const total = sp.reduce((s, p) => s + Number(p.daily_grams ?? 0), 0)
    const mine = Number(sp.find((p) => p.pet_id === petId)?.daily_grams ?? 0)
    if (total > 0) return mine / total
  }
  return 1 / Math.max(1, sp.length)
}

export interface EstimateLine {
  item: StockItem
  /** this pet's share of the item (1 = all of it) */
  share: number
  /** days one pack/box lasts at current use */
  packDays: number | null
  /** € per month for this pet; null when it can't be worked out */
  perMonth: number | null
  /** why there's no estimate */
  missing: 'price' | 'duration' | 'as_needed' | 'occasional' | null
  /** price used for the estimate: the saved price, or else what was last paid */
  unitPrice: number | null
  /** the estimate uses the last logged purchase because no price is saved */
  fromLastPaid?: { amount: number; on: string }
}

/** What was last paid for one pack/box of each item, from logged purchases (amount ÷ quantity). */
export function lastPaid(expenses: Pick<Expense, 'item_id' | 'amount' | 'quantity' | 'spent_on'>[]): Record<string, { amount: number; on: string }> {
  const out: Record<string, { amount: number; on: string }> = {}
  for (const e of expenses) {
    if (!e.item_id || Number(e.amount) <= 0) continue
    const q = Number(e.quantity ?? 1) || 1
    const cur = out[e.item_id]
    if (!cur || e.spent_on > cur.on) out[e.item_id] = { amount: round2(Number(e.amount) / q), on: e.spent_on }
  }
  return out
}

/** One line per active stock item the pet uses: its € per month at current use. */
export function monthlyLines(items: StockItem[], petId: string, paid: Record<string, { amount: number; on: string }> = {}): EstimateLine[] {
  const out: EstimateLine[] = []
  for (const it of items) {
    if (it.status !== 'active') continue
    const share = itemShare(it, petId)
    if (!share) continue
    const packDays = itemInfo(it).packDays
    const fromLastPaid = it.price == null ? paid[it.id] : undefined
    const unitPrice = it.price != null ? Number(it.price) : fromLastPaid?.amount ?? null
    let missing: EstimateLine['missing'] = null
    if (it.type === 'med' && it.frequency === 'as_needed') missing = 'as_needed'
    else if (isCountItem(it)) missing = 'occasional'
    else if (unitPrice == null) missing = 'price'
    else if (!packDays || packDays <= 0) missing = 'duration'
    const perMonth = missing ? null : round2((unitPrice! / packDays!) * 30 * share)
    out.push({ item: it, share, packDays, perMonth, missing, unitPrice, fromLastPaid })
  }
  return out.sort((a, b) => (b.perMonth ?? -1) - (a.perMonth ?? -1))
}

/** Expected monthly spend on stock at current use: price ÷ days one pack/box lasts × 30. Only items with a price. */
export function monthlyRunRate(items: StockItem[], petId?: string): number {
  if (petId) return round2(monthlyLines(items, petId).reduce((s, l) => s + (l.perMonth ?? 0), 0))
  let sum = 0
  for (const it of items) {
    if (it.status !== 'active' || it.price == null) continue
    const days = itemInfo(it).packDays
    if (!days || days <= 0) continue
    sum += (Number(it.price) / days) * 30
  }
  return round2(sum)
}

export interface OrderLine { item: StockItem; qty: number; amount: number }

/**
 * Log a shopping-run order: one expense line per item, plus a "shipping / discount" line for the
 * difference between the order total and the items. Returns the order id.
 */
export async function logOrder(opts: {
  householdId: string
  storeId: string | null
  storeName: string
  lines: OrderLine[]
  total: number
  spentOn?: string
}): Promise<{ error: unknown; orderId: string }> {
  const orderId = crypto.randomUUID()
  const spent_on = opts.spentOn ?? todayISO()
  const rows: Partial<Expense>[] = opts.lines.filter((l) => l.qty > 0).map((l) => ({
    household_id: opts.householdId,
    spent_on,
    amount: round2(l.amount),
    category: categoryOf(l.item.type),
    title: l.item.name.slice(0, 120),
    pet_ids: l.item.stock_item_pets.map((p) => p.pet_id),
    item_id: l.item.id,
    store_id: opts.storeId,
    order_id: orderId,
    quantity: l.qty,
    one_off: isOneOffItem(l.item)
  }))
  const itemsSum = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const extra = round2(opts.total - itemsSum)
  if (Math.abs(extra) >= 0.01) {
    rows.push({
      household_id: opts.householdId,
      spent_on,
      amount: extra,
      category: extra > 0 ? 'shipping' : 'other',
      title: extra > 0 ? `${opts.storeName}: shipping & extras` : `${opts.storeName}: discount`,
      pet_ids: [...new Set(opts.lines.flatMap((l) => l.item.stock_item_pets.map((p) => p.pet_id)))],
      store_id: opts.storeId,
      order_id: orderId
    })
  }
  if (!rows.length) return { error: null, orderId }
  const { error } = await supabase.from('expenses').insert(rows)
  return { error, orderId }
}

/** Remove the costs logged with an order (used by Undo in the Shopping run). */
export async function deleteOrder(orderId: string) {
  return supabase.from('expenses').delete().eq('order_id', orderId)
}

export function lastMonths(n: number): { key: string; label: string; from: string; to: string }[] {
  const out = []
  const d = new Date()
  d.setDate(1)
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    const next = new Date(m.getFullYear(), m.getMonth() + 1, 1)
    const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`
    out.push({ key: iso(m).slice(0, 7), label: m.toLocaleString('en', { month: 'short' }), from: iso(m), to: addDays(iso(next), 0) })
  }
  return out
}
