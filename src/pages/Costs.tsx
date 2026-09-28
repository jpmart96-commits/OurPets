import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg } from '../lib/supabase'
import { addDays, fmtShort, todayISO } from '../lib/dates'
import { euro, isWeightFood } from '../lib/calc'
import { CATEGORIES, categoryLabel, lastMonths, lastPaid, monthlyLines, petShare, round2, type EstimateLine } from '../lib/costs'
import type { Expense, ExpenseCategory, ItemType } from '../lib/types'
import { Avatar, BackLink, Chips, Collapse, ErrorNote, FieldLabel, InfoTip, ItemThumb, OwnerSwitch, PetDot, Screen, Toggle } from '../components/ui'
import { IconChevron, IconPlus, IconTrash, IconX } from '../components/icons'

type Period = 'month' | 'last' | 'year' | '12m'
const PERIODS: { id: Period; label: string }[] = [
  { id: 'month', label: 'This month' }, { id: 'last', label: 'Last month' }, { id: 'year', label: 'This year' }, { id: '12m', label: '12 months' }
]
const TYPE_LABEL: Record<ItemType, string> = { food: 'Food', med: 'Meds', supply: 'Supplies' }
const HOUSEHOLD = 'var(--muted-2)'
/** Estimates are rough, so no cents: "~€108" */
const approx = (n: number) => `~€${Math.round(n)}`

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

function shareText(share: number): string {
  if (share >= 0.999) return ''
  if (Math.abs(share - 0.5) < 0.01) return 'half'
  if (Math.abs(share - 1 / 3) < 0.01) return 'a third'
  return `${Math.round(share * 100)}%`
}

/** "€54.90 a bag · lasts ~48 days · half of it (shared)" */
function lineSub(l: EstimateLine): string {
  const it = l.item
  const pack = it.type === 'med' ? 'box' : isWeightFood(it) ? 'bag' : 'pack'
  const parts: string[] = []
  if (l.fromLastPaid) parts.push(`last paid ${euro(l.fromLastPaid.amount)} a ${pack} (${fmtShort(l.fromLastPaid.on)})`)
  else if (l.unitPrice != null) parts.push(`${euro(l.unitPrice)} a ${pack}`)
  if (l.packDays) parts.push(`lasts ~${l.packDays} days`)
  const sh = shareText(l.share)
  if (sh) parts.push(`${sh} of it (shared)`)
  return parts.join(' · ')
}

/**
 * One place for money: what was spent (logged orders, purchases and bills) next to what stock should cost
 * (the estimate from prices and how long packs last). `?pet=<id>` narrows everything to one pet.
 */
export default function Costs() {
  const app = useApp()
  const { pets, items, stores, userId, household, showOwner, nameOf, photoUrl, petColor } = app
  const [qs, setQs] = useSearchParams()
  const petFilter = qs.get('pet')
  const [period, setPeriod] = useState<Period>('month')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [openPet, setOpenPet] = useState<string | null>(null)

  const months = useMemo(() => lastMonths(12), [])
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('expenses').select('*').gte('spent_on', months[0].from).order('spent_on', { ascending: false }).order('created_at', { ascending: false })
    if (error) setError(errMsg(error))
    setExpenses((data ?? []) as Expense[])
  }, [months])
  useEffect(() => { void load() }, [load])

  const pet = petFilter ? pets.find((p) => p.id === petFilter) : undefined
  const shownPets = pet ? [pet] : pets.filter((p) => showOwner(p.owner_id) && !p.archived)
  const shownItems = items.filter((it) => showOwner(it.owner_id))
  // an expense counts when its owner is shown (Mine / theirs / both), and for the chosen pet if any
  const scoped = expenses.filter((e) => (pet || showOwner(e.owner_id)) && (!pet || e.pet_ids.includes(pet.id)))
  const amountOf = (e: Expense) => (pet ? petShare(e, pet.id) : Number(e.amount))
  const sumOf = (list: Expense[]) => round2(list.reduce((s, e) => s + amountOf(e), 0))

  // ── what stock should cost: price ÷ days a pack lasts × 30, per pet ──
  const paid = useMemo(() => lastPaid(expenses), [expenses])
  const est = shownPets.map((p) => {
    const lines = monthlyLines(shownItems, p.id, paid)
    return {
      p, lines,
      sum: round2(lines.reduce((s, l) => s + (l.perMonth ?? 0), 0)),
      byType: (['food', 'med', 'supply'] as ItemType[])
        .map((t) => ({ t, sum: round2(lines.filter((l) => l.item.type === t).reduce((s, l) => s + (l.perMonth ?? 0), 0)) }))
        .filter((x) => x.sum > 0),
      missing: lines.filter((l) => l.missing === 'price' || l.missing === 'duration')
    }
  })
  const estTotal = round2(est.reduce((s, r) => s + r.sum, 0))
  const missingCount = est.reduce((s, r) => s + r.missing.length, 0)

  // ── what was spent ──
  const { from, to } = periodRange(period)
  const inPeriod = scoped.filter((e) => e.spent_on >= from && e.spent_on < to)
  const total = sumOf(inPeriod)
  const oneOffTotal = sumOf(inPeriod.filter((e) => e.one_off))

  // months, stacked by pet (regular spending) with one-offs on top
  const stackByPet = !pet && (shownPets.length > 1 || scoped.some((e) => !e.pet_ids.length))
  const byMonth = months.map((m) => {
    const inM = scoped.filter((e) => e.spent_on >= m.from && e.spent_on < m.to)
    const regular = inM.filter((e) => !e.one_off)
    const oneOff = sumOf(inM.filter((e) => e.one_off))
    const segs: { id: string; name: string; color: string; sum: number }[] = stackByPet
      ? [
          ...shownPets.map((p) => ({ id: p.id, name: p.name, color: petColor(p.id), sum: round2(regular.reduce((s, e) => s + petShare(e, p.id), 0)) })),
          { id: 'house', name: 'Household', color: HOUSEHOLD, sum: round2(regular.filter((e) => !e.pet_ids.length).reduce((s, e) => s + Number(e.amount), 0)) }
        ]
      : [{ id: 'all', name: pet ? pet.name : 'Spent', color: 'var(--accent)', sum: sumOf(regular) }]
    const parts = segs.filter((x) => x.sum > 0)
    const regularSum = round2(parts.reduce((s, x) => s + x.sum, 0))
    return { ...m, parts, oneOff, regular: regularSum, sum: round2(regularSum + oneOff) }
  })
  const maxMonth = Math.max(1, estTotal, ...byMonth.map((m) => m.sum))
  const anyOneOff = byMonth.some((m) => m.oneOff > 0)
  const hasHousehold = byMonth.some((m) => m.parts.some((x) => x.id === 'house'))
  // the average leaves one-off purchases out, so a new bed doesn't make one month look like the norm
  const fullMonths = byMonth.slice(0, -1).filter((m) => m.regular !== 0)
  const avg = fullMonths.length ? round2(fullMonths.reduce((s, m) => s + m.regular, 0) / fullMonths.length) : null
  const shownMonth = picked ? byMonth.find((m) => m.key === picked) : undefined

  const byPet = est.map((r) => ({ ...r, spent: round2(inPeriod.reduce((s, e) => s + petShare(e, r.p.id), 0)) }))
  const unassigned = round2(inPeriod.filter((e) => !e.pet_ids.length).reduce((s, e) => s + Number(e.amount), 0))
  const maxPet = Math.max(1, ...byPet.map((x) => x.spent), unassigned)
  const byCat = CATEGORIES.map((c) => ({ c, sum: sumOf(inPeriod.filter((e) => e.category === c.id)) })).filter((x) => x.sum !== 0).sort((a, b) => b.sum - a.sum)
  const maxCat = Math.max(1, ...byCat.map((x) => x.sum))
  const periodLabel = PERIODS.find((p) => p.id === period)!.label

  async function remove(e: Expense) {
    const msg = e.order_id ? 'Delete this line? The rest of the order stays.' : `Delete “${e.title}”?`
    if (!window.confirm(msg)) return
    setBusy(true); setError(null)
    const r = await supabase.from('expenses').delete().eq('id', e.id)
    if (r.error) setError(errMsg(r.error))
    await load(); setBusy(false)
  }

  async function setOneOff(e: Expense, v: boolean) {
    setError(null)
    setExpenses((list) => list.map((x) => (x.id === e.id ? { ...x, one_off: v } : x)))
    const r = await supabase.from('expenses').update({ one_off: v }).eq('id', e.id)
    if (r.error) { setError(errMsg(r.error)); await load() }
  }

  const itemLines = (lines: EstimateLine[]) => (
    <>
      {lines.length === 0 && <div className="hint">No stock items yet.</div>}
      {lines.map((l) => (
        <div key={l.item.id} className="row" style={{ gap: 10, alignItems: 'center' }}>
          <ItemThumb type={l.item.type} src={photoUrl(l.item.photo_path)} size={32} />
          <div className="grow">
            <div className="small" style={{ fontWeight: 600, color: 'var(--ink)' }}>{l.item.name}</div>
            <div className="row-sub">
              {l.missing === 'as_needed' ? 'Given as needed, so no monthly estimate'
                : l.missing === 'occasional' ? 'Used now and then, so no monthly estimate'
                : l.missing === 'price' ? <span className="warn-text">No price saved</span>
                : l.missing === 'duration' ? <span className="warn-text">Add how long it lasts</span>
                : lineSub(l)}
            </div>
          </div>
          {l.perMonth != null ? <span className="tabular small" style={{ fontWeight: 700, color: 'var(--ink)' }}>{euro(l.perMonth)}</span>
            : l.missing !== 'as_needed' && l.missing !== 'occasional' && l.item.owner_id === userId ? <Link to={`/stock/${l.item.id}`} className="small" style={{ fontWeight: 700 }}>{l.missing === 'price' ? 'Add price' : 'Edit'}</Link>
            : null}
        </div>
      ))}
    </>
  )

  return (
    <Screen>
      {pet && <BackLink label="Back" />}
      <header className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="title">{pet ? `${pet.name}'s costs` : 'Costs'}</h1>
          <div className="sub">{pet
            ? <button className="link-btn" style={{ padding: 0, minHeight: 0, fontSize: 13 }} onClick={() => setQs({})}>Show all pets</button>
            : 'What you spend, and what stock should cost'}</div>
        </div>
        <button className="icon-btn" aria-label={adding ? 'Close' : 'Add an expense'} onClick={() => setAdding(!adding)}>{adding ? <IconX size={18} /> : <IconPlus size={20} />}</button>
      </header>
      {!pet && <OwnerSwitch />}
      <ErrorNote msg={error} />

      {adding && household && (
        <ExpenseForm householdId={household.id} myPets={pets.filter((p) => p.owner_id === userId)} defaultPet={pet?.owner_id === userId ? pet.id : undefined}
          onSaved={async () => { setAdding(false); await load() }} setError={setError} />
      )}

      <Chips<Period> label="Period" value={period} onChange={setPeriod} scroll options={PERIODS} />

      <section className="card pad stack-sm" aria-label="Summary">
        <div className="small muted" style={{ fontWeight: 600 }}>Spent · {periodLabel.toLowerCase()}</div>
        <div className="tabular" style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 600, lineHeight: 1.1 }}>{euro(total)}</div>
        {oneOffTotal !== 0 && <div className="small muted">incl. {euro(oneOffTotal)} one-off</div>}
        <div className="grid2 cost-facts">
          <div>
            <div className="k">Usually
              <InfoTip label="About the monthly average">The average of the full months you've logged, without one-off purchases (things you don't buy regularly, like a carrier, a bed or treats you don't buy again). Those still count in the totals. Tap a line under Spending to mark it one-off.</InfoTip>
            </div>
            <div className="v tabular">{avg != null ? <>{euro(avg)}<span className="per">/month</span></> : '—'}</div>
            <div className="s">{avg != null ? `over ${fullMonths.length} ${fullMonths.length === 1 ? 'month' : 'months'}` : 'needs a full month logged'}</div>
          </div>
          <div>
            <div className="k">Expected
              <InfoTip label="How the estimate works">From your stock list: each item's price divided by how many days a pack or box lasts, times 30. Kibble shared by several pets is split by how much each one eats; other shared items evenly. With no price saved, the last price you logged is used. As-needed meds and things used now and then aren't counted. Vet bills, insurance and grooming aren't in it; they show under spending once you log them.</InfoTip>
            </div>
            <div className="v tabular">{estTotal > 0 ? <>{approx(estTotal)}<span className="per">/month</span></> : '—'}</div>
            <div className="s">{missingCount ? <span className="warn-text">{missingCount} {missingCount === 1 ? 'item' : 'items'} not counted</span> : 'for stock'}</div>
          </div>
        </div>
      </section>

      <section className="card pad stack-sm" aria-labelledby="mon-h">
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <h2 id="mon-h" className="h">By month</h2>
          <span className="small muted tabular">{shownMonth ? `${shownMonth.label}: ${euro(shownMonth.sum)}` : 'tap a month'}</span>
        </div>
        <div className="sbars-plot dense">
          {estTotal > 0 && (
            <div className="sbars-ref" style={{ bottom: `${(estTotal / maxMonth) * 100}%` }} aria-hidden="true" />
          )}
          {byMonth.map((m, i) => {
            const label = `${m.label}: ${euro(m.sum)}${m.parts.length > 1 || m.oneOff ? ' (' + [...m.parts.map((s) => `${s.name} ${euro(s.sum)}`), ...(m.oneOff ? [`one-off ${euro(m.oneOff)}`] : [])].join(', ') + ')' : ''}`
            return (
              <button key={m.key} type="button" className={'sbars-col' + (picked === m.key ? ' on' : '') + (i === byMonth.length - 1 ? ' now' : '')}
                aria-label={label} title={label} aria-pressed={picked === m.key} onClick={() => setPicked(picked === m.key ? null : m.key)}>
                {m.sum > 0 ? (
                  <span className="sbars-stack" style={{ height: `${(m.sum / maxMonth) * 100}%` }}>
                    {m.parts.map((s) => <span key={s.id} style={{ flexGrow: s.sum, background: s.color }} />)}
                    {m.oneOff > 0 && <span className="one-off" style={{ flexGrow: m.oneOff }} />}
                  </span>
                ) : <span className="sbars-zero" />}
              </button>
            )
          })}
        </div>
        <div className="sbars-x dense" aria-hidden="true">{byMonth.map((m) => <span key={m.key}>{m.label.slice(0, 1)}</span>)}</div>
        {shownMonth && (shownMonth.parts.length > 1 || shownMonth.oneOff > 0) && (
          <div className="small muted">{[...shownMonth.parts.map((s) => `${s.name} ${euro(s.sum)}`), ...(shownMonth.oneOff ? [`one-off ${euro(shownMonth.oneOff)}`] : [])].join(' · ')}</div>
        )}
        {(stackByPet || anyOneOff || estTotal > 0) && (
          <div className="chips" aria-label="Legend" style={{ gap: 10 }}>
            {stackByPet && shownPets.map((p) => <span key={p.id} className="small legend-item"><PetDot color={petColor(p.id)} />{p.name}</span>)}
            {stackByPet && hasHousehold && <span className="small legend-item"><PetDot color={HOUSEHOLD} />Household</span>}
            {anyOneOff && <span className="small legend-item"><span className="one-off-key" aria-hidden="true" />One-off</span>}
            {estTotal > 0 && <span className="small legend-item"><span className="ref-key" aria-hidden="true" />Expected {approx(estTotal)}</span>}
          </div>
        )}
      </section>

      {!pet && (
        <section className="card" aria-labelledby="pp-h">
          <div className="card-head"><h2 id="pp-h" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>By pet
            <InfoTip label="How costs are split">Spent: what you logged in this period. An expense for several pets is split evenly between them; costs with no pet show as “Household”.<br />Expected: what that pet's food, meds and supplies should cost a month. Tap a pet to see it item by item.</InfoTip></h2>
            <span className="small muted">{periodLabel}</span>
          </div>
          {byPet.map((r) => {
            const isOpen = openPet === r.p.id
            const id = 'pet-' + r.p.id
            return (
              <div key={r.p.id} className="est-pet">
                <button type="button" className="est-row" aria-expanded={isOpen} aria-controls={id} onClick={() => setOpenPet(isOpen ? null : r.p.id)}>
                  <Avatar name={r.p.name} size={36} owner={r.p.owner_id === userId ? 'me' : 'other'} src={photoUrl(r.p.photo_path)} color={petColor(r.p.id)} />
                  <div className="grow stack-sm" style={{ gap: 6 }}>
                    <div className="row between" style={{ gap: 8 }}>
                      <span className="row-title">{r.p.name}</span>
                      <span className="tabular" style={{ fontWeight: 700 }}>{euro(r.spent)}</span>
                    </div>
                    <div className="hbar"><div style={{ width: `${r.spent > 0 ? Math.max(2, (r.spent / maxPet) * 100) : 0}%`, background: petColor(r.p.id) }} /></div>
                    <div className="row-sub">
                      {r.sum > 0 ? `Expected ${approx(r.sum)}/month` : 'No stock priced yet'}
                      {r.missing.length > 0 && <span className="warn-text"> · {r.missing.length} not counted</span>}
                    </div>
                  </div>
                  <IconChevron size={16} className={'chev' + (isOpen ? ' open' : '')} />
                </button>
                <Collapse open={isOpen} id={id}>
                  <div className="est-more">
                    {r.byType.length > 0 && <div className="small muted">{r.byType.map((x) => `${TYPE_LABEL[x.t]} ${euro(x.sum)}`).join(' · ')} a month</div>}
                    {itemLines(r.lines)}
                    <div className="row between est-spent">
                      <span className="small muted">Only {r.p.name}: spending, chart and list</span>
                      <button type="button" className="link-btn" style={{ minHeight: 32, padding: 0, flexShrink: 0 }} onClick={() => { setQs({ pet: r.p.id }); setOpenPet(null) }}>Show</button>
                    </div>
                  </div>
                </Collapse>
              </div>
            )
          })}
          {unassigned !== 0 && (
            <div className="card-row">
              <Avatar name="H" size={36} owner="me" color={HOUSEHOLD} />
              <div className="grow stack-sm" style={{ gap: 6 }}>
                <div className="row between"><span className="row-title">Household</span><span className="tabular" style={{ fontWeight: 700 }}>{euro(unassigned)}</span></div>
                <div className="hbar"><div style={{ width: `${Math.max(2, (Math.max(0, unassigned) / maxPet) * 100)}%`, background: HOUSEHOLD }} /></div>
                <div className="row-sub">Costs with no pet</div>
              </div>
            </div>
          )}
        </section>
      )}

      {pet && est[0] && (
        <section className="card" aria-labelledby="pe-h">
          <div className="card-head"><h2 id="pe-h" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Expected<InfoTip label="About the expected cost">What this pet's food, meds and supplies should cost a month: each item's price divided by how many days a pack lasts, times 30.</InfoTip></h2><span className="tabular" style={{ fontWeight: 700 }}>{est[0].sum > 0 ? `${approx(est[0].sum)}/month` : '—'}</span></div>
          <div className="est-more" style={{ paddingLeft: 16 }}>{itemLines(est[0].lines)}</div>
        </section>
      )}

      {byCat.length > 0 && (
        <section className="card" aria-labelledby="cat-h">
          <div className="card-head"><h2 id="cat-h">By type</h2><span className="small muted">{periodLabel}</span></div>
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
          const mine = e.owner_id === userId
          const isOpen = openRow === e.id
          const body = (
            <>
              <div className="row-title">{e.title}{e.quantity && Number(e.quantity) !== 1 ? ` × ${Number(e.quantity)}` : ''}</div>
              <div className="row-sub">{[fmtShort(e.spent_on), categoryLabel(e.category), petNames || 'Household', store, e.one_off ? 'One-off' : null, e.owner_id !== userId ? `${nameOf(e.owner_id)}'s` : null, e.note].filter(Boolean).join(' · ')}</div>
            </>
          )
          return (
            <div key={e.id}>
              <div className="card-row">
                {mine
                  ? <button type="button" className="grow" aria-expanded={isOpen} onClick={() => setOpenRow(isOpen ? null : e.id)}
                      style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left', font: 'inherit', color: 'inherit', minWidth: 0 }}>{body}</button>
                  : <div className="grow">{body}</div>}
                <span className="tabular" style={{ fontWeight: 700 }}>{euro(amountOf(e))}</span>
                {mine && <button className="icon-btn plain" aria-label={`Delete ${e.title}`} disabled={busy} onClick={() => void remove(e)}><IconTrash size={18} /></button>}
              </div>
              {mine && isOpen && (
                <div className="row between" style={{ padding: '0 16px 10px', gap: 8 }}>
                  <div className="label-row"><span id={`oo-${e.id}`} className="small" style={{ fontWeight: 600 }}>One-off purchase</span>
                    <InfoTip label="About one-off purchases">Not part of normal monthly spending, like a carrier, a bed or a toy. It still counts in totals, by pet and by type, but not in the monthly average.</InfoTip>
                  </div>
                  <Toggle on={e.one_off} labelledBy={`oo-${e.id}`} onChange={(v) => void setOneOff(e, v)} />
                </div>
              )}
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
  const [oneOff, setOneOff] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    const a = parseFloat(amount.replace(',', '.'))
    if (!Number.isFinite(a)) { setError('Type the amount, e.g. 45.50'); return }
    setSaving(true); setError(null)
    const { error } = await supabase.from('expenses').insert({
      household_id: householdId, spent_on: date || todayISO(), amount: round2(a), category: cat,
      title: title.trim() || categoryLabel(cat), pet_ids: petIds, note: note.trim() || null, one_off: oneOff
    })
    setSaving(false)
    if (error) { setError(errMsg(error)); return }
    await onSaved()
  }

  return (
    <form className="card pad stack" onSubmit={save}>
      <h2 className="h">Add an expense</h2>
      <Chips<ExpenseCategory> label="Type" value={cat} onChange={setCat} options={CATEGORIES.filter((c) => c.id !== 'shipping')} />
      <div className="field"><label htmlFor="xt">What</label><input id="xt" className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={cat === 'vet' ? 'e.g. Check-up and blood test' : cat === 'insurance' ? 'e.g. Pet insurance, October' : cat === 'grooming' ? 'e.g. Grooming' : cat === 'supply' ? 'e.g. Cat carrier' : cat === 'food' ? 'e.g. Birthday treats' : 'e.g. New bed'} /></div>
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
      <div className="row between">
        <div>
          <div className="label-row"><span id="xo-l" className="label">One-off purchase</span>
            <InfoTip label="About one-off purchases">For things you don't buy regularly, like a carrier, a bed or a toy. It counts in the totals but is left out of the monthly average, so one big month doesn't look like the norm.</InfoTip>
          </div>
          <div className="small muted" style={{ marginTop: 2 }}>{oneOff ? 'Left out of the monthly average' : 'Part of normal monthly spending'}</div>
        </div>
        <Toggle on={oneOff} onChange={setOneOff} labelledBy="xo-l" />
      </div>
      <div className="field"><label htmlFor="xn">Note <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></label><input id="xn" className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></div>
      <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save expense'}</button>
    </form>
  )
}
