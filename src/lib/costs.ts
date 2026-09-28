import { supabase } from './supabase'
import { itemInfo } from './calc'
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

/** A pet's share of an expense: split evenly between the pets on it. */
export function petShare(e: Pick<Expense, 'amount' | 'pet_ids'>, petId: string): number {
  if (!e.pet_ids.includes(petId)) return 0
  return Number(e.amount) / e.pet_ids.length
}

/** Expected monthly spend on stock at current use: price ÷ days one pack/box lasts × 30. Only items with a price. */
export function monthlyRunRate(items: StockItem[], petId?: string): number {
  let sum = 0
  for (const it of items) {
    if (it.status !== 'active' || it.price == null) continue
    const pets = it.stock_item_pets.map((p) => p.pet_id)
    if (petId && !pets.includes(petId)) continue
    const days = itemInfo(it).packDays
    if (!days || days <= 0) continue
    const perMonth = (Number(it.price) / days) * 30
    sum += petId ? perMonth / Math.max(1, pets.length) : perMonth
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
    quantity: l.qty
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
