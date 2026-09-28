import { Link, useSearchParams } from 'react-router-dom'
import { useApp } from '../lib/store'
import { ageText, fmtDateTime, relDay, addDays, todayISO } from '../lib/dates'
import { itemInfo, nextDue } from '../lib/calc'
import type { Pet } from '../lib/types'
import { Avatar, Empty, ErrorNote, Screen, Segmented } from '../components/ui'
import { CostsDashboard } from '../components/CostsDashboard'
import { IconChevron, IconPlus } from '../components/icons'

const SPECIES: Record<string, string> = { dog: 'Dog', cat: 'Cat', other: 'Pet' }

export default function Pets() {
  const { pets, userId, shared, othersLabel, items, appointments, error, photoUrl, petColor } = useApp()
  const mine = pets.filter((p) => p.owner_id === userId)
  const theirs = shared ? pets.filter((p) => p.owner_id !== userId) : []
  const [qs, setQs] = useSearchParams()
  const view: 'pets' | 'costs' = qs.get('view') === 'costs' ? 'costs' : 'pets'

  function nextFor(p: Pet): string | null {
    const appt = appointments.find((a) => a.pet_id === p.id && new Date(a.starts_at) >= new Date())
    const candidates: { sort: string; text: string }[] = []
    if (appt) candidates.push({ sort: appt.starts_at, text: `${appt.title}, ${fmtDateTime(appt.starts_at)}` })
    for (const it of items) {
      if (!it.stock_item_pets.some((sp) => sp.pet_id === p.id)) continue
      if (it.type === 'med' && (it.frequency === 'weekly' || it.frequency === 'monthly')) {
        const d = nextDue(it, todayISO(), 45)
        if (d) candidates.push({ sort: d, text: `${it.name}, ${relDay(d)}` })
      }
      const info = itemInfo(it)
      if (info.due && info.orderBy) candidates.push({ sort: addDays(info.orderBy, 0), text: `Reorder ${it.name}, ${relDay(info.orderBy)}` })
    }
    candidates.sort((a, b) => a.sort.localeCompare(b.sort))
    return candidates[0]?.text ?? null
  }

  const card = (p: Pet, owner: 'me' | 'other') => {
    const next = nextFor(p)
    const meta = [SPECIES[p.species], p.breed, ageText(p.birth_date)].filter(Boolean).join(' · ')
    return (
      <Link key={p.id} to={`/pets/${p.id}`} className="card pad row" style={{ textDecoration: 'none', color: 'inherit', gap: 14 }}>
        <Avatar name={p.name} owner={owner} src={photoUrl(p.photo_path)} color={petColor(p.id)} />
        <div className="grow">
          <div style={{ fontSize: 17, fontWeight: 700 }}>{p.name}</div>
          <div className="row-sub">{meta}</div>
          {next && <div className="small" style={{ color: owner === 'me' ? 'var(--accent)' : 'var(--other)', fontWeight: 600, marginTop: 6 }}>Next: {next}</div>}
        </div>
        <IconChevron size={18} style={{ color: 'var(--muted)' }} />
      </Link>
    )
  }

  return (
    <Screen>
      <header className="row between">
        <h1 className="title">Pets</h1>
        {view === 'pets' && <Link to="/pets/new" className="btn ghost small" style={{ minHeight: 44 }}><IconPlus size={16} />Add pet</Link>}
      </header>
      {pets.length > 0 && (
        <Segmented<'pets' | 'costs'> label="Show" value={view} onChange={(v) => setQs(v === 'costs' ? { view: 'costs' } : {}, { replace: true })}
          options={[{ id: 'pets', label: 'Pets' }, { id: 'costs', label: 'Costs' }]} />
      )}
      <ErrorNote msg={error} />

      {view === 'costs' ? <CostsDashboard /> : (<>
      {mine.length === 0 ? (
        <Empty title="No pets yet">
          <div className="hint">Add a pet with its name and species. Everything else is optional and can be filled in later.</div>
          <Link to="/pets/new" className="btn" style={{ alignSelf: 'flex-start' }}>Add a pet</Link>
        </Empty>
      ) : (
        <section className="stack-sm">
          {shared && <h2 className="section-label"><span className="dot" />Yours</h2>}
          {mine.map((p) => card(p, 'me'))}
        </section>
      )}

      {shared && (
        <section className="stack-sm">
          <h2 className="section-label"><span className="dot other" />{othersLabel}</h2>
          {theirs.length ? theirs.map((p) => card(p, 'other')) : <div className="hint">No pets added yet.</div>}
          <p className="hint" style={{ margin: '2px 4px 0' }}>You can see these pets and what's due, but only their owner can log care.</p>
        </section>
      )}
      </>)}
    </Screen>
  )
}
