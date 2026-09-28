// All dates are local calendar dates in YYYY-MM-DD form.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const pad = (n: number) => String(n).padStart(2, '0')

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO(): string {
  return toISO(new Date())
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

export function daysBetween(fromISO: string, toISOstr: string): number {
  const a = parseISO(fromISO).getTime()
  const b = parseISO(toISOstr).getTime()
  return Math.round((b - a) / 86400000)
}

export function fmtShort(iso: string): string {
  const d = parseISO(iso)
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function fmtDayMonth(iso: string): string {
  const d = parseISO(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function fmtDate(iso: string): string {
  const d = parseISO(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function fmtToday(): string {
  const d = new Date()
  return `${LONG_DAYS[d.getDay()]}, ${d.getDate()} ${LONG_MONTHS[d.getMonth()]}`
}

export function monthShort(iso: string): string {
  return MONTHS[parseISO(iso).getMonth()]
}

export function fmtTime(ts: string): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtDateTime(ts: string): string {
  const d = new Date(ts)
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function relDay(iso: string): string {
  const n = daysBetween(todayISO(), iso)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  return fmtShort(iso)
}

export function ageText(birthISO: string | null): string {
  if (!birthISO) return ''
  const b = parseISO(birthISO)
  const now = new Date()
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth())
  if (now.getDate() < b.getDate()) months -= 1
  if (months < 0) return ''
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} m`
  return m ? `${y} y ${m} m` : `${y} y`
}

export function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 19) return 'Good afternoon'
  return 'Good evening'
}

export function nowHHMM(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
