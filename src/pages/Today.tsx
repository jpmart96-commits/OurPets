import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../lib/store'
import { errMsg } from '../lib/supabase'
import { addDays, daysBetween, fmtDateTime, fmtShort, fmtTime, fmtToday, greeting, relDay, todayISO } from '../lib/dates'
import { fmtNum, isDueOn, isUnitFood, itemInfo, medTimes, nextDue, unitFor, unitWord } from '../lib/calc'
import { Avatar, Empty, ErrorNote, InfoTip, ItemThumb, Loading, OwnerSwitch, Screen } from '../components/ui'
import { UnitFood } from '../components/UnitFood'
import { IconCalendar, IconCart, IconCheck, IconPill, IconX } from '../components/icons'
import { cycleDose, slotState, type SlotState } from '../lib/actions'
import type { DoseLog, StockItem } from '../lib/types'

export default function Today() {
  const app = useApp()
  const { profile, pets, items, logs, appointments, userId, showOwner, petById, loading, error, reload, nameOf } = app
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const today = todayISO()

  const petNames = (ids: string[]) => ids.map((id) => petById(id)?.name).filter(Boolean).join(' & ')

  const slots = useMemo(() => {
    const out: { key: string; item: StockItem; petId: string; pets: string; name: string; sub: string; time: string; mine: boolean; log?: DoseLog; state: SlotState }[] = []
    for (const it of items) {
      if (it.type !== 'med' || !showOwner(it.owner_id) || !isDueOn(it, today)) continue
      const petIds = it.stock_item_pets.map((p) => p.pet_id)
      if (!petIds.length) continue
      for (const t of medTimes(it)) {
        const log = logs.find((l) => l.item_id === it.id && l.slot_date === today && l.slot_time === t)
        const mine = it.owner_id === userId
        const dose = Number(it.dose ?? 1)
        let sub = `${fmtNum(dose)} ${unitFor(it, dose)}`
        if (!mine) sub += ` · ${nameOf(it.owner_id)}'s pet`
        const state = slotState(today, t, log)
        if (state === 'given') sub += ` · given ${fmtTime(log!.given_at)}`
        else if (state === 'auto') sub += ' · counted as given'
        else if (state === 'missed') sub += ' · missed, pill added back'
        out.push({ key: it.id + t, item: it, petId: petIds[0], pets: petNames(petIds), name: it.name, sub, time: t, mine, log, state })
      }
    }
    return out.sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, logs, today, userId, app.filter, pets])

  const low = useMemo(() => items
    .filter((it) => showOwner(it.owner_id))
    .map((it) => ({ it, info: itemInfo(it) }))
    .filter(({ info }) => info.due)
    .sort((a, b) => (a.info.orderIn ?? -99) - (b.info.orderIn ?? -99)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [items, app.filter])

  // food tracked by units that I feed: one-tap "Opened a new can"
  const cans = useMemo(() => items
    .filter((it) => it.owner_id === userId && it.status === 'active' && isUnitFood(it) && it.unit_days)
    .map((it) => ({ it, info: itemInfo(it) })),
  [items, userId])

  const upcoming = useMemo(() => {
    const out: { key: string; title: string; pet: string; when: string; sort: string }[] = []
    const horizon = addDays(today, 30)
    for (const a of appointments) {
      const p = petById(a.pet_id)
      if (!p || !showOwner(p.owner_id)) continue
      if (a.starts_at.slice(0, 10) > horizon) continue
      if (new Date(a.starts_at) < new Date()) continue
      out.push({ key: a.id, title: a.title, pet: p.name, when: fmtDateTime(a.starts_at), sort: a.starts_at })
    }
    for (const it of items) {
      if (it.type !== 'med' || !showOwner(it.owner_id)) continue
      if (it.frequency !== 'weekly' && it.frequency !== 'monthly') continue
      const d = nextDue(it, addDays(today, 1), 30)
      if (!d || daysBetween(today, d) > 21) continue
      out.push({ key: it.id, title: it.name, pet: petNames(it.stock_item_pets.map((p) => p.pet_id)), when: relDay(d), sort: d })
    }
    for (const v of app.vaccinations) {
      const p = petById(v.pet_id)
      if (!p || !showOwner(p.owner_id) || !v.next_due) continue
      if (daysBetween(today, v.next_due) > 30) continue
      const overdue = v.next_due < today
      out.push({ key: v.id, title: v.name + (overdue ? ' (overdue)' : ''), pet: p.name, when: overdue ? `was due ${fmtShort(v.next_due)}` : relDay(v.next_due), sort: v.next_due })
    }
    return out.sort((a, b) => a.sort.localeCompare(b.sort)).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, items, app.filter, pets, app.vaccinations])

  async function toggle(s: (typeof slots)[number]) {
    setBusy(s.key); setErr(null)
    const res = await cycleDose(s.item, s.petId, today, s.time, s.log)
    if (res.error) setErr(errMsg(res.error))
    await reload()
    setBusy(null)
  }

  const givenCount = slots.filter((s) => s.state === 'given' || s.state === 'auto').length
  const missedCount = slots.filter((s) => s.state === 'missed').length
  const myPets = pets.filter((p) => p.owner_id === userId)
  const first = (profile?.display_name || '').split(' ')[0]

  return (
    <Screen>
      <header className="stack" style={{ gap: 16 }}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="small muted" style={{ fontWeight: 500 }}>{fmtToday()}</div>
            <h1 className="title" style={{ marginTop: 4 }}>{greeting()}{first ? `, ${first}` : ''}</h1>
          </div>
          <Link to="/profile" aria-label="Profile and household" className="avatar-link">
            <Avatar name={first || '?'} size={44} src={app.photoUrl(profile?.avatar_path)} />
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
          <div className="card-head">
            <h2 id="meds-h">Medication today</h2>
            <span className="small muted">{givenCount} of {slots.length} given{missedCount ? ` · ${missedCount} missed` : ''}</span>
          </div>
          {slots.map((s) => (
            <div key={s.key} className="card-row" style={{ padding: '6px 16px 6px 6px', gap: 8 }}>
              {s.mine ? (
                <button className={'tick ' + s.state} onClick={() => toggle(s)} disabled={busy === s.key}
                  aria-label={s.state === 'pending' ? `Mark ${s.name} for ${s.pets} as given` : s.state === 'missed' ? `${s.name} for ${s.pets} was missed. Tap to mark as given` : `${s.name} for ${s.pets} given. Tap if it was missed`}>
                  <span>{s.state === 'given' || s.state === 'auto' ? <IconCheck size={16} /> : s.state === 'missed' ? <IconX size={14} /> : null}</span>
                </button>
              ) : (
                <div className="tick readonly" aria-hidden="true"><span /></div>
              )}
              <div className="grow">
                <div className="row-title">{s.pets} · {s.name}</div>
                <div className="row-sub">{s.sub}</div>
              </div>
              <div className="tabular" style={{ fontSize: 14, fontWeight: 600 }}>{s.time || 'Today'}</div>
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
          {low.map(({ it, info }) => (
            <Link key={it.id} to={`/stock/${it.id}`} className="card-row" style={{ textDecoration: 'none', color: 'inherit' }}>
              <ItemThumb type={it.type} src={app.photoUrl(it.photo_path)} />
              <div className="grow">
                <div className="row-title">{it.name}{it.type === 'med' && info.countNow != null ? ` · ${fmtNum(info.countNow)} left` : ''}</div>
                <div className="row-sub">{petNames(it.stock_item_pets.map((p) => p.pet_id)) || '—'}{it.owner_id !== userId ? ` · ${nameOf(it.owner_id)}'s` : ''}</div>
              </div>
              <span className={'badge ' + (info.urgent ? 'warn' : '')} style={info.urgent ? undefined : { background: 'transparent', color: 'var(--muted-2)' }}>
                {info.daysLeft != null ? `${info.daysLeft} days` : 'Low'}
              </span>
            </Link>
          ))}
          <div className="card-foot">
            <Link to="/shop" className="btn block"><IconCart size={18} />Build shopping cart</Link>
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="card" aria-labelledby="up-h">
          <div className="card-head"><h2 id="up-h">Coming up</h2></div>
          {upcoming.map((u) => (
            <div key={u.key} className="card-row">
              <div className="icon-tile soft"><IconCalendar size={19} /></div>
              <div className="grow">
                <div className="row-title">{u.title}</div>
                <div className="row-sub">{u.pet} · {u.when}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      {myPets.length > 0 && slots.length === 0 && low.length === 0 && upcoming.length === 0 && cans.length === 0 && (
        <Empty title="All clear">
          <div className="hint">Nothing due today. Add medication or food to {myPets[0].name}'s stock to get reminders.</div>
          <Link to="/stock/new?type=med" className="btn ghost" style={{ alignSelf: 'flex-start' }}><IconPill size={18} />Add medication</Link>
        </Empty>
      )}
    </Screen>
  )
}
