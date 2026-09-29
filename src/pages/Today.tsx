import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../lib/store'
import { errMsg } from '../lib/supabase'
import { addDays, daysBetween, fmtDateTime, fmtShort, fmtTime, fmtToday, greeting, relDay, toISO, todayISO } from '../lib/dates'
import { countText, daysShort, expiryText, expiryTone, expiryWarn, fmtNum, isDueOn, isUnitFood, itemInfo, medTimes, nextDue, orderText, slotMoment, stockTone, unitFor, unitWord } from '../lib/calc'
import { Avatar, Collapse, Meta, Empty, ErrorNote, InfoTip, ItemThumb, Loading, OwnerSwitch, petTint, ProgressRing, Screen, TickCheck, ToneBadge, haptic } from '../components/ui'
import { UnitFood } from '../components/UnitFood'
import { IconCalendar, IconCart, IconCheck, IconChevron, IconPill, IconX } from '../components/icons'
import { cycleDose, nextSlotState, slotState, type SlotState } from '../lib/actions'
import type { DoseLog, StockItem } from '../lib/types'

interface Slot {
  key: string
  item: StockItem
  petId: string
  pets: string
  name: string
  dose: string
  time: string
  mine: boolean
  log?: DoseLog
  state: SlotState
}

interface TimeGroup { key: string; time: string; slots: Slot[] }
interface PetGroup { key: string; petIds: string[]; name: string; ownerId: string; mine: boolean; times: TimeGroup[] }

/** "Morning", "Evening"… from a HH:MM time. */
function partOfDay(t: string): string {
  const h = Number(t.slice(0, 2))
  if (!t || Number.isNaN(h)) return 'Today'
  if (h < 5) return 'Night'
  if (h < 12) return 'Morning'
  if (h < 17) return 'Afternoon'
  if (h < 22) return 'Evening'
  return 'Night'
}

/** Display names that look like an email handle ("ana.c.pereira") read as robotic in a greeting. */
function greetName(displayName: string | null | undefined): string {
  const raw = (displayName || '').trim()
  if (!raw || (!raw.includes(' ') && /[@._\d]/.test(raw))) return ''
  return raw.split(' ')[0]
}

const done = (s: SlotState) => s !== 'pending'

export default function Today() {
  const app = useApp()
  const { profile, pets, items, logs, appointments, userId, showOwner, petById, petColor, loading, error, reload, nameOf } = app
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  // Taps show instantly; the server catches up in the background.
  const [optimistic, setOptimistic] = useState<Record<string, SlotState>>({})
  const [popping, setPopping] = useState<Set<string>>(new Set())
  // Finished time slots fold away; these stay open (tapped open, or just finished a moment ago).
  const [openSlots, setOpenSlots] = useState<Set<string>>(new Set())
  const [holding, setHolding] = useState<Set<string>>(new Set())
  const holdTimers = useRef<Record<string, number>>({})
  const today = todayISO()

  useEffect(() => () => { Object.values(holdTimers.current).forEach((t) => window.clearTimeout(t)) }, [])

  const petNames = (ids: string[]) => ids.map((id) => petById(id)?.name).filter(Boolean).join(' & ')

  const slots = useMemo(() => {
    const out: Slot[] = []
    for (const it of items) {
      if (it.type !== 'med' || !showOwner(it.owner_id) || !isDueOn(it, today)) continue
      const petIds = it.stock_item_pets.map((p) => p.pet_id)
      if (!petIds.length) continue
      for (const t of medTimes(it)) {
        const log = logs.find((l) => l.item_id === it.id && l.slot_date === today && l.slot_time === t)
        const dose = Number(it.dose ?? 1)
        const key = it.id + t
        const state = optimistic[key] ?? slotState(today, t, log)
        out.push({ key, item: it, petId: petIds[0], pets: petNames(petIds), name: it.name, dose: `${fmtNum(dose)} ${unitFor(it, dose)}`, time: t, mine: it.owner_id === userId, log, state })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, logs, today, userId, app.filter, pets, optimistic])

  // Pet → time of day → doses
  const groups = useMemo(() => {
    const byPet = new Map<string, PetGroup>()
    for (const s of slots) {
      const ids = s.item.stock_item_pets.map((p) => p.pet_id)
      const gk = [...ids].sort().join('+')
      let g = byPet.get(gk)
      if (!g) { g = { key: gk, petIds: ids, name: s.pets, ownerId: s.item.owner_id, mine: s.mine, times: [] }; byPet.set(gk, g) }
      let tg = g.times.find((x) => x.time === s.time)
      if (!tg) { tg = { key: gk + '@' + s.time, time: s.time, slots: [] }; g.times.push(tg) }
      tg.slots.push(s)
    }
    // Pets with doses still to give come first; then mine before others', then by name.
    const pending = (g: PetGroup) => g.times.some((t) => t.slots.some((s) => s.state === 'pending'))
    const out = [...byPet.values()].sort((a, b) => Number(pending(b)) - Number(pending(a)) || Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name))
    for (const g of out) {
      g.times.sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'))
      for (const tg of g.times) tg.slots.sort((a, b) => a.name.localeCompare(b.name))
    }
    return out
  }, [slots])

  const low = useMemo(() => items
    .filter((it) => showOwner(it.owner_id))
    .map((it) => ({ it, info: itemInfo(it) }))
    .filter(({ info }) => info.due)
    .sort((a, b) => (a.info.orderIn ?? -99) - (b.info.orderIn ?? -99)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [items, app.filter])
  const lowPets = new Set(low.flatMap(({ it }) => it.stock_item_pets.map((p) => p.pet_id)))

  // food tracked by units that I feed: one-tap "Opened a new can"
  const cans = useMemo(() => items
    .filter((it) => it.owner_id === userId && it.status === 'active' && isUnitFood(it) && it.unit_days)
    .map((it) => ({ it, info: itemInfo(it) })),
  [items, userId])

  // expired / expiring within 14 days / expires before it runs out, plus open cans past their use-by
  const dates = useMemo(() => items
    .filter((it) => it.owner_id === userId && it.status === 'active')
    .map((it) => ({ it, info: itemInfo(it) }))
    .filter(({ info }) => expiryWarn(info) || info.pastUseBy)
    .sort((a, b) => (a.info.pastUseBy ? -999 : a.info.expiresIn ?? 999) - (b.info.pastUseBy ? -999 : b.info.expiresIn ?? 999)),
  [items, userId])

  const upcoming = useMemo(() => {
    const out: { key: string; title: string; petIds: string[]; pet: string; when: string; sort: string; href?: string }[] = []
    const horizon = addDays(today, 30)
    for (const a of appointments) {
      const p = petById(a.pet_id)
      if (!p || !showOwner(p.owner_id)) continue
      if (a.starts_at.slice(0, 10) > horizon) continue
      if (new Date(a.starts_at) < new Date()) continue
      out.push({ key: a.id, title: a.title, petIds: [p.id], pet: p.name, when: fmtDateTime(a.starts_at), sort: a.starts_at, href: `/pets/${p.id}/visits/${a.id}` })
    }
    for (const it of items) {
      if (it.type !== 'med' || !showOwner(it.owner_id)) continue
      if (it.frequency !== 'weekly' && it.frequency !== 'monthly') continue
      const d = nextDue(it, addDays(today, 1), 30)
      if (!d || daysBetween(today, d) > 21) continue
      const ids = it.stock_item_pets.map((p) => p.pet_id)
      out.push({ key: it.id, title: it.name, petIds: ids, pet: petNames(ids), when: relDay(d), sort: d })
    }
    for (const v of app.vaccinations) {
      const p = petById(v.pet_id)
      if (!p || !showOwner(p.owner_id) || !v.next_due) continue
      if (daysBetween(today, v.next_due) > 30) continue
      const overdue = v.next_due < today
      out.push({ key: v.id, title: v.name + (overdue ? ' (overdue)' : ''), petIds: [p.id], pet: p.name, when: overdue ? `was due ${fmtShort(v.next_due)}` : relDay(v.next_due), sort: v.next_due })
    }
    return out.sort((a, b) => a.sort.localeCompare(b.sort)).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, items, app.filter, pets, app.vaccinations])

  const upPets = new Set(upcoming.flatMap((u) => u.petIds)).size

  // visits in the last 3 days without notes: a nudge to write down what the vet said
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ourpets.visitNudgeOff') || '[]') as string[] } catch { return [] }
  })
  const recentVisits = appointments.filter((a) => {
    const p = petById(a.pet_id)
    const t = new Date(a.starts_at).getTime()
    return p && p.owner_id === userId && !a.notes && t <= Date.now() && t > Date.now() - 3 * 86400e3 && !dismissed.includes(a.id)
  })
  const dismissVisit = (id: string) => {
    const next = [...dismissed, id].slice(-50)
    setDismissed(next)
    try { localStorage.setItem('ourpets.visitNudgeOff', JSON.stringify(next)) } catch { /* storage unavailable */ }
  }

  function hold(slotKey: string) {
    window.clearTimeout(holdTimers.current[slotKey])
    setHolding((h) => new Set(h).add(slotKey))
    holdTimers.current[slotKey] = window.setTimeout(() => {
      setHolding((h) => { const n = new Set(h); n.delete(slotKey); return n })
    }, 900)
  }

  function pop(keys: string[]) {
    setPopping((p) => { const n = new Set(p); keys.forEach((k) => n.add(k)); return n })
    window.setTimeout(() => setPopping((p) => { const n = new Set(p); keys.forEach((k) => n.delete(k)); return n }), 450)
  }

  /** Save one or more taps: show the new state at once, write, reload, then drop the local override. */
  async function commit(list: Slot[], slotKey: string) {
    if (list.some((s) => busy.has(s.key))) return
    const next: Record<string, SlotState> = {}
    for (const s of list) next[s.key] = nextSlotState(s.state, slotMoment(today, s.time) > new Date())
    setErr(null)
    hold(slotKey)
    setOptimistic((o) => ({ ...o, ...next }))
    pop(list.filter((s) => next[s.key] === 'given' || next[s.key] === 'auto').map((s) => s.key))
    setBusy((b) => { const n = new Set(b); list.forEach((s) => n.add(s.key)); return n })
    haptic(list.length > 1 ? 18 : 10)
    const results = await Promise.all(list.map((s) => cycleDose(s.item, s.petId, today, s.time, s.log)))
    const failed = results.find((r) => r.error)
    if (failed?.error) setErr(errMsg(failed.error))
    await reload()
    setOptimistic((o) => { const n = { ...o }; list.forEach((s) => delete n[s.key]); return n })
    setBusy((b) => { const n = new Set(b); list.forEach((s) => n.delete(s.key)); return n })
  }

  function toggleSlot(k: string) {
    setOpenSlots((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }

  const givenCount = slots.filter((s) => s.state === 'given' || s.state === 'auto').length
  const missedCount = slots.filter((s) => s.state === 'missed').length
  const myPets = pets.filter((p) => p.owner_id === userId)
  const first = greetName(profile?.display_name)
  const initial = (profile?.display_name || '?').slice(0, 1)

  const subFor = (s: Slot) => {
    if (s.state === 'given') return s.log?.given_at ? `${s.dose} · given ${fmtTime(s.log.given_at)}` : `${s.dose} · given`
    if (s.state === 'missed') return `${s.dose} · missed, ${unitFor(s.item, 1)} added back`
    return s.dose
  }

  return (
    <Screen>
      <header className="stack" style={{ gap: 14 }}>
        <div className="row between" style={{ alignItems: 'center' }}>
          <div>
            <div className="small muted" style={{ fontWeight: 500 }}>{fmtToday()}</div>
            <h1 className="title sm" style={{ marginTop: 2 }}>{greeting()}{first ? `, ${first}` : ''}</h1>
          </div>
          <Link to="/profile" aria-label="Profile and household" className="avatar-link">
            <Avatar name={initial} size={40} src={app.photoUrl(profile?.avatar_path)} />
          </Link>
        </div>
        <OwnerSwitch />
      </header>

      <ErrorNote msg={error || err} />
      {loading && !pets.length ? <Loading /> : null}

      {!loading && myPets.length === 0 && (
        <Empty title="Add your first pet">
          <div className="hint">Then add their food and medication, and this page will tell you what's due and what's running low.</div>
          <Link to="/pets/new" className="btn" style={{ alignSelf: 'flex-start' }}>Add a pet</Link>
        </Empty>
      )}

      {slots.length > 0 && (
        <section className="card" aria-labelledby="meds-h">
          <div className="card-head" style={{ alignItems: 'center' }}>
            <h2 id="meds-h">Medication today</h2>
            <span className="meds-count" aria-label={`${givenCount} of ${slots.length} given${missedCount ? `, ${missedCount} missed` : ''}`}>
              <span className={missedCount ? 'warn-text' : undefined}>{givenCount} of {slots.length}{missedCount ? ` · ${missedCount} missed` : ''}</span>
              <ProgressRing value={givenCount} total={slots.length} />
            </span>
          </div>

          {groups.map((g) => (
            <div key={g.key} className="pet-group" style={groups.length > 1 ? petTint(g.petIds.map(petColor)) : undefined}>
              <div className="pet-head">
                <Avatar name={g.name} size={28} owner={g.mine ? 'me' : 'other'} color={petColor(g.petIds[0])} src={app.photoUrl(petById(g.petIds[0])?.photo_path)} />
                <span className="name">{g.name}</span>
                {!g.mine && <span className="owner-tag">{nameOf(g.ownerId)}'s</span>}
              </div>

              {g.times.map((tg) => {
                const allDone = tg.slots.every((s) => done(s.state))
                const closed = allDone && !openSlots.has(tg.key) && !holding.has(tg.key)
                const pendingMine = tg.slots.filter((s) => s.mine && s.state === 'pending')
                const missed = tg.slots.filter((s) => s.state === 'missed').length
                const allAuto = tg.slots.every((s) => s.state === 'auto')
                const label = partOfDay(tg.time)
                const bodyId = 'slot-' + tg.key.replace(/[^a-z0-9]/gi, '')
                const headInner = (
                  <>
                    <span className="slot-label">{label}</span>
                    <span className="slot-time">{tg.time}</span>
                  </>
                )
                return (
                  <div key={tg.key} className="slot">
                    {allDone ? (
                      <button type="button" className="slot-head" aria-expanded={!closed} aria-controls={bodyId} onClick={() => toggleSlot(tg.key)}>
                        {headInner}
                        <span className="slot-sum">
                          {missed
                            ? <span className="warn-text">{tg.slots.length - missed} given · {missed} missed</span>
                            : <><span className="ok-mark"><IconCheck size={12} /></span>{allAuto ? 'Counted as given' : 'All given'}</>}
                        </span>
                        <IconChevron size={16} className={'chev' + (closed ? '' : ' open')} />
                      </button>
                    ) : (
                      <div className="slot-head">
                        {headInner}
                        {pendingMine.length >= 2 && (
                          <button type="button" className="mark-all" onClick={() => commit(pendingMine, tg.key)}>
                            <IconCheck size={14} />Mark all given
                          </button>
                        )}
                      </div>
                    )}

                    <Collapse open={!closed} id={bodyId}>
                      {tg.slots.map((s) => {
                        const isDone = s.state === 'given' || s.state === 'auto'
                        return (
                          <div key={s.key} className={'med-row' + (isDone ? ' done' : '')}>
                            {s.mine ? (
                              <button className={'tick ' + s.state + (popping.has(s.key) ? ' pop' : '')} onClick={() => commit([s], tg.key)}
                                aria-label={s.state === 'pending' ? `Mark ${s.name} for ${s.pets} as given` : s.state === 'missed' ? `${s.name} for ${s.pets} was missed. Tap to mark as given` : `${s.name} for ${s.pets} given. Tap if it was missed`}>
                                <span>{isDone ? <TickCheck size={16} draw={popping.has(s.key)} /> : s.state === 'missed' ? <IconX size={14} /> : null}</span>
                              </button>
                            ) : (
                              <div className="tick readonly" aria-hidden="true"><span /></div>
                            )}
                            <div className="grow">
                              <div className="row-title">{s.name}</div>
                              <div className={'row-sub' + (s.state === 'missed' ? ' warn-text' : '')}>{subFor(s)}</div>
                            </div>
                          </div>
                        )
                      })}
                    </Collapse>
                  </div>
                )
              })}
            </div>
          ))}
        </section>
      )}

      {cans.length > 0 && (
        <section className="card" aria-labelledby="cans-h">
          <div className="card-head">
            <h2 id="cans-h" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {cans.every(({ it }) => it.unit_label === cans[0].it.unit_label) ? `Open ${unitWord(cans[0].it.unit_label)}` : 'Open cans & pouches'}
              <InfoTip label="About this card">Tap “Opened a new {unitWord(cans[0].it.unit_label, 1)}” when you open one, so the count stays right. If you forget, the app keeps counting down on its own.</InfoTip>
            </h2>
          </div>
          {cans.map(({ it, info }) => (
            <div key={it.id} className="card-row" style={{ alignItems: 'flex-start' }}>
              <ItemThumb type={it.type} src={app.photoUrl(it.photo_path)} />
              <div className="grow stack-sm" style={{ gap: 6 }}>
                <Link to={`/stock/${it.id}`} className="row-title" style={{ color: 'inherit', textDecoration: 'none' }}>{it.name}</Link>
                <UnitFood item={it} info={info} mine compact reload={reload} />
              </div>
            </div>
          ))}
        </section>
      )}

      {low.length > 0 && (
        <section className="card" aria-labelledby="low-h">
          <div className="card-head"><h2 id="low-h">Running low</h2></div>
          {low.map(({ it, info }) => {
            const ids = it.stock_item_pets.map((p) => p.pet_id)
            const tone = stockTone(info)
            const order = orderText(info)
            return (
              <Link key={it.id} to={`/stock/${it.id}`} className="card-row" style={{ textDecoration: 'none', color: 'inherit', ...(lowPets.size > 1 ? petTint(ids.map(petColor)) : {}) }}>
                <ItemThumb type={it.type} src={app.photoUrl(it.photo_path)} />
                <div className="grow">
                  <div className="row-title">{it.name}</div>
                  <Meta parts={[
                    lowPets.size > 1 && ids.length > 0 && petNames(ids),
                    it.owner_id !== userId && <span className="owner-tag">{nameOf(it.owner_id)}'s</span>,
                    <span className={order && tone !== 'ok' ? 'tone-text-' + tone : undefined}>
                      {order ?? (info.countNow != null ? (info.byCount ? countText(info.countNow) : `${fmtNum(info.countNow)} ${unitFor(it, info.countNow)} left`) : 'Running low')}
                    </span>
                  ]} />
                </div>
                <ToneBadge tone={tone}>{info.daysLeft != null ? daysShort(info.daysLeft) : 'Low'}</ToneBadge>
              </Link>
            )
          })}
          <div className="card-foot">
            <Link to="/shop" className="btn block"><IconCart size={18} />Build shopping cart</Link>
          </div>
        </section>
      )}

      {dates.length > 0 && (
        <section className="card" aria-labelledby="dt-h">
          <div className="card-head"><h2 id="dt-h" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Check dates
            <InfoTip label="About this card">Items whose expiry date has passed, is within 2 weeks, or comes before you'd finish them, and open cans past their use-by time. Update the date on the item when a new pack arrives.</InfoTip></h2></div>
          {dates.map(({ it, info }) => (
            <Link key={it.id} to={`/stock/${it.id}`} className="card-row" style={{ textDecoration: 'none', color: 'inherit' }}>
              <ItemThumb type={it.type} src={app.photoUrl(it.photo_path)} />
              <div className="grow">
                <div className="row-title">{it.name}</div>
                <div className={'row-sub tone-text-' + (info.pastUseBy ? 'now' : expiryTone(info))}>{info.pastUseBy ? `Open ${unitWord(it.unit_label, 1)} is past its use-by` : expiryText(info, it.expires_on)}</div>
              </div>
            </Link>
          ))}
        </section>
      )}

      {recentVisits.length > 0 && (
        <section className="card" aria-labelledby="rv-h">
          <div className="card-head"><h2 id="rv-h" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>How did the vet visit go?
            <InfoTip label="About this card">Write down what the vet said while you still remember it, and add the documents they gave you. Shows for 3 days after a visit that has no notes yet.</InfoTip></h2></div>
          {recentVisits.map((a) => {
            const p = petById(a.pet_id)!
            return (
              <div key={a.id} className="card-row">
                <div className="icon-tile soft"><IconCalendar size={19} /></div>
                <Link to={`/pets/${p.id}/visits/${a.id}`} className="grow" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="row-title">{p.name} · {a.title}</div>
                  <Meta parts={[`${relDay(toISO(new Date(a.starts_at)))} ${fmtTime(a.starts_at)}`, <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Add notes</span>]} />
                </Link>
                <button className="icon-btn plain" aria-label={`No notes for ${a.title}`} onClick={() => dismissVisit(a.id)}><IconX size={14} /></button>
              </div>
            )
          })}
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="card" aria-labelledby="up-h">
          <div className="card-head"><h2 id="up-h">Coming up</h2></div>
          {upcoming.map((u) => {
            const inner = (
              <>
                <div className="icon-tile soft"><IconCalendar size={19} /></div>
                <div className="grow">
                  <div className="row-title">{u.title}</div>
                  <Meta parts={[u.pet, u.when]} />
                </div>
              </>
            )
            const style = upPets > 1 && u.petIds.length ? petTint(u.petIds.map(petColor)) : undefined
            return u.href
              ? <Link key={u.key} to={u.href} className="card-row" style={{ ...style, textDecoration: 'none', color: 'inherit' }}>{inner}</Link>
              : <div key={u.key} className="card-row" style={style}>{inner}</div>
          })}
        </section>
      )}

      {myPets.length > 0 && slots.length === 0 && low.length === 0 && upcoming.length === 0 && cans.length === 0 && dates.length === 0 && recentVisits.length === 0 && (
        <Empty title="All clear">
          <div className="hint">Nothing due today. Add medication or food to {myPets[0].name}'s stock to get reminders.</div>
          <Link to="/stock/new?type=med" className="btn ghost" style={{ alignSelf: 'flex-start' }}><IconPill size={18} />Add medication</Link>
        </Empty>
      )}
    </Screen>
  )
}
