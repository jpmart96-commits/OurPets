// send-reminders: runs every 5 minutes (pg_cron → pg_net). Sends Web Push reminders:
//  • each scheduled medication dose at its time (owner only)
//  • a morning summary at the user's chosen time: weekly/monthly meds due today, stock to reorder,
//    appointments today/tomorrow, vaccinations due within a week or overdue
//  • appointments 2 hours before
//  • an open can past its use-by time (food by units with "opened keeps N hours"), between 08:00 and 22:00
//  • expiry dates in the morning summary (expired, or within a week)
// Also: POST {test:true} with a user's JWT sends a test notification to that user's devices.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { fmtNum, isDueOn, itemInfo, medTimes, unitFor } from './calc.ts'
import type { Appointment, DoseLog, Pet, Profile, StockItem, Vaccination } from './types.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const WINDOW_MIN = 10 // cron runs every 5 min; a 10 min window survives one late run

interface Sub { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }
interface Msg { key: string; title: string; body: string; url: string; tag: string }

/** Local date (YYYY-MM-DD) and minutes since midnight in a time zone. */
function localParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0) }
const inWindow = (target: number, now: number) => target <= now && target > now - WINDOW_MIN

function addDaysISO(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: cfg, error: cfgErr } = await admin.rpc('get_push_config')
  if (cfgErr || !cfg?.vapid_private) return json({ error: 'push not configured' }, 500)
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private)

  let body: { test?: boolean; dryRun?: boolean; now?: string } = {}
  try { body = await req.json() } catch { /* empty body */ }

  // ── test notification for the signed-in user ──
  if (body.test) {
    const auth = req.headers.get('Authorization') ?? ''
    const { data: u } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
    if (!u?.user) return json({ error: 'sign in first' }, 401)
    const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', u.user.id)
    if (!subs?.length) return json({ error: 'No device is set up for notifications yet.' }, 400)
    const errors: string[] = []
    const results = await sendAll(admin, subs as Sub[], { key: 'test', title: 'OurPets', body: 'Notifications are working on this device.', url: './#/profile', tag: 'test' }, errors)
    return json({ sent: results.filter(Boolean).length, devices: subs.length, errors })
  }

  // ── scheduled run ──
  if (req.headers.get('x-cron-secret') !== cfg.cron_secret) return json({ error: 'forbidden' }, 403)
  const now = body.now ? new Date(body.now) : new Date()

  const { data: subsData } = await admin.from('push_subscriptions').select('*')
  const subs = (subsData ?? []) as Sub[]
  const userIds = [...new Set(subs.map((s) => s.user_id))]
  if (!userIds.length) return json({ users: 0, sent: 0 })

  const [prof, pets, items, logs, appts, vax] = await Promise.all([
    admin.from('profiles').select('*').in('id', userIds),
    admin.from('pets').select('*').in('owner_id', userIds).eq('archived', false),
    admin.from('stock_items').select('*, stock_item_pets(*)').in('owner_id', userIds).eq('status', 'active'),
    admin.from('dose_logs').select('*').gte('slot_date', addDaysISO(now.toISOString().slice(0, 10), -2)),
    admin.from('appointments').select('*').gte('starts_at', new Date(now.getTime() - 3600e3).toISOString()).lte('starts_at', new Date(now.getTime() + 3 * 86400e3).toISOString()),
    admin.from('vaccinations').select('*')
  ])
  const petRows = (pets.data ?? []) as Pet[]
  const petName = (id: string) => petRows.find((p) => p.id === id)?.name ?? ''
  const petsOf = (uid: string) => petRows.filter((p) => p.owner_id === uid)

  const out: { user: string; msgs: Msg[] }[] = []
  for (const p of (prof.data ?? []) as Profile[]) {
    const tz = p.timezone || 'Europe/Lisbon'
    const { date: today, minutes } = localParts(now, tz)
    const tomorrow = addDaysISO(today, 1)
    const myPetIds = new Set(petsOf(p.id).map((x) => x.id))
    const myItems = ((items.data ?? []) as StockItem[]).filter((i) => i.owner_id === p.id)
    const msgs: Msg[] = []

    // 1. doses at their time
    if (p.notify_doses) {
      for (const it of myItems) {
        if (it.type !== 'med' || it.frequency !== 'daily' || !isDueOn(it, today)) continue
        const names = it.stock_item_pets.map((sp) => petName(sp.pet_id)).filter(Boolean).join(' & ')
        for (const t of medTimes(it)) {
          if (!inWindow(toMin(t), minutes)) continue
          const logged = ((logs.data ?? []) as DoseLog[]).some((l) => l.item_id === it.id && l.slot_date === today && l.slot_time === t)
          if (logged) continue
          const dose = Number(it.dose ?? 1)
          msgs.push({ key: `dose:${it.id}:${today}:${t}`, tag: `dose-${it.id}`, url: './#/', title: `${names} · ${it.name}`, body: `${fmtNum(dose)} ${unitFor(it, dose)} now (${t}).` })
        }
      }
    }

    // 2. appointments 2 hours before
    if (p.notify_appointments) {
      for (const a of (appts.data ?? []) as Appointment[]) {
        if (!myPetIds.has(a.pet_id)) continue
        const start = new Date(a.starts_at)
        const lead = (start.getTime() - now.getTime()) / 60000
        if (lead <= 120 && lead > 120 - WINDOW_MIN) {
          const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(start)
          msgs.push({ key: `appt2h:${a.id}`, tag: `appt-${a.id}`, url: `./#/pets/${a.pet_id}`, title: `${petName(a.pet_id)} · ${a.title}`, body: `Today at ${hhmm}${a.location ? ` · ${a.location}` : ''}` })
        }
      }
    }

    // 3. open can past its use-by (only in the daytime, and only if it went off in the last day)
    if (p.notify_stock && minutes >= 8 * 60 && minutes < 22 * 60) {
      for (const it of myItems) {
        const info = itemInfo(it, now)
        if (!info.pastUseBy || !info.useBy || now.getTime() - info.useBy.getTime() > 86400e3) continue
        const one = it.unit_label ?? 'can'
        msgs.push({ key: `useby:${it.id}:${info.useBy.toISOString()}`, tag: `useby-${it.id}`, url: './#/', title: `${it.name}`, body: `The open ${one} has been open longer than ${it.open_life_hours} h. Throw out what's left and open a new one.` })
      }
    }

    // 4. morning summary
    const summaryAt = toMin((p.morning_summary || '08:00').slice(0, 5))
    if (inWindow(summaryAt, minutes)) {
      const lines: string[] = []
      if (p.notify_doses) {
        for (const it of myItems) {
          if (it.type === 'med' && (it.frequency === 'weekly' || it.frequency === 'monthly') && isDueOn(it, today)) {
            lines.push(`${it.stock_item_pets.map((sp) => petName(sp.pet_id)).join(' & ')}: ${it.name} today`)
          }
        }
      }
      if (p.notify_stock) {
        const low = myItems.map((it) => ({ it, info: itemInfo(it, now) })).filter(({ info }) => (info.orderIn != null && info.orderIn <= 0) || info.lowAsNeeded)
        if (low.length === 1) {
          const { it, info } = low[0]
          lines.push(`Order ${it.name}${info.daysLeft != null ? ` (${info.daysLeft} days left)` : ' (running low)'}`)
        } else if (low.length > 1) lines.push(`${low.length} items to order: ${low.slice(0, 3).map(({ it }) => it.name).join(', ')}${low.length > 3 ? '…' : ''}`)
        for (const it of myItems) {
          const n = itemInfo(it, now).expiresIn
          if (n == null || n > 7) continue
          lines.push(n < 0 ? `${it.name} has expired` : n === 0 ? `${it.name} expires today` : `${it.name} expires in ${n} day${n === 1 ? '' : 's'}`)
        }
      }
      if (p.notify_appointments) {
        for (const a of (appts.data ?? []) as Appointment[]) {
          if (!myPetIds.has(a.pet_id)) continue
          const d = localParts(new Date(a.starts_at), tz).date
          if (d !== today && d !== tomorrow) continue
          const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(a.starts_at))
          lines.push(`${petName(a.pet_id)}: ${a.title} ${d === today ? 'today' : 'tomorrow'} ${hhmm}`)
        }
        for (const v of (vax.data ?? []) as Vaccination[]) {
          if (!myPetIds.has(v.pet_id) || !v.next_due) continue
          if (v.next_due < today) lines.push(`${petName(v.pet_id)}: ${v.name} is overdue`)
          else if (v.next_due <= addDaysISO(today, 7)) lines.push(`${petName(v.pet_id)}: ${v.name} due ${v.next_due === today ? 'today' : v.next_due.slice(8) + '/' + v.next_due.slice(5, 7)}`)
        }
      }
      if (lines.length) msgs.push({ key: `summary:${today}`, tag: 'summary', url: './#/', title: 'OurPets today', body: lines.slice(0, 6).join('\n') })
    }

    if (msgs.length) out.push({ user: p.id, msgs })
  }

  // drop anything already sent, then send
  let sent = 0
  const report: { user: string; key: string; title: string; body: string; sent?: boolean }[] = []
  for (const { user, msgs } of out) {
    const { data: already } = await admin.from('notification_log').select('key').eq('user_id', user).in('key', msgs.map((m) => m.key))
    const done = new Set((already ?? []).map((r: { key: string }) => r.key))
    const userSubs = subs.filter((s) => s.user_id === user)
    for (const m of msgs.filter((m) => !done.has(m.key))) {
      if (body.dryRun) { report.push({ user, key: m.key, title: m.title, body: m.body }); continue }
      const ok = await sendAll(admin, userSubs, m)
      const any = ok.some(Boolean)
      if (any) { sent++; await admin.from('notification_log').insert({ user_id: user, key: m.key }) }
      report.push({ user, key: m.key, title: m.title, body: m.body, sent: any })
    }
  }
  // keep the log small
  if (!body.dryRun) await admin.from('notification_log').delete().lt('sent_at', new Date(now.getTime() - 14 * 86400e3).toISOString())
  return json({ users: userIds.length, sent, report })
})

// deno-lint-ignore no-explicit-any
async function sendAll(admin: any, subs: Sub[], m: Msg, errors?: string[]): Promise<boolean[]> {
  return Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag }), { TTL: 3600 })
      await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', s.id)
      return true
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      errors?.push(`${code ?? ''} ${(e as Error).message ?? e}`.trim().slice(0, 200))
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id)
      return false
    }
  }))
}
