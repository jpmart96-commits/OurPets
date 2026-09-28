// calendar: a private calendar feed (iCalendar / .ics) per person, for Google Calendar, Apple Calendar or Outlook.
//   GET /functions/v1/calendar?t=<token>             your pets
//   GET /functions/v1/calendar?t=<token>&scope=all   everyone's pets in the household
// The token (public.calendar_feeds, created with calendar_token()) is the only key, so JWT checks are off.
// Events: appointments, vaccines & treatments due (all-day), and "Order X" on each stock item's reorder-by date (all-day).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { itemInfo } from './calc.ts'
import type { Appointment, Pet, StockItem, Vaccination } from './types.ts'

const text = (b: string, status = 200) => new Response(b, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

/** RFC 5545 text escaping */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Fold lines at 75 octets (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let cur = ''
  let len = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0 }
    cur += ch; len += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const dateVal = (iso: string) => iso.slice(0, 10).replace(/-/g, '')
function nextDay(iso: string) {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text('Use GET', 405)
  const url = new URL(req.url)
  const token = url.searchParams.get('t') ?? ''
  const all = url.searchParams.get('scope') === 'all'
  if (!/^[a-f0-9]{64}$/.test(token)) return text('Not found', 404)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: feed } = await admin.from('calendar_feeds').select('user_id').eq('token', token).maybeSingle()
  if (!feed) return text('Not found', 404)
  const me = feed.user_id as string

  const [{ data: prof }, { data: mem }] = await Promise.all([
    admin.from('profiles').select('timezone').eq('id', me).maybeSingle(),
    admin.from('household_members').select('household_id').eq('user_id', me).maybeSingle()
  ])
  if (!mem) return text('Not found', 404)
  const tz = (prof?.timezone as string) || 'Europe/Lisbon'

  const { data: petData } = await admin.from('pets').select('*').eq('household_id', mem.household_id).eq('archived', false)
  const pets = ((petData ?? []) as Pet[]).filter((p) => all || p.owner_id === me)
  const petIds = pets.map((p) => p.id)
  const petName = (id: string) => pets.find((p) => p.id === id)?.name ?? ''
  const now = new Date()

  const [appts, vax, items] = petIds.length ? await Promise.all([
    admin.from('appointments').select('*').in('pet_id', petIds).gte('starts_at', new Date(now.getTime() - 180 * 86400e3).toISOString()),
    admin.from('vaccinations').select('*').in('pet_id', petIds).not('next_due', 'is', null),
    admin.from('stock_items').select('*, stock_item_pets(*)').eq('household_id', mem.household_id).eq('status', 'active')
  ]) : [{ data: [] }, { data: [] }, { data: [] }]

  const lines: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OurPets//Pet care//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(all ? 'OurPets (household)' : 'OurPets')}`, `X-WR-TIMEZONE:${tz}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'
  ]
  const dtstamp = stamp(now)
  const event = (props: string[]) => lines.push('BEGIN:VEVENT', `DTSTAMP:${dtstamp}`, ...props, 'END:VEVENT')

  for (const a of (appts.data ?? []) as Appointment[]) {
    const start = new Date(a.starts_at)
    event([
      `UID:appt-${a.id}@ourpets`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(new Date(start.getTime() + 3600e3))}`,
      `SUMMARY:${esc(`${petName(a.pet_id)}: ${a.title}`)}`,
      ...(a.location ? [`LOCATION:${esc(a.location)}`] : []),
      ...(a.notes ? [`DESCRIPTION:${esc(a.notes)}`] : [])
    ])
  }

  for (const v of (vax.data ?? []) as Vaccination[]) {
    if (!v.next_due) continue
    event([
      `UID:vax-${v.id}@ourpets`,
      `DTSTART;VALUE=DATE:${dateVal(v.next_due)}`,
      `DTEND;VALUE=DATE:${dateVal(nextDay(v.next_due))}`,
      `SUMMARY:${esc(`${petName(v.pet_id)}: ${v.name} due`)}`,
      `DESCRIPTION:${esc(v.given_on ? `Last given ${v.given_on}. In OurPets, open the pet and tap “Done today” once it's done.` : 'In OurPets, open the pet and tap “Done today” once it\'s done.')}`,
      'TRANSP:TRANSPARENT'
    ])
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  for (const it of (items.data ?? []) as StockItem[]) {
    if (!all && it.owner_id !== me) continue
    const forPets = it.stock_item_pets.map((p) => p.pet_id)
    if (forPets.length && !forPets.some((id) => petIds.includes(id))) continue
    const info = itemInfo(it, now)
    let day: string | null = null
    if (info.orderIn != null) day = info.orderBy
    else if (info.lowAsNeeded) day = today
    if (!day) continue
    if (day < today) day = today
    const who = forPets.map(petName).filter(Boolean).join(' & ')
    const what = it.source === 'vet' ? `Ask the vet for ${it.name}` : `Order ${it.name}`
    const left = info.daysLeft != null ? `About ${info.daysLeft} days left` : 'Running low'
    event([
      `UID:order-${it.id}@ourpets`,
      `DTSTART;VALUE=DATE:${dateVal(day)}`,
      `DTEND;VALUE=DATE:${dateVal(nextDay(day))}`,
      `SUMMARY:${esc(what)}`,
      `DESCRIPTION:${esc(`${left}${who ? ` · for ${who}` : ''}. This date moves as the count changes. The Shopping run in OurPets groups it by store.`)}`,
      'TRANSP:TRANSPARENT'
    ])
  }

  lines.push('END:VCALENDAR')
  const body = lines.map(fold).join('\r\n') + '\r\n'
  return new Response(req.method === 'HEAD' ? null : body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="ourpets.ics"',
      'Cache-Control': 'private, max-age=900'
    }
  })
})
