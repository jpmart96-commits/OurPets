import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg } from '../lib/supabase'
import { addDays, fmtShort, todayISO } from '../lib/dates'
import { euro } from '../lib/calc'
import { CATEGORIES, categoryLabel, lastMonths, monthlyRunRate, petShare, round2 } from '../lib/costs'
import type { Expense, ExpenseCategory } from '../lib/types'
import { Avatar, BackLink, Chips, ErrorNote, FieldLabel, InfoTip, OwnerSwitch, Screen } from '../components/ui'
import { IconPlus, IconTrash, IconX } from '../components/icons'

type Period = 'month' | 'last' | 'year' | '12m'
const PERIODS: { id: Period; label: string }[] = [
  { id: 'month', label: 'This month' }, { id: 'last', label: 'Last month' }, { id: 'year', label: 'This year' }, { id: '12m', label: '12 months' }
]

function periodRange(p: Period): { from: string; to: string } {
  const t = todayISO()
  const month = t.slice(0, 7) + '-01'
  if (p === 'month') return { from: month, to: addDays(t, 1) }
  if (p === 'last') {
    const d = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 2, 1)
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    return { from, to: month }
  }
  if (p === 'year') return { from: t.slice(0, 4) + '-01-01', to: addDays(t, 1) }
  return { from: lastMonths(12)[0].from, to: addDays(t, 1) }
}

export default function Costs() {
  const app = useApp()
  const { pets, items, stores, userId, household, showOwner, nameOf, photoUrl } = app
  const [qs, setQs] = useSearchParams()
  const petFilter = qs.get('pet')
  const [period, setPeriod] = useState<Period>('month')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)

  const months = useMemo(() => lastMonths(12), [])
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('expenses').select('*').gte('spent_on', months[0].from).order('spent_on', { ascending: false }).order('created_at', { ascending: false })
    if (error) setError(errMsg(error))
    setExpenses((data ?? []) as Expense[])
  }, [months])
  useEffect(() => { void load() }, [load])

  const pet = petFilter ? pets.find((p) => p.id === petFilter) : undefined
  const visiblePets = pets.filter((p) => showOwner(p.owner_id))
  // an expense counts when its owner is shown (Mine / theirs / both), and for the chosen pet if any
  const scoped = expenses.filter((e) => showOwner(e.owner_id) && (!pet || e.pet_ids.includes(pet.id)))
  const amountOf = (e: Expense) => (pet ? petShare(e, pet.id) : Number(e.amount))

  const { from, to } = periodRange(period)
  const inPeriod = scoped.filter((e) => e.spent_on >= from && e.spent_on < to)
  const total = round2(inPeriod.reduce((s, e) => s + amountOf(e), 0))

  const byMonth = months.map((m) => ({ ...m, sum: round2(scoped.filter((e) => e.spent_on >= m.from && e.spent_on < m.to).reduce((s, e) => s + amountOf(e), 0)) }))
  const maxMonth = Math.max(1, ...byMonth.map((m) => m.sum))
  const fullMonths = byMonth.slice(0, -1).filter((m) => m.sum !== 0)
  const avg = fullMonths.length ? round2(fullMonths.reduce((s, m) => s + m.sum, 0) / fullMonths.length) : null

  const byPet = visiblePets.map((p) => ({ p, sum: round2(inPeriod.reduce((s, e) => s + petShare(e, p.id), 0)) })).filter((x) => x.sum !== 0).sort((a, b) => b.sum - a.sum)
  const unassigned = round2(inPeriod.filter((e) => !e.pet_ids.length).reduce((s, e) => s + Number(e.amount), 0))
  const byCat = CATEGORIES.map((c) => ({ c, sum: round2(inPeriod.filter((e) => e.category === c.id).reduce((s, e) => s + amountOf(e), 0)) })).filter((x) => x.sum !== 0).sort((a, b) => b.sum - a.sum)
  const maxPet = Math.max(1, ...byPet.map((x) => x.sum), unassigned)
  const maxCat = Math.max(1, ...byCat.map((x) => x.sum))
  const runRate = monthlyRunRate(items.filter((it) => showOwner(it.owner_id)), pet?.id)

  async function remove(e: Expense) {
    const msg = e.order_id ? 'Delete this line? The rest of the order stays.' : `Delete “${e.title}”?`
    if (!window.confirm(msg)) return
    setBusy(true); setError(null)
    const r = await supabase.from('expenses').delete().eq('id', e.id)
    if (r.error) setError(errMsg(r.error))
    await load(); setBusy(false)
  }

  const shownMonth = picked ? byMonth.find((m) => m.key === picked) : undefined

  return (
    <Screen>
      <BackLink label="Back" />
      <header className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="title">{pet ? `${pet.name}'s costs` : 'Costs'}</h1>
          <div className="sub">{pet ? <button className="link-btn" style={{ padding: 0, minHeight: 0, fontSize: 13 }} onClick={() => setQs({})}>Show all pets</button> : 'What your pets cost, from orders and expenses you log'}</div>
        </div>
        <button className="icon-btn" aria-label="Add an expense" onClick={() => setAdding(!adding)}>{adding ? <IconX size={18} /> : <IconPlus size={20} />}</button>
      </header>
      {!pet && <OwnerSwitch />}
      <ErrorNote msg={error} />

      {adding && household && (
        <ExpenseForm householdId={household.id} myPets={pets.filter((p) => p.owner_id === userId)} defaultPet={pet?.owner_id === userId ? pet.id : undefined}
          onSaved={async () => { setAdding(false); await load() }} setError={setError} />
      )}

      <Chips<Period> label="Period" value={period} onChange={setPeriod} scroll options={PERIODS} />

      <section className="card pad stack-sm">
        <div className="small muted" style={{ fontWeight: 600 }}>{PERIODS.find((p) => p.id === period)!.label}</div>
        <div className="tabular" style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 600 }}>{euro(total)}</div>
        <div className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          {avg != null ? `Average ${euro(avg)} a month` : 'Log a few orders to see your monthly average'}
          {runRate > 0 && <> · stock runs about {euro(runRate)}/month
            <InfoTip label="About the monthly stock estimate">Worked out from your stock list: each item's price divided by how many days a pack or box lasts, times 30. Only items with a price count. Shared kibble is split by how much each pet eats; other shared items evenly. Pets → Costs shows it per pet and per item.</InfoTip></>}
        </div>
      </section>

      <section className="card pad stack-sm" aria-labelledby="mon-h">
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <h2 id="mon-h" className="h">By month</h2>
          <span className="small muted tabular">{shownMonth ? `${shownMonth.label}: ${euro(shownMonth.sum)}` : 'tap a month'}</span>
        </div>
        <div className="mbars" role="list" aria-label="Spending in the last 12 months">
          {byMonth.map((m, i) => (
            <div key={m.key} role="listitem">
              <button type="button" onClick={() => setPicked(picked === m.key ? null : m.key)} aria-label={`${m.label}: ${euro(m.sum)}`} title={`${m.label}: ${euro(m.sum)}`}
                style={{ flex: 1, width: '100%', border: 0, background: 'transparent', padding: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                <span className={'col' + (m.sum <= 0 ? ' zero' : '') + (i === byMonth.length - 1 || picked === m.key ? ' now' : '')}
                  style={{ height: `${Math.max(2, Math.round((Math.max(0, m.sum) / maxMonth) * 100))}%`, display: 'block' }} />
              </button>
              <span>{m.label.slice(0, 1)}</span>
            </div>
          ))}
        </div>
      </section>

      {!pet && (byPet.length > 0 || unassigned !== 0) && (
        <section className="card" aria-labelledby="pp-h">
          <div className="card-head"><h2 id="pp-h" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>By pet
            <InfoTip label="How costs are split">An expense for several pets is split evenly between them, for example a bag of food two dogs share. Costs with no pet (like shared supplies) show as “Household”.</InfoTip></h2></div>
          {byPet.map(({ p, sum }) => (
            <button key={p.id} type="button" className="card-row" onClick={() => setQs({ pet: p.id })} style={{ width: '100%', border: 0, borderTop: '1px solid var(--line-2)', background: 'transparent', textAlign: 'left', font: 'inherit', color: 'inherit' }}>
              <Avatar name={p.name} size={32} owner={p.owner_id === userId ? 'me' : 'other'} src={photoUrl(p.photo_path)} />
              <div className="grow stack-sm" style={{ gap: 6 }}>
                <div className="row between"><span className="row-title">{p.name}</span><span className="tabular" style={{ fontWeight: 700 }}>{euro(sum)}</span></div>
                <div className="hbar"><div style={{ width: `${Math.max(2, (sum / maxPet) * 100)}%` }} /></div>
              </div>
            </button>
          ))}
          {unassigned !== 0 && (
            <div className="card-row">
              <div className="grow stack-sm" style={{ gap: 6 }}>
                <div className="row between"><span className="row-title">Household</span><span className="tabular" style={{ fontWeight: 700 }}>{euro(unassigned)}</span></div>
                <div className="hbar"><div style={{ width: `${Math.max(2, (Math.max(0, unassigned) / maxPet) * 100)}%`, background: 'var(--muted-2)' }} /></div>
              </div>
            </div>
          )}
        </section>
      )}

      {byCat.length > 0 && (
        <section className="card" aria-labelledby="cat-h">
          <div className="card-head"><h2 id="cat-h">By type</h2></div>
          {byCat.map(({ c, sum }) => (
            <div key={c.id} className="card-row">
              <div className="grow stack-sm" style={{ gap: 6 }}>
                <div className="row between"><span className="row-title">{c.label}</span><span className="tabular" style={{ fontWeight: 700 }}>{euro(sum)}</span></div>
                <div className="hbar"><div style={{ width: `${Math.max(2, (Math.max(0, sum) / maxCat) * 100)}%` }} /></div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card" aria-labelledby="ls-h">
        <div className="card-head"><h2 id="ls-h">Spending</h2><span className="small muted">{inPeriod.length} {inPeriod.length === 1 ? 'entry' : 'entries'}</span></div>
        {inPeriod.length === 0 && (
          <div className="card-row"><span className="hint">Nothing logged for this period. Costs come from “I placed the order” in the <Link to="/shop">Shopping run</Link>, “Log a purchase” on a stock item, and the + button above for vet bills, insurance and the rest.</span></div>
        )}
        {inPeriod.map((e) => {
          const petNames = e.pet_ids.map((id) => pets.find((p) => p.id === id)?.name).filter(Boolean).join(' & ')
          const store = stores.find((s) => s.id === e.store_id)?.name
          return (
            <div key={e.id} className="card-row">
              <div className="grow">
                <div className="row-title">{e.title}{e.quantity && Number(e.quantity) !== 1 ? ` × ${Number(e.quantity)}` : ''}</div>
                <div className="row-sub">{[fmtShort(e.spent_on), categoryLabel(e.category), petNames || 'Household', store, e.owner_id !== userId ? `${nameOf(e.owner_id)}'s` : null, e.note].filter(Boolean).join(' · ')}</div>
              </div>
              <span className="tabular" style={{ fontWeight: 700 }}>{euro(pet ? amountOf(e) : Number(e.amount))}</span>
              {e.owner_id === userId && <button className="icon-btn plain" aria-label={`Delete ${e.title}`} disabled={busy} onClick={() => void remove(e)}><IconTrash size={18} /></button>}
            </div>
          )
        })}
      </section>
    </Screen>
  )
}

function ExpenseForm({ householdId, myPets, defaultPet, onSaved, setError }: {
  householdId: string
  myPets: { id: string; name: string }[]
  defaultPet?: string
  onSaved: () => Promise<void>
  setError: (s: string | null) => void
}) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [cat, setCat] = useState<ExpenseCategory>('vet')
  const [petIds, setPetIds] = useState<string[]>(defaultPet ? [defaultPet] : myPets.length === 1 ? [myPets[0].id] : [])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    const a = parseFloat(amount.replace(',', '.'))
    if (!Number.isFinite(a)) { setError('Type the amount, e.g. 45.50'); return }
    setSaving(true); setError(null)
    const { error } = await supabase.from('expenses').insert({
      household_id: householdId, spent_on: date || todayISO(), amount: round2(a), category: cat,
      title: title.trim() || categoryLabel(cat), pet_ids: petIds, note: note.trim() || null
    })
    setSaving(false)
    if (error) { setError(errMsg(error)); return }
    await onSaved()
  }

  return (
    <form className="card pad stack" onSubmit={save}>
      <h2 className="h">Add an expense</h2>
      <Chips<ExpenseCategory> label="Type" value={cat} onChange={setCat} options={CATEGORIES.filter((c) => c.id !== 'shipping')} />
      <div className="field"><label htmlFor="xt">What</label><input id="xt" className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={cat === 'vet' ? 'e.g. Check-up and blood test' : cat === 'insurance' ? 'e.g. Pet insurance, October' : 'e.g. Grooming'} /></div>
      <div className="grid2" style={{ gap: 12 }}>
        <div className="field"><label htmlFor="xa">Amount (€)</label><input id="xa" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required /></div>
        <div className="field"><label htmlFor="xd">Date</label><input id="xd" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      {myPets.length > 0 && (
        <div className="field">
          <FieldLabel as="span" tip="Pick every pet this was for; the amount is split evenly between them. Pick none for household costs.">For</FieldLabel>
          <div className="chips" role="group" aria-label="Pets">
            {myPets.map((p) => (
              <button key={p.id} type="button" className={'chip' + (petIds.includes(p.id) ? ' on' : '')} aria-pressed={petIds.includes(p.id)}
                onClick={() => setPetIds(petIds.includes(p.id) ? petIds.filter((x) => x !== p.id) : [...petIds, p.id])}>{p.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="field"><label htmlFor="xn">Note <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></label><input id="xn" className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></div>
      <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save expense'}</button>
    </form>
  )
}
