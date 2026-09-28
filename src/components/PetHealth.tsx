import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { daysBetween, fmtDate, parseISO, toISO, todayISO } from '../lib/dates'
import type { Pet, Vaccination } from '../lib/types'
import { Chips } from './ui'
import { IconAlert, IconPhone, IconPlus, IconShield, IconTrash } from './icons'

type Run = (fn: () => PromiseLike<{ error: unknown }>) => Promise<void>

const telHref = (n: string) => 'tel:' + n.replace(/[^\d+]/g, '')
const mapsHref = (a: string) => 'https://maps.google.com/?q=' + encodeURIComponent(a)

/** Everything you need in a hurry: vet and emergency vet (tap to call), allergies, conditions, chip, insurance. */
export function EmergencyCard({ pet, mine }: { pet: Pet; mine: boolean }) {
  const has = pet.vet_phone || pet.er_vet_phone || pet.allergies || pet.conditions || pet.insurance || pet.vet_address
  if (!has) {
    return mine ? (
      <Link to={`/pets/${pet.id}/edit`} className="card pad row" style={{ textDecoration: 'none', color: 'inherit', borderStyle: 'dashed' }}>
        <div className="icon-tile" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}><IconAlert size={19} /></div>
        <div className="grow"><div className="row-title">Add emergency info</div><div className="row-sub">Vet phone, 24-hour vet, allergies and insurance, all one tap away.</div></div>
      </Link>
    ) : null
  }
  return (
    <section className="card" aria-labelledby="em-h" style={{ borderColor: '#EBC9B4' }}>
      <div className="card-head" style={{ background: 'var(--warn-soft)', paddingBottom: 12 }}>
        <h2 id="em-h" style={{ color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 8 }}><IconAlert size={18} />Emergency</h2>
        {mine && <Link to={`/pets/${pet.id}/edit`} className="small">Edit</Link>}
      </div>
      {(pet.vet_phone || pet.vet_name) && (
        <div className="card-row">
          <div className="grow">
            <div className="row-title">{pet.vet_name || 'Vet'}</div>
            {pet.vet_address && <a className="row-sub" href={mapsHref(pet.vet_address)} target="_blank" rel="noopener" style={{ display: 'block' }}>{pet.vet_address}</a>}
          </div>
          {pet.vet_phone && <a className="btn small" href={telHref(pet.vet_phone)} aria-label={`Call ${pet.vet_name || 'the vet'}`}><IconPhone size={16} />Call</a>}
        </div>
      )}
      {pet.er_vet_phone && (
        <div className="card-row">
          <div className="grow"><div className="row-title">{pet.er_vet_name || '24-hour emergency vet'}</div><div className="row-sub">Out of hours</div></div>
          <a className="btn small" style={{ background: 'var(--warn)' }} href={telHref(pet.er_vet_phone)} aria-label={`Call ${pet.er_vet_name || 'the emergency vet'}`}><IconPhone size={16} />Call</a>
        </div>
      )}
      {(pet.allergies || pet.conditions) && (
        <div className="card-row" style={{ alignItems: 'flex-start' }}>
          <div className="grow stack-sm" style={{ gap: 4 }}>
            {pet.allergies && <div className="small"><strong>Allergies:</strong> {pet.allergies}</div>}
            {pet.conditions && <div className="small"><strong>Conditions:</strong> {pet.conditions}</div>}
          </div>
        </div>
      )}
      {(pet.microchip || pet.insurance) && (
        <div className="card-row" style={{ alignItems: 'flex-start' }}>
          <div className="grow stack-sm" style={{ gap: 4 }}>
            {pet.microchip && <div className="small tabular"><strong>Microchip:</strong> {pet.microchip}</div>}
            {pet.insurance && <div className="small"><strong>Insurance:</strong> {pet.insurance}</div>}
          </div>
        </div>
      )}
    </section>
  )
}

const PRESETS: Record<string, { name: string; months: number }[]> = {
  dog: [
    { name: 'Rabies', months: 12 }, { name: 'DHPPi (polyvalent)', months: 12 }, { name: 'Leptospirosis', months: 12 },
    { name: 'Kennel cough', months: 12 }, { name: 'Leishmaniasis', months: 12 }, { name: 'Deworming', months: 3 }
  ],
  cat: [
    { name: 'Rabies', months: 12 }, { name: 'Trivalent (RCP)', months: 12 }, { name: 'FeLV', months: 12 }, { name: 'Deworming', months: 3 }
  ],
  other: [{ name: 'Vaccine', months: 12 }, { name: 'Deworming', months: 3 }]
}

function addMonths(iso: string, months: number): string {
  const d = parseISO(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  return toISO(d)
}

export function dueLabel(next: string | null): { text: string; tone: 'warn' | 'soon' | 'ok' } {
  if (!next) return { text: 'No date', tone: 'ok' }
  const n = daysBetween(todayISO(), next)
  if (n < 0) return { text: `Overdue ${-n} d`, tone: 'warn' }
  if (n === 0) return { text: 'Due today', tone: 'warn' }
  if (n <= 30) return { text: `In ${n} days`, tone: 'soon' }
  return { text: fmtDate(next), tone: 'ok' }
}

/** Vaccinations and other recurring treatments: last given, next due, one-tap "done today". */
export function VaccinesCard({ pet, mine, vaccines, run, busy }: { pet: Pet; mine: boolean; vaccines: Vaccination[]; run: Run; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [months, setMonths] = useState('12')
  const [given, setGiven] = useState(todayISO())
  const [next, setNext] = useState('')
  const presets = PRESETS[pet.species] ?? PRESETS.other
  const list = [...vaccines].sort((a, b) => (a.next_due ?? '9999').localeCompare(b.next_due ?? '9999'))

  async function add(e: FormEvent) {
    e.preventDefault()
    const m = parseInt(months, 10)
    const nextDue = next || (given && m ? addMonths(given, m) : null)
    await run(() => supabase.from('vaccinations').insert({
      pet_id: pet.id, name: name.trim() || 'Vaccine', given_on: given || null, next_due: nextDue, interval_months: Number.isFinite(m) ? m : null
    }))
    setOpen(false); setName(''); setNext('')
  }

  function doneToday(v: Vaccination) {
    const t = todayISO()
    return run(() => supabase.from('vaccinations').update({ given_on: t, next_due: v.interval_months ? addMonths(t, v.interval_months) : null }).eq('id', v.id))
  }

  return (
    <section className="card" aria-labelledby="vx-h">
      <div className="card-head" style={{ alignItems: 'center', paddingBottom: 6 }}>
        <h2 id="vx-h" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconShield size={18} />Vaccines &amp; treatments</h2>
        {mine && <button className="icon-btn plain" aria-label="Add vaccine or treatment" onClick={() => setOpen(!open)}><IconPlus size={20} /></button>}
      </div>
      {open && (
        <form className="card-foot" onSubmit={add} style={{ borderTop: '1px solid var(--line-2)' }}>
          <Chips<string> label="Common" value={name} onChange={(v) => { setName(v); const p = presets.find((x) => x.name === v); if (p) setMonths(String(p.months)) }}
            options={presets.map((p) => ({ id: p.name, label: p.name }))} />
          <div className="field"><label htmlFor="vn">Name</label><input id="vn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rabies" required /></div>
          <div className="field"><label htmlFor="vg">Last given</label><input id="vg" className="input" type="date" max={todayISO()} value={given} onChange={(e) => setGiven(e.target.value)} /></div>
          <div className="row">
            <label htmlFor="vm" className="grow" style={{ fontSize: 14 }}>Repeat every (months)</label>
            <input id="vm" className="input num" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="vd">Next due <span className="muted" style={{ fontWeight: 500 }}>(optional, worked out from the above)</span></label>
            <input id="vd" className="input" type="date" value={next} onChange={(e) => setNext(e.target.value)} />
            {!next && given && parseInt(months, 10) > 0 && <div className="hint">Next due {fmtDate(addMonths(given, parseInt(months, 10)))}</div>}
          </div>
          <button className="btn" type="submit" disabled={busy}>Save</button>
        </form>
      )}
      {list.length === 0 && !open && <div className="card-row"><span className="hint">None yet. {mine ? 'Add rabies, boosters or deworming to get reminded before they are due.' : ''}</span></div>}
      {list.map((v) => {
        const due = dueLabel(v.next_due)
        return (
          <div key={v.id} className="card-row" style={{ flexWrap: 'wrap' }}>
            <div className="grow">
              <div className="row-title">{v.name}</div>
              <div className="row-sub">{v.given_on ? `Last ${fmtDate(v.given_on)}` : 'Not recorded'}{v.interval_months ? ` · every ${v.interval_months} mo` : ''}</div>
            </div>
            <span className={'badge ' + (due.tone === 'warn' ? 'warn' : due.tone === 'soon' ? '' : 'grey')}>{due.text}</span>
            {mine && (
              <div className="row" style={{ gap: 6, width: '100%', justifyContent: 'flex-end' }}>
                <button className="btn ghost small" disabled={busy} onClick={() => void doneToday(v)}>Done today</button>
                <button className="icon-btn plain" aria-label={`Delete ${v.name}`} disabled={busy}
                  onClick={() => { if (window.confirm(`Delete ${v.name}?`)) void run(() => supabase.from('vaccinations').delete().eq('id', v.id)) }}><IconTrash size={18} /></button>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

