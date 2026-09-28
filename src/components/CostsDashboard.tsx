import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg } from '../lib/supabase'
import { euro } from '../lib/calc'
import { fmtShort, todayISO } from '../lib/dates'
import { lastMonths, lastPaid, monthlyLines, petShare, round2, type EstimateLine } from '../lib/costs'
import type { Expense, ItemType, Pet } from '../lib/types'
import { Avatar, Collapse, ErrorNote, InfoTip, ItemThumb, OwnerSwitch, PetDot } from './ui'
import { IconChevron } from './icons'

const TYPE_LABEL: Record<ItemType, string> = { food: 'Food', med: 'Meds', supply: 'Supplies' }
const HOUSEHOLD = 'var(--muted-2)'

interface PetRow {
  p: Pet
  lines: EstimateLine[]
  est: number
  byType: { t: ItemType; sum: number }[]
  missing: EstimateLine[]
  spentMonth: number
  spent12: number
}

function shareText(share: number): string {
  if (share >= 0.999) return ''
  if (Math.abs(share - 0.5) < 0.01) return 'half'
  if (Math.abs(share - 1 / 3) < 0.01) return 'a third'
  return `${Math.round(share * 100)}%`
}

function lineSub(l: EstimateLine): string {
  const it = l.item
  const pack = it.type === 'med' ? 'box' : it.type === 'food' && it.track_by !== 'units' ? 'bag' : 'pack'
  const parts: string[] = []
  if (l.fromLastPaid) parts.push(`last paid ${euro(l.fromLastPaid.amount)} a ${pack} (${fmtShort(l.fromLastPaid.on)})`)
  else if (l.unitPrice != null) parts.push(`${euro(l.unitPrice)} a ${pack}`)
  if (l.packDays) parts.push(`lasts ~${l.packDays} days`)
  const sh = shareText(l.share)
  if (sh) parts.push(`${sh} of it (shared)`)
  return parts.join(' · ')
}

export function CostsDashboard() {
  const { pets, items, showOwner, petColor, photoUrl, userId } = useApp()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const year = useMemo(() => lastMonths(12), [])
  const months = year.slice(-6)
  useEffect(() => {
    void supabase.from('expenses').select('*').gte('spent_on', year[0].from).then(({ data, error }) => {
      if (error) setError(errMsg(error))
      setExpenses((data ?? []) as Expense[])
    })
  }, [year])

  const monthKey = todayISO().slice(0, 7)
  const shownItems = items.filter((it) => showOwner(it.owner_id))
  const shownPets = pets.filter((p) => showOwner(p.owner_id) && !p.archived)
  const scoped = expenses.filter((e) => showOwner(e.owner_id))

  const paid = useMemo(() => lastPaid(expenses), [expenses])
  const rows: PetRow[] = shownPets.map((p) => {
    const lines = monthlyLines(shownItems, p.id, paid)
    const est = round2(lines.reduce((s, l) => s + (l.perMonth ?? 0), 0))
    const byType = (['food', 'med', 'supply'] as ItemType[])
      .map((t) => ({ t, sum: round2(lines.filter((l) => l.item.type === t).reduce((s, l) => s + (l.perMonth ?? 0), 0)) }))
      .filter((x) => x.sum > 0)
    const mine = scoped.filter((e) => e.pet_ids.includes(p.id))
    return {
      p, lines, est, byType,
      missing: lines.filter((l) => l.missing === 'price' || l.missing === 'duration'),
      spentMonth: round2(mine.filter((e) => e.spent_on.startsWith(monthKey)).reduce((s, e) => s + petShare(e, p.id), 0)),
      spent12: round2(mine.reduce((s, e) => s + petShare(e, p.id), 0))
    }
  })
  const estTotal = round2(rows.reduce((s, r) => s + r.est, 0))
  const missingCount = rows.reduce((s, r) => s + r.missing.length, 0)
  const maxEst = Math.max(1, ...rows.map((r) => r.est))

  const spentMonth = round2(scoped.filter((e) => e.spent_on.startsWith(monthKey)).reduce((s, e) => s + Number(e.amount), 0))
  const spent12 = round2(scoped.reduce((s, e) => s + Number(e.amount), 0))
  const fullMonths = year.slice(0, -1)
    .map((m) => scoped.filter((e) => e.spent_on >= m.from && e.spent_on < m.to).reduce((s, e) => s + Number(e.amount), 0))
    .filter((v) => v !== 0)
  const avg = fullMonths.length ? round2(fullMonths.reduce((a, b) => a + b, 0) / fullMonths.length) : null

  // spending by month, stacked by pet (household = costs with no pet)
  const stacks = months.map((m) => {
    const inM = scoped.filter((e) => e.spent_on >= m.from && e.spent_on < m.to)
    const parts = rows.map((r) => ({ id: r.p.id, name: r.p.name, color: petColor(r.p.id), sum: round2(inM.reduce((s, e) => s + petShare(e, r.p.id), 0)) }))
    const house = round2(inM.filter((e) => !e.pet_ids.length).reduce((s, e) => s + Number(e.amount), 0))
    if (house) parts.push({ id: 'house', name: 'Household', color: HOUSEHOLD, sum: house })
    const segs = parts.filter((x) => x.sum > 0)
    return { ...m, segs, total: round2(segs.reduce((s, x) => s + x.sum, 0)) }
  })
  const hasHousehold = stacks.some((m) => m.segs.some((s) => s.id === 'house'))
  const anySpend = stacks.some((m) => m.total > 0)
  const maxBar = Math.max(1, estTotal, ...stacks.map((m) => m.total))
  const shown = picked ? stacks.find((m) => m.key === picked) : undefined

  if (!shownPets.length) return <div className="hint">Add a pet first.</div>

  return (
    <>
      <OwnerSwitch />
      <ErrorNote msg={error} />

      <div className="grid2">
        <div className="stat hero">
          <div className="k" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Estimate / month
            <InfoTip label="How the estimate works">From your stock list: each item's price divided by how many days a pack or box lasts, times 30. Kibble shared by several pets is split by how much each one eats; other shared items are split evenly. With no price saved, the last price you logged for it is used. Items with neither, and as-needed meds, aren't counted.</InfoTip>
          </div>
          <div className="v tabular">{euro(estTotal)}</div>
          <div className="s">{missingCount ? `${missingCount} ${missingCount === 1 ? 'item' : 'items'} not counted yet` : 'food, meds and supplies'}</div>
        </div>
        <div className="stat">
          <div className="k">Spent this month</div>
          <div className="v tabular">{euro(spentMonth)}</div>
          <div className="s">{estTotal > 0 ? `${Math.round((spentMonth / estTotal) * 100)}% of the estimate` : 'from what you log'}</div>
        </div>
        <div className="stat">
          <div className="k">Monthly average</div>
          <div className="v tabular">{avg != null ? euro(avg) : '—'}</div>
          <div className="s">{avg != null ? `over ${fullMonths.length} ${fullMonths.length === 1 ? 'month' : 'months'} logged` : 'needs a full month logged'}</div>
        </div>
        <div className="stat">
          <div className="k">Last 12 months</div>
          <div className="v tabular">{euro(spent12)}</div>
          <div className="s">everything logged</div>
        </div>
      </div>

      <section className="card" aria-labelledby="est-h">
        <div className="card-head"><h2 id="est-h">Monthly estimate by pet</h2></div>
        {rows.map((r) => {
          const isOpen = open === r.p.id
          const id = 'est-' + r.p.id
          return (
            <div key={r.p.id} className="est-pet">
              <button type="button" className="est-row" aria-expanded={isOpen} aria-controls={id} onClick={() => setOpen(isOpen ? null : r.p.id)}>
                <Avatar name={r.p.name} size={36} owner={r.p.owner_id === userId ? 'me' : 'other'} src={photoUrl(r.p.photo_path)} color={petColor(r.p.id)} />
                <div className="grow stack-sm" style={{ gap: 6 }}>
                  <div className="row between" style={{ gap: 8 }}>
                    <span className="row-title">{r.p.name}</span>
                    <span className="tabular" style={{ fontWeight: 700 }}>{euro(r.est)}<span className="small muted" style={{ fontWeight: 500 }}>/mo</span></span>
                  </div>
                  <div className="hbar"><div style={{ width: `${r.est > 0 ? Math.max(2, (r.est / maxEst) * 100) : 0}%`, background: petColor(r.p.id) }} /></div>
                  <div className="row-sub">
                    {r.byType.length ? r.byType.map((x) => `${TYPE_LABEL[x.t]} ${euro(x.sum)}`).join(' · ') : 'Nothing priced yet'}
                    {r.missing.length > 0 && <span className="warn-text"> · {r.missing.length} not counted</span>}
                  </div>
                </div>
                <IconChevron size={16} className={'chev' + (isOpen ? ' open' : '')} />
              </button>
              <Collapse open={isOpen} id={id}>
                <div className="est-more">
                  {r.lines.length === 0 && <div className="hint">No stock items for {r.p.name} yet.</div>}
                  {r.lines.map((l) => (
                    <div key={l.item.id} className="row" style={{ gap: 10, alignItems: 'center' }}>
                      <ItemThumb type={l.item.type} src={photoUrl(l.item.photo_path)} size={32} />
                      <div className="grow">
                        <div className="small" style={{ fontWeight: 600, color: 'var(--ink)' }}>{l.item.name}</div>
                        <div className="row-sub">
                          {l.missing === 'as_needed' ? 'Given as needed, so no monthly estimate'
                            : l.missing === 'price' ? <span className="warn-text">No price saved</span>
                            : l.missing === 'duration' ? <span className="warn-text">Add how long it lasts</span>
                            : lineSub(l)}
                        </div>
                      </div>
                      {l.perMonth != null ? <span className="tabular small" style={{ fontWeight: 700, color: 'var(--ink)' }}>{euro(l.perMonth)}</span>
                        : l.missing !== 'as_needed' && l.item.owner_id === userId ? <Link to={`/stock/${l.item.id}`} className="small" style={{ fontWeight: 700 }}>{l.missing === 'price' ? 'Add price' : 'Edit'}</Link>
                        : null}
                    </div>
                  ))}
                  <div className="row between est-spent">
                    <span className="small muted">Spent {euro(r.spentMonth)} this month · {euro(r.spent12)} in 12 months</span>
                    <Link to={`/costs?pet=${r.p.id}`} className="small" style={{ fontWeight: 700, flexShrink: 0 }}>All costs</Link>
                  </div>
                </div>
              </Collapse>
            </div>
          )
        })}
      </section>

      <section className="card pad stack-sm" aria-labelledby="sp-h">
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <h2 id="sp-h" className="h">Spent by month</h2>
          <span className="small muted tabular">{shown ? `${shown.label}: ${euro(shown.total)}` : 'tap a month'}</span>
        </div>
        <div className="sbars-plot">
          {estTotal > 0 && (
            <div className="sbars-ref" style={{ bottom: `${(estTotal / maxBar) * 100}%` }} aria-hidden="true">
              <span>Estimate {euro(estTotal)}</span>
            </div>
          )}
          {stacks.map((m, i) => {
            const label = `${m.label}: ${euro(m.total)}${m.segs.length ? ' (' + m.segs.map((s) => `${s.name} ${euro(s.sum)}`).join(', ') + ')' : ''}`
            return (
              <button key={m.key} type="button" className={'sbars-col' + (picked === m.key ? ' on' : '') + (i === stacks.length - 1 ? ' now' : '')}
                aria-label={label} title={label} aria-pressed={picked === m.key} onClick={() => setPicked(picked === m.key ? null : m.key)}>
                {m.total > 0 ? (
                  <span className="sbars-stack" style={{ height: `${(m.total / maxBar) * 100}%` }}>
                    {m.segs.map((s) => <span key={s.id} style={{ flexGrow: s.sum, background: s.color }} />)}
                  </span>
                ) : <span className="sbars-zero" />}
              </button>
            )
          })}
        </div>
        <div className="sbars-x" aria-hidden="true">{stacks.map((m) => <span key={m.key}>{m.label}</span>)}</div>
        {shown && shown.segs.length > 0 && (
          <div className="small muted">{shown.segs.map((s) => `${s.name} ${euro(s.sum)}`).join(' · ')}</div>
        )}
        <div className="chips" aria-label="Legend" style={{ gap: 10 }}>
          {rows.map((r) => <span key={r.p.id} className="small legend-item"><PetDot color={petColor(r.p.id)} />{r.p.name}</span>)}
          {hasHousehold && <span className="small legend-item"><PetDot color={HOUSEHOLD} />Household</span>}
        </div>
        {!anySpend && <div className="hint">Nothing logged yet. Spending comes from “I placed the order” in Shop, “Log a purchase” on a stock item, and vet bills you add in Costs.</div>}
      </section>

      <Link to="/costs" className="btn ghost block">All spending · add a vet bill or other cost</Link>
      <p className="hint" style={{ margin: '0 4px' }}>Estimates cover stock only (food, meds, supplies). Vet visits, insurance and grooming show under spending once you log them.</p>
    </>
  )
}
