import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg } from '../lib/supabase'
import { addDays, daysBetween, fmtDateTime, fmtTime, fmtToday, greeting, relDay, todayISO } from '../lib/dates'
import { fmtNum, isDueOn, itemInfo, medTimes, nextDue, unitFor } from '../lib/calc'
import { Avatar, Empty, ErrorNote, ItemThumb, Loading, OwnerSwitch, Screen } from '../components/ui'
import { IconCalendar, IconCart, IconCheck, IconPill } from '../components/icons'

export default function Today() {
  const app = useApp()
  const { profile, pets, items, logs, appointments, userId, showOwner, petById, loading, error, reload, nameOf } = app
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const today = todayISO()

  const petNames = (ids: string[]) => ids.map((id) => petById(id)?.name).filter(Boolean).join(' & ')

  const slots = useMemo(() => {
    const out: { key: string; itemId: string; petId: string; pets: string; name: string; sub: string; time: string; mine: boolean; given?: string }[] = []
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
        if (log) sub += ` · given ${fmtTime(log.given_at)}`
        out.push({ key: it.id + t, itemId: it.id, petId: petIds[0], pets: petNames(petIds), name: it.name, sub, time: t, mine, given: log?.id })
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
    return out.sort((a, b) => a.sort.localeCompare(b.sort)).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, items, app.filter, pets])

  async function toggle(s: (typeof slots)[number]) {
    setBusy(s.key); setErr(null)
    const res = s.given
      ? await supabase.from('dose_logs').delete().eq('id', s.given)
      : await supabase.from('dose_logs').insert({ item_id: s.itemId, pet_id: s.petId, slot_date: today, slot_time: s.time })
    if (res.error) setErr(errMsg(res.error))
    await reload()
    setBusy(null)
  }

  const givenCount = slots.filter((s) => s.given).length
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
            <span className="small muted">{givenCount} of {slots.length} given</span>
          </div>
          {slots.map((s) => (
            <div key={s.key} className="card-row" style={{ padding: '6px 16px 6px 6px', gap: 8 }}>
              {s.mine ? (
                <button className={'tick' + (s.given ? ' done' : '')} onClick={() => toggle(s)} disabled={busy === s.key}
                  aria-label={s.given ? `Undo: ${s.name} for ${s.pets} not given` : `Mark ${s.name} for ${s.pets} as given`}>
                  <span>{s.given ? <IconCheck size={16} /> : null}</span>
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

      {myPets.length > 0 && slots.length === 0 && low.length === 0 && upcoming.length === 0 && (
        <Empty title="All clear">
          <div className="hint">Nothing due today. Add medication or food to {myPets[0].name}'s stock to get reminders.</div>
          <Link to="/stock/new?type=med" className="btn ghost" style={{ alignSelf: 'flex-start' }}><IconPill size={18} />Add medication</Link>
        </Empty>
      )}
    </Screen>
  )
}
