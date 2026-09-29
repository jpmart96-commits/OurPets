import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { fmtDateTime, fmtShort, toISO } from '../lib/dates'
import { euro, fmtNum } from '../lib/calc'
import { notePreview } from '../lib/visits'
import type { Appointment, DocumentRow, Expense, Pet, Weight } from '../lib/types'
import { InfoTip } from './ui'
import { IconPlus } from './icons'

/** Highlight every match of `q` (case-insensitive) in `text`. */
function highlight(text: string, q: string): ReactNode {
  if (!q) return text
  const out: ReactNode[] = []
  const low = text.toLowerCase(), ql = q.toLowerCase()
  let i = 0, k = 0
  for (;;) {
    const j = low.indexOf(ql, i)
    if (j < 0) break
    if (j > i) out.push(text.slice(i, j))
    out.push(<mark key={k++} className="hit">{text.slice(j, j + q.length)}</mark>)
    i = j + q.length
  }
  out.push(text.slice(i))
  return out
}

/** Around a search hit, so the match is visible in the preview. */
function excerpt(notes: string, q: string): string {
  const j = notes.toLowerCase().indexOf(q.toLowerCase())
  if (j < 160) return notePreview(notes, 260)
  const start = notes.lastIndexOf(' ', j - 60)
  return '…' + notePreview(notes.slice(start > 0 ? start + 1 : j - 60), 240)
}

export function VisitRow({ a, petId, mine, docs = 0, weight, cost, followUp, q = '', compact }: {
  a: Appointment; petId: string; mine: boolean; docs?: number; weight?: Weight; cost?: Expense; followUp?: Appointment; q?: string; compact?: boolean
}) {
  const d = new Date(a.starts_at)
  const past = d.getTime() <= Date.now()
  const hasFacts = docs > 0 || weight || cost || followUp
  return (
    <Link to={`/pets/${petId}/visits/${a.id}`} className="visit-card">
      <div className="date-tile">
        <div className="m" style={past ? { color: 'var(--muted-2)' } : undefined}>{d.toLocaleString('en', { month: 'short' })}</div>
        <div className="d">{d.getDate()}</div>
      </div>
      <div className="grow">
        <div className="row-title">{highlight(a.title, q)}</div>
        <div className="row-sub">{d.getFullYear() !== new Date().getFullYear() ? fmtDateTime(a.starts_at).replace(' · ', ` ${d.getFullYear()} · `) : fmtDateTime(a.starts_at)}{a.location ? ` · ${a.location}` : ''}</div>
        {a.notes
          ? <div className={'visit-preview' + (compact ? ' clamp-2' : ' clamp-6')}>{highlight(q ? excerpt(a.notes, q) : notePreview(a.notes, compact ? 220 : 420), q)}</div>
          : mine && <div className="add-notes">{past ? 'Add notes' : 'Add questions for the vet'}</div>}
        {hasFacts && !compact && (
          <div className="visit-facts">
            {docs > 0 && <span className="badge">{docs} {docs === 1 ? 'file' : 'files'}</span>}
            {weight && <span className="badge tabular">{fmtNum(Number(weight.kg))} kg</span>}
            {cost && <span className="badge tabular">{euro(Number(cost.amount))}</span>}
            {followUp && <span className="badge good">Back {fmtShort(toISO(new Date(followUp.starts_at)))}</span>}
          </div>
        )}
      </div>
    </Link>
  )
}

/** The pet's vet visit log: booked visits first, then past visits newest first, searchable. */
export function VisitsTab({ pet, mine, appts, docs, weights, costs }: {
  pet: Pet; mine: boolean; appts: Appointment[]; docs: DocumentRow[]; weights: Weight[]; costs: Expense[]
}) {
  const [q, setQ] = useState('')
  const now = Date.now()
  const booked = appts.filter((a) => new Date(a.starts_at).getTime() > now)
  const past = appts.filter((a) => new Date(a.starts_at).getTime() <= now).reverse()
  const ql = q.trim().toLowerCase()
  const match = (a: Appointment) => !ql || [a.title, a.location ?? '', a.notes ?? ''].some((t) => t.toLowerCase().includes(ql))
  const shownPast = past.filter(match)
  const shownBooked = booked.filter(match)
  const withNotes = past.filter((a) => a.notes).length

  const facts = (a: Appointment) => ({
    docs: docs.filter((d) => d.appointment_id === a.id).length,
    weight: weights.find((w) => w.appointment_id === a.id),
    cost: costs.find((e) => e.appointment_id === a.id),
    followUp: appts.find((f) => f.follow_up_of === a.id)
  })

  return (
    <div className="stack">
      {mine && <Link to={`/pets/${pet.id}/visits/new`} className="btn block"><IconPlus size={18} />Log a visit</Link>}

      {past.length + booked.length > 3 && (
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes, e.g. kidney, dose, Dr. Silva" aria-label="Search visits" />
      )}

      {shownBooked.length > 0 && (
        <section className="card" aria-labelledby="vb-h">
          <div className="card-head" style={{ paddingBottom: 4 }}>
            <h2 id="vb-h" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Booked
              <InfoTip label="About booked visits">Upcoming appointments. Open one to jot down what to ask the vet; after the visit, add what they said in the same place.</InfoTip>
            </h2>
          </div>
          {shownBooked.map((a) => <VisitRow key={a.id} a={a} petId={pet.id} mine={mine} q={ql ? q.trim() : ''} compact />)}
        </section>
      )}

      {shownPast.length > 0 && (
        <section className="card" aria-labelledby="vp-h">
          <div className="card-head" style={{ paddingBottom: 4 }}>
            <h2 id="vp-h">Past visits</h2>
            <span className="small muted">{ql ? `${shownPast.length} found` : `${past.length} · ${withNotes} with notes`}</span>
          </div>
          {shownPast.map((a) => <VisitRow key={a.id} a={a} petId={pet.id} mine={mine} q={ql ? q.trim() : ''} {...facts(a)} />)}
        </section>
      )}

      {ql && !shownPast.length && !shownBooked.length && <p className="hint">No visit mentions “{q.trim()}”.</p>}
      {!appts.length && (
        <p className="hint">No vet visits yet. {mine ? `After a visit, log what the vet said, the documents they gave you, ${pet.name}'s weight and the cost, all in one place.` : ''}</p>
      )}
    </div>
  )
}
