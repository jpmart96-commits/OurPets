import type { Frequency, MedChange, MedForm, StockItem, UnitLabel } from './types.ts'
import { addDays, daysBetween, parseISO, toISO, todayISO } from './dates.ts'

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

/** Kilograms as plain decimals: 4.35, 12, 1.5 */
export function fmtKg(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '0'
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

export function slotMoment(iso: string, time: string): Date {
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

/** Food: kg left now = last count minus daily grams since then. Falls back to pack size minus days since the pack was opened. */
export function foodKgNow(item: StockItem, now = new Date()): number | null {
  const g = foodGramsPerDay(item)
  if (item.left_kg != null && item.left_counted_at) {
    const days = Math.max(0, (now.getTime() - new Date(item.left_counted_at).getTime()) / 86400000)
    return Math.max(0, Math.round((Number(item.left_kg) - (g * days) / 1000) * 100) / 100)
  }
  if (item.pack_kg == null) return null
  const elapsed = item.opened_on ? Math.max(0, daysBetween(item.opened_on, toISO(now))) : 0
  return Math.max(0, Math.round((Number(item.pack_kg) - (g * elapsed) / 1000) * 100) / 100)
}


// ───────────── Food tracked by units (cans, pouches, trays) ─────────────

const DAY_MS = 86400000

export const UNIT_WORDS: Record<UnitLabel, [string, string]> = {
  can: ['can', 'cans'], pouch: ['pouch', 'pouches'], tray: ['tray', 'trays'], sachet: ['sachet', 'sachets']
}

export function unitWord(label: UnitLabel | null | undefined, n = 2): string {
  const w = UNIT_WORDS[label ?? 'can'] ?? UNIT_WORDS.can
  return n === 1 ? w[0] : w[1]
}

export function isUnitFood(item: Pick<StockItem, 'type' | 'track_by'>): boolean {
  return item.type === 'food' && item.track_by === 'units'
}

export interface UnitState {
  /** unopened units right now (estimated) */
  unopened: number
  /** when the current unit was (or is assumed to have been) opened */
  openedAt: Date | null
  /** share of the current unit still left, 0–1 */
  currentLeft: number | null
  daysLeft: number | null
}

/**
 * The app assumes a new unit is opened every `unit_days` days after `unit_opened_at`.
 * `units_left` is the unopened count at `unit_opened_at`.
 */
export function unitState(item: StockItem, now = new Date()): UnitState {
  const d = Number(item.unit_days ?? 0)
  const stored = Math.max(0, Number(item.units_left ?? 0))
  if (!item.unit_opened_at || d <= 0) {
    return { unopened: stored, openedAt: item.unit_opened_at ? new Date(item.unit_opened_at) : null, currentLeft: null, daysLeft: d > 0 ? Math.floor(stored * d) : null }
  }
  const t0 = new Date(item.unit_opened_at).getTime()
  const e = Math.max(0, (now.getTime() - t0) / DAY_MS)
  const k = Math.min(stored, Math.floor(e / d))
  const openedAt = new Date(t0 + k * d * DAY_MS)
  const into = Math.max(0, (now.getTime() - openedAt.getTime()) / DAY_MS)
  return {
    unopened: stored - k,
    openedAt,
    currentLeft: Math.max(0, Math.min(1, 1 - into / d)),
    daysLeft: Math.floor(Math.max(0, (stored + 1) * d - e) + 1e-9)
  }
}

/**
 * Tapping "Opened a new can" long after the last one is ambiguous: either one can lasted longer,
 * or some openings weren't logged. The app asks when it's been 1.75× the usual time or more.
 */
export function unitTapCheck(item: StockItem, now = new Date()): { sinceDays: number; ambiguous: boolean; guess: number } {
  const d = Number(item.unit_days ?? 0)
  const since = item.unit_opened_at ? Math.max(0, (now.getTime() - new Date(item.unit_opened_at).getTime()) / DAY_MS) : 0
  const ambiguous = d > 0 && !!item.unit_opened_at && since >= 1.75 * d
  return { sinceDays: since, ambiguous, guess: d > 0 ? Math.max(1, Math.round(since / d)) : 1 }
}

/** Median time one unit really lasted, from the last logged single openings. Needs 3 or more. */
export function learnedUnitDays(item: StockItem): { days: number; samples: number } | null {
  const opens = item.unit_opens ?? []
  const gaps: number[] = []
  for (let i = 1; i < opens.length; i++) {
    if (opens[i].n !== 1) continue
    const g = (new Date(opens[i].at).getTime() - new Date(opens[i - 1].at).getTime()) / DAY_MS
    if (g > 0.2) gaps.push(g)
  }
  const last = gaps.slice(-5)
  if (last.length < 3) return null
  const sorted = [...last].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return { days: Math.round(m * 10) / 10, samples: last.length }
}

/** Suggest a new "one can lasts" when the real rate differs by 15% and at least 0.3 days. */
export function unitRateSuggestion(item: StockItem): { days: number; samples: number } | null {
  const l = learnedUnitDays(item)
  const d = Number(item.unit_days ?? 0)
  if (!l || d <= 0) return null
  const diff = Math.abs(l.days - d)
  return diff >= 0.3 - 1e-9 && diff / d >= 0.15 - 1e-9 ? l : null
}

/** "2 cans a day", "1 can a day", "½ can a day", "1 can every 3 days" */
export function unitRateText(label: UnitLabel | null | undefined, days: number | null | undefined): string {
  const d = Number(days ?? 0)
  if (d <= 0) return ''
  const perDay = Math.round((1 / d) * 100) / 100
  if (d <= 1) return `${fmtNum(perDay)} ${unitWord(label, perDay)} a day`
  if (perDay === 0.5 || perDay === 0.25) return `${fmtNum(perDay)} ${unitWord(label, 1)} a day`
  return `1 ${unitWord(label, 1)} every ${fmtNum(d)} days`
}

/** "today", "yesterday", "3 days ago" */
export function agoText(at: Date, now = new Date()): string {
  const n = daysBetween(toISO(at), toISO(now))
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  return `${n} days ago`
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
  /** food only: estimated kg left right now */
  kgNow: number | null
  /** food tracked by units only */
  units: UnitState | null
  /** days until the box/pack in use expires (negative: already expired) */
  expiresIn: number | null
  /** it expires before it would run out */
  expiresFirst: boolean
  /** food by units: when the open can should be used by */
  useBy: Date | null
  /** food by units: the open can is past its use-by time */
  pastUseBy: boolean
}

export function itemInfo(item: StockItem, now = new Date()): ItemInfo {
  const today = toISO(now)
  let daysLeft: number | null = null
  let packDays: number | null = null
  let countNow: number | null = null
  let lowAsNeeded = false
  const active = item.status === 'active'

  const byUnits = isUnitFood(item)
  let units: UnitState | null = null
  if (byUnits) {
    units = unitState(item, now)
    const d = Number(item.unit_days ?? 0)
    packDays = item.pack_units && d > 0 ? Math.floor(Number(item.pack_units) * d) : null
    daysLeft = units.daysLeft
  } else if (item.type === 'food') {
    const g = foodGramsPerDay(item)
    packDays = item.pack_kg && g > 0 ? Math.floor((Number(item.pack_kg) * 1000) / g) : null
  } else if (item.type === 'supply') {
    packDays = item.pack_days ?? null
  }
  let kgNow: number | null = null
  if (item.type === 'food' && !byUnits) kgNow = foodKgNow(item, now)
  if (byUnits) {
    // daysLeft set above
  } else if (item.type === 'food' && kgNow != null) {
    const g = foodGramsPerDay(item)
    daysLeft = g > 0 ? Math.max(0, Math.floor((kgNow * 1000) / g)) : null
  } else if (item.type !== 'med' && packDays != null) {
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
  const expiresIn = active && item.expires_on ? daysBetween(today, item.expires_on) : null
  const expiresFirst = expiresIn != null && daysLeft != null && expiresIn < daysLeft
  const life = Number(item.open_life_hours ?? 0)
  const useBy = active && units?.openedAt && life > 0 && units.unopened + (units.currentLeft ?? 0) > 0
    ? new Date(units.openedAt.getTime() + life * 3600e3) : null
  return {
    expiresIn,
    expiresFirst,
    useBy,
    pastUseBy: !!useBy && now > useBy,
    daysLeft,
    packDays,
    pct: daysLeft != null && packDays ? Math.max(3, Math.min(100, Math.round((daysLeft / packDays) * 100))) : null,
    orderIn,
    orderBy: orderIn != null ? addDays(today, Math.max(0, orderIn)) : null,
    urgent: (orderIn != null && orderIn <= 1) || lowAsNeeded,
    due: active && ((orderIn != null && orderIn <= 7) || lowAsNeeded),
    countNow,
    lowAsNeeded,
    kgNow,
    units
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

// ───────────── Expiry ─────────────

/** Show an expiry line when it's within 60 days, expired, or before the item runs out. */
export function showExpiry(info: ItemInfo): boolean {
  return info.expiresIn != null && (info.expiresIn <= 60 || info.expiresFirst)
}

/** Needs attention: expired, within 14 days, or expires before it runs out. */
export function expiryWarn(info: ItemInfo): boolean {
  return info.expiresIn != null && (info.expiresIn <= 14 || info.expiresFirst)
}

export function expiryText(info: ItemInfo, expiresOn: string | null): string {
  const n = info.expiresIn
  if (n == null || !expiresOn) return ''
  if (n < 0) return `Expired ${-n === 1 ? 'yesterday' : `${-n} days ago`}`
  if (n === 0) return 'Expires today'
  if (n === 1) return 'Expires tomorrow'
  const base = n <= 60 ? `Expires in ${n} days` : `Expires ${expiresOn.slice(8, 10)}/${expiresOn.slice(5, 7)}/${expiresOn.slice(0, 4)}`
  return info.expiresFirst && info.daysLeft != null ? `${base}, before it runs out` : base
}

// ───────────── Medication change history ─────────────

const FREQ_WORD: Record<Frequency, string> = { daily: 'daily', weekly: 'weekly', monthly: 'monthly', as_needed: 'as needed' }

function scheduleWords(freq: Frequency | null, times: string[] | null): string {
  if (!freq) return ''
  if (freq === 'daily') {
    const t = [...(times ?? [])].sort()
    return t.length > 1 ? `${t.length}× a day (${t.join(', ')})` : `daily${t[0] ? ` at ${t[0]}` : ''}`
  }
  return FREQ_WORD[freq]
}

/** "Started: 1 tablet, daily at 08:00" · "Dose ½ → 1 tablet" · "Paused" · "2× a day → daily at 08:00" */
export function medChangeText(c: MedChange, form: MedForm | null): string {
  const f = { form } as Pick<StockItem, 'form'>
  const doseTxt = (d: number | null) => `${fmtNum(Number(d ?? 0))} ${unitFor(f, Number(d ?? 0))}`
  if (c.kind === 'start') return `Started: ${doseTxt(c.dose)}, ${scheduleWords(c.frequency, c.dose_times)}`.replace(/, $/, '')
  const parts: string[] = []
  if (c.status !== c.prev_status) {
    parts.push(c.status === 'paused' ? 'Paused' : c.status === 'finished' ? 'Finished' : c.prev_status ? 'Back to active' : 'Active')
  }
  if (Number(c.dose ?? 0) !== Number(c.prev_dose ?? 0)) parts.push(`Dose ${fmtNum(Number(c.prev_dose ?? 0))} → ${doseTxt(c.dose)}`)
  const s0 = scheduleWords(c.prev_frequency, c.prev_dose_times), s1 = scheduleWords(c.frequency, c.dose_times)
  if (s0 !== s1) parts.push(`${s0 || '—'} → ${s1}`)
  return parts.join(' · ') || 'Updated'
}
