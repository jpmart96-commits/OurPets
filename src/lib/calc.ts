import type { MedForm, StockItem } from './types'
import { addDays, daysBetween, parseISO, toISO, todayISO } from './dates'

export const UNIT_PLURAL: Record<MedForm, string> = {
  tablet: 'tablets', chew: 'chews', capsule: 'capsules', sachet: 'sachets', dose: 'doses'
}
export const UNIT_SINGULAR: Record<MedForm, string> = {
  tablet: 'tablet', chew: 'chew', capsule: 'capsule', sachet: 'sachet', dose: 'dose'
}

export function unitFor(item: Pick<StockItem, 'form'>, n = 2): string {
  const f = item.form ?? 'tablet'
  return n > 0 && n <= 1 ? UNIT_SINGULAR[f] : UNIT_PLURAL[f]
}

/** 0.5 → ½, 1.5 → 1½, 2 → 2, 0.25 → ¼ */
export function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '0'
  const whole = Math.floor(n + 1e-9)
  const frac = Math.round((n - whole) * 100) / 100
  const fracs: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' }
  const f = fracs[String(frac)]
  if (f) return whole ? `${whole}${f}` : f
  return String(Math.round(n * 100) / 100)
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function medStart(item: StockItem): string {
  return item.start_date ?? toISO(new Date(item.created_at))
}

export function medTimes(item: StockItem): string[] {
  if (item.frequency === 'daily') return item.dose_times && item.dose_times.length ? [...item.dose_times].sort() : ['08:00']
  if (item.frequency === 'weekly' || item.frequency === 'monthly') return ['']
  return []
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/** Is a scheduled medication due on this date? */
export function isDueOn(item: StockItem, iso: string): boolean {
  if (item.type !== 'med' || item.status !== 'active') return false
  const start = medStart(item)
  if (iso < start) return false
  switch (item.frequency) {
    case 'daily': return true
    case 'weekly': return daysBetween(start, iso) % 7 === 0
    case 'monthly': {
      const s = parseISO(start)
      const d = parseISO(iso)
      return d.getDate() === Math.min(s.getDate(), daysInMonth(d))
    }
    default: return false
  }
}

export function nextDue(item: StockItem, fromISO = todayISO(), maxDays = 70): string | null {
  for (let i = 0; i <= maxDays; i++) {
    const d = addDays(fromISO, i)
    if (isDueOn(item, d)) return d
  }
  return null
}

function slotMoment(iso: string, time: string): Date {
  const d = parseISO(iso)
  const [h, m] = (time || '09:00').split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d
}

/** Units per day for a scheduled med (used for "one box lasts"). */
export function medPerDay(item: StockItem): number {
  const dose = Number(item.dose ?? 0)
  switch (item.frequency) {
    case 'daily': return dose * medTimes(item).length
    case 'weekly': return dose / 7
    case 'monthly': return dose / 30
    default: return 0
  }
}

/** Estimated units on hand now: last count minus scheduled doses since that count. */
export function medOnHandNow(item: StockItem, now = new Date()): number {
  let left = Number(item.on_hand ?? 0)
  const dose = Number(item.dose ?? 0)
  if (!item.counted_at || item.frequency === 'as_needed' || !item.frequency || dose <= 0) return Math.max(0, left)
  const from = new Date(item.counted_at)
  const times = medTimes(item)
  let iso = toISO(from)
  const today = toISO(now)
  for (let guard = 0; iso <= today && guard < 800; guard++) {
    if (isDueOn(item, iso)) {
      for (const t of times) {
        const at = slotMoment(iso, t)
        if (at > from && at <= now) left -= dose
      }
    }
    iso = addDays(iso, 1)
  }
  return Math.max(0, Math.round(left * 100) / 100)
}

/** Days until the next scheduled dose can't be covered. */
export function medDaysLeft(item: StockItem, now = new Date()): number | null {
  if (item.status !== 'active' || item.frequency === 'as_needed' || !item.frequency) return null
  const dose = Number(item.dose ?? 0)
  if (dose <= 0) return null
  let remaining = medOnHandNow(item, now)
  const today = toISO(now)
  const times = medTimes(item)
  for (let d = 0; d <= 730; d++) {
    const iso = addDays(today, d)
    if (!isDueOn(item, iso)) continue
    for (const t of times) {
      if (d === 0 && slotMoment(iso, t) <= now) continue
      remaining -= dose
      if (remaining < -1e-6) return d
    }
  }
  return 730
}

export function foodGramsPerDay(item: StockItem): number {
  return item.stock_item_pets.reduce((s, p) => s + Number(p.daily_grams ?? 0), 0)
}

export interface ItemInfo {
  daysLeft: number | null
  packDays: number | null
  pct: number | null
  orderIn: number | null
  orderBy: string | null
  urgent: boolean
  due: boolean
  countNow: number | null
  lowAsNeeded: boolean
}

export function itemInfo(item: StockItem, now = new Date()): ItemInfo {
  const today = toISO(now)
  let daysLeft: number | null = null
  let packDays: number | null = null
  let countNow: number | null = null
  let lowAsNeeded = false
  const active = item.status === 'active'

  if (item.type === 'food') {
    const g = foodGramsPerDay(item)
    packDays = item.pack_kg && g > 0 ? Math.floor((Number(item.pack_kg) * 1000) / g) : null
  } else if (item.type === 'supply') {
    packDays = item.pack_days ?? null
  }
  if (item.type !== 'med' && packDays != null) {
    const elapsed = item.opened_on ? Math.max(0, daysBetween(item.opened_on, today)) : 0
    daysLeft = Math.max(0, packDays - elapsed)
  }
  if (item.type === 'med') {
    countNow = medOnHandNow(item, now)
    if (item.frequency === 'as_needed') {
      lowAsNeeded = active && countNow <= Number(item.alert_at ?? 2)
    } else {
      daysLeft = medDaysLeft(item, now)
      const per = medPerDay(item)
      packDays = item.box_size && per > 0 ? Math.floor(Number(item.box_size) / per) : null
    }
  }
  if (!active) daysLeft = null

  const orderIn = daysLeft != null ? daysLeft - (item.lead_days ?? 0) : null
  return {
    daysLeft,
    packDays,
    pct: daysLeft != null && packDays ? Math.max(3, Math.min(100, Math.round((daysLeft / packDays) * 100))) : null,
    orderIn,
    orderBy: orderIn != null ? addDays(today, Math.max(0, orderIn)) : null,
    urgent: (orderIn != null && orderIn <= 1) || lowAsNeeded,
    due: active && ((orderIn != null && orderIn <= 7) || lowAsNeeded),
    countNow,
    lowAsNeeded
  }
}

export function scheduleText(item: StockItem): string {
  if (item.type !== 'med') return ''
  const dose = Number(item.dose ?? 1)
  const what = `${fmtNum(dose)} ${unitFor(item, dose)}`
  const start = medStart(item)
  switch (item.frequency) {
    case 'daily': {
      const t = medTimes(item)
      return t.length === 1 ? `${what}, daily at ${t[0]}` : `${what}, ${t.length}× a day (${t.join(', ')})`
    }
    case 'weekly': return `${what}, weekly on ${WEEKDAYS[parseISO(start).getDay()]}`
    case 'monthly': return `${what}, monthly on the ${ordinal(parseISO(start).getDate())}`
    case 'as_needed': return `${what}, as needed`
    default: return what
  }
}

export function daysText(n: number): string {
  if (n <= 0) return 'Runs out today'
  return n === 1 ? 'About 1 day left' : `About ${n} days left`
}

export function euro(n: number | null | undefined): string {
  if (n == null) return ''
  return '€' + Number(n).toFixed(2)
}
