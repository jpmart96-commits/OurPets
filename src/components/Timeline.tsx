import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { fmtDate, fmtShort, fmtTime, toISO, todayISO } from '../lib/dates'
import { euro, fmtNum, medChangeText } from '../lib/calc'
import { HEALTH_TAGS, openPetDoc, signPetDocs, tagCounts, tagLabel, uploadNotePhoto } from '../lib/health'
import { categoryLabel } from '../lib/costs'
import type { Appointment, DocumentRow, DoseLog, Expense, HealthNote, MedChange, Pet, StockItem, Vaccination, Weight } from '../lib/types'
import { Chips, FieldLabel, InfoTip } from './ui'
import { IconCalendar, IconCamera, IconDoc, IconPill, IconShield, IconTrash, IconX } from './icons'

type Run = (fn: () => PromiseLike<{ error: unknown }>) => Promise<void>
type Kind = 'note' | 'weight' | 'med' | 'missed' | 'appt' | 'vaccine' | 'doc' | 'cost'
type Filter = 'all' | 'notes' | 'meds' | 'weight' | 'vet'

interface Entry {
  key: string
  at: number
  day: string
  kind: Kind
  title: string
  sub?: string
  tags?: string[]
  photo?: string | null
  docPath?: string
  onDelete?: () => void
}

const FILTER_KINDS: Record<Filter, Kind[] | null> = {
  all: null,
  notes: ['note'],
  meds: ['med', 'missed'],
  weight: ['weight'],
  vet: ['appt', 'vaccine', 'doc', 'cost']
}

const nowLocalInput = () => {
  const d = new Date()
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

/** Everything that happened to a pet, newest first: journal notes, weights, med changes, missed doses, vet visits, vaccines, files and vet costs. */
export function TimelineTab(props: {
  pet: Pet
  mine: boolean
  notes: HealthNote[]
  weights: Weight[]
  changes: MedChange[]
  missed: DoseLog[]
  appts: Appointment[]
  vaccines: Vaccination[]
  docs: DocumentRow[]
  expenses: Expense[]
  items: StockItem[]
  run: Run
  busy: boolean
  setError: (s: string | null) => void
}) {
  const { pet, mine, notes, run, busy, setError } = props
  const [filter, setFilter] = useState<Filter>('all')
  const [shown, setShown] = useState(60)
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)

  const notePhotoKey = notes.map((n) => n.photo_path ?? '').join('|')
  useEffect(() => {
    let off = false
    void signPetDocs(notes.map((n) => n.photo_path ?? '')).then((p) => { if (!off) setPhotos(p) })
    return () => { off = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notePhotoKey])

  const itemName = (id: string) => props.items.find((i) => i.id === id)?.name ?? 'Medication'
  const itemForm = (id: string) => props.items.find((i) => i.id === id)?.form ?? null

  const entries = useMemo(() => {
    const out: Entry[] = []
    const now = Date.now()
    for (const n of notes) {
      const d = new Date(n.noted_at)
      out.push({
        key: 'n' + n.id, at: d.getTime(), day: toISO(d), kind: 'note',
        title: n.tags.length ? n.tags.map(tagLabel).join(' · ') : 'Note',
        sub: [fmtTime(n.noted_at), n.note].filter(Boolean).join(' · '),
        tags: n.tags, photo: n.photo_path,
        onDelete: mine ? () => {
          if (!window.confirm('Delete this note?')) return
          if (n.photo_path) void supabase.storage.from('pet-docs').remove([n.photo_path])
          void run(() => supabase.from('health_notes').delete().eq('id', n.id))
        } : undefined
      })
    }
    const ws = [...props.weights].sort((a, b) => a.measured_on.localeCompare(b.measured_on))
    ws.forEach((w, i) => {
      const prev = ws[i - 1]
      const delta = prev ? Number(w.kg) - Number(prev.kg) : null
      out.push({
        key: 'w' + w.id, at: new Date(w.measured_on + 'T12:00:00').getTime(), day: w.measured_on, kind: 'weight',
        title: `Weighed ${fmtNum(Number(w.kg))} kg`,
        sub: delta != null && Math.abs(delta) >= 0.05 ? `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(2).replace(/0$/, '')} kg since ${fmtShort(prev!.measured_on)}` : undefined
      })
    })
    for (const c of props.changes) {
      const d = new Date(c.changed_at)
      out.push({
        key: 'c' + c.id, at: d.getTime(), day: toISO(d), kind: 'med',
        title: itemName(c.item_id),
        sub: [medChangeText(c, itemForm(c.item_id)), c.reason ? `“${c.reason}”` : null].filter(Boolean).join(' · ')
      })
    }
    for (const l of props.missed) {
      out.push({
        key: 'm' + l.id, at: new Date(`${l.slot_date}T${l.slot_time || '12:00'}`).getTime(), day: l.slot_date, kind: 'missed',
        title: `Missed: ${itemName(l.item_id)}`, sub: l.slot_time ? `Dose at ${l.slot_time}` : undefined
      })
    }
    for (const a of props.appts) {
      const d = new Date(a.starts_at)
      if (d.getTime() > now) continue
      out.push({ key: 'a' + a.id, at: d.getTime(), day: toISO(d), kind: 'appt', title: a.title, sub: [fmtTime(a.starts_at), a.location, a.notes].filter(Boolean).join(' · ') })
    }
    for (const v of props.vaccines) {
      if (!v.given_on) continue
      out.push({ key: 'v' + v.id, at: new Date(v.given_on + 'T11:00:00').getTime(), day: v.given_on, kind: 'vaccine', title: `${v.name} given`, sub: v.next_due ? `Next due ${fmtDate(v.next_due)}` : undefined })
    }
    for (const doc of props.docs) {
      const day = doc.taken_on ?? doc.created_at.slice(0, 10)
      out.push({ key: 'd' + doc.id, at: new Date(day + 'T10:00:00').getTime(), day, kind: 'doc', title: doc.title, sub: 'File · tap to open', docPath: doc.storage_path })
    }
    for (const e of props.expenses) {
      if (!['vet', 'insurance', 'grooming', 'other'].includes(e.category)) continue
      out.push({
        key: 'e' + e.id, at: new Date(e.spent_on + 'T09:00:00').getTime(), day: e.spent_on, kind: 'cost',
        title: e.title, sub: [categoryLabel(e.category), euro(Number(e.amount)) + (e.pet_ids.length > 1 ? ` (shared by ${e.pet_ids.length})` : ''), e.note].filter(Boolean).join(' · ')
      })
    }
    return out.sort((a, b) => b.at - a.at)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, props.weights, props.changes, props.missed, props.appts, props.vaccines, props.docs, props.expenses, props.items, mine])

  const kinds = FILTER_KINDS[filter]
  const visible = kinds ? entries.filter((e) => kinds.includes(e.kind)) : entries
  const days: { day: string; list: Entry[] }[] = []
  for (const e of visible.slice(0, shown)) {
    const last = days[days.length - 1]
    if (last && last.day === e.day) last.list.push(e)
    else days.push({ day: e.day, list: [e] })
  }

  // tag trend: last 30 days vs the 30 before
  const now = new Date()
  const d30 = new Date(now.getTime() - 30 * 86400e3), d60 = new Date(now.getTime() - 60 * 86400e3)
  const recent = tagCounts(notes, d30, new Date(now.getTime() + 60e3))
  const before = tagCounts(notes, d60, d30)
  const trend = HEALTH_TAGS.filter((t) => !t.good && t.id !== 'other' && (recent[t.id] || before[t.id]))

  return (
    <div className="stack">
      {mine && (adding
        ? <NoteForm pet={pet} run={run} busy={busy} setError={setError} onDone={() => setAdding(false)} />
        : <button className="btn block" onClick={() => setAdding(true)}>Add a note</button>)}

      {trend.length > 0 && (
        <section className="card pad stack-sm">
          <div className="row between" style={{ alignItems: 'baseline' }}>
            <h2 className="h" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Last 30 days
              <InfoTip label="About these counts">How many notes had each tag in the last 30 days, and in the 30 days before that. Useful to show the vet whether something is getting better or worse.</InfoTip>
            </h2>
            <span className="small muted">30 days before</span>
          </div>
          {trend.map((t) => {
            const a = recent[t.id] ?? 0, b = before[t.id] ?? 0
            return (
              <div key={t.id} className="row between small">
                <span><strong className="tabular">{a}×</strong> {t.label.toLowerCase()}</span>
                <span className={a > b ? 'warn-text' : 'muted'}>{b}× {a > b ? '↑' : a < b ? '↓' : ''}</span>
              </div>
            )
          })}
        </section>
      )}

      <Chips<Filter> label="Show" value={filter} onChange={(f) => { setFilter(f); setShown(60) }} scroll
        options={[{ id: 'all', label: 'All' }, { id: 'notes', label: 'Notes' }, { id: 'meds', label: 'Meds' }, { id: 'weight', label: 'Weight' }, { id: 'vet', label: 'Vet & files' }]} />

      {visible.length === 0 && (
        <p className="hint">{filter === 'all'
          ? `Nothing yet. Notes, weights, medication changes, vet visits and files for ${pet.name} will line up here by date.`
          : 'Nothing of this kind yet.'}</p>
      )}

      {days.map((g) => (
        <section key={g.day} className="card" aria-label={fmtDate(g.day)}>
          <div className="card-head" style={{ paddingBottom: 8 }}>
            <h2 style={{ fontSize: 14 }}>{g.day === todayISO() ? 'Today' : fmtShort(g.day)}{g.day.slice(0, 4) !== todayISO().slice(0, 4) ? ` ${g.day.slice(0, 4)}` : ''}</h2>
          </div>
          {g.list.map((e) => (
            <div key={e.key} className="card-row" style={{ alignItems: 'flex-start' }}>
              <KindIcon kind={e.kind} good={e.tags?.includes('good')} />
              <div className="grow">
                {e.docPath ? (
                  <button className="link-btn" style={{ padding: 0, minHeight: 0, textAlign: 'left', color: 'var(--ink)' }}
                    onClick={() => void openPetDoc(e.docPath!).then((m) => m && setError(m))}>
                    <span className="row-title">{e.title}</span>
                  </button>
                ) : <div className="row-title">{e.title}</div>}
                {e.sub && <div className="row-sub" style={{ whiteSpace: 'pre-wrap' }}>{e.sub}</div>}
                {e.photo && photos[e.photo] && (
                  <button type="button" onClick={() => void openPetDoc(e.photo!).then((m) => m && setError(m))}
                    style={{ marginTop: 8, padding: 0, border: 0, background: 'transparent', display: 'block' }} aria-label="Open photo">
                    <img src={photos[e.photo]} alt="" style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
                  </button>
                )}
              </div>
              {e.onDelete && <button className="icon-btn plain" aria-label="Delete note" disabled={busy} onClick={e.onDelete}><IconTrash size={18} /></button>}
            </div>
          ))}
        </section>
      ))}
      {visible.length > shown && <button className="btn ghost block" onClick={() => setShown(shown + 60)}>Show older</button>}
    </div>
  )
}

function KindIcon({ kind, good }: { kind: Kind; good?: boolean }) {
  const warn = { background: 'var(--warn-soft)', color: 'var(--warn)' }
  const style = kind === 'missed' || (kind === 'note' && !good) ? warn : undefined
  const icon = kind === 'med' || kind === 'missed' ? <IconPill size={18} />
    : kind === 'appt' ? <IconCalendar size={18} />
    : kind === 'vaccine' ? <IconShield size={18} />
    : kind === 'doc' ? <IconDoc size={18} />
    : kind === 'weight' ? <span style={{ fontSize: 11, fontWeight: 800 }}>kg</span>
    : kind === 'cost' ? <span style={{ fontSize: 14, fontWeight: 800 }}>€</span>
    : <span style={{ fontSize: 15, fontWeight: 800 }}>{good ? '✓' : '!'}</span>
  return <div className={'icon-tile' + (style ? '' : ' soft')} style={style} aria-hidden="true">{icon}</div>
}

function NoteForm({ pet, run, busy, setError, onDone }: { pet: Pet; run: Run; busy: boolean; setError: (s: string | null) => void; onDone: () => void }) {
  const [tags, setTags] = useState<string[]>([])
  const [text, setText] = useState('')
  const [when, setWhen] = useState(nowLocalInput())
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!file) { setPreview(undefined); return }
    const u = URL.createObjectURL(file)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  const toggle = (id: string) => setTags(tags.includes(id) ? tags.filter((t) => t !== id) : [...tags, id])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!tags.length && !text.trim() && !file) { setError('Tap a tag, write something or add a photo.'); return }
    setSaving(true); setError(null)
    let photo_path: string | null = null
    try {
      if (file) photo_path = await uploadNotePhoto(pet.id, file)
    } catch (err) { setError('Photo upload failed: ' + errMsg(err)); setSaving(false); return }
    const at = when ? new Date(when) : new Date()
    await run(() => supabase.from('health_notes').insert({
      pet_id: pet.id, tags, note: text.trim() || null, photo_path,
      noted_at: (at.getTime() > Date.now() ? new Date() : at).toISOString()
    }))
    setSaving(false)
    onDone()
  }

  return (
    <form className="card pad stack" onSubmit={save}>
      <div className="row between">
        <h2 className="h">How is {pet.name}?</h2>
        <button type="button" className="icon-btn plain" aria-label="Close" onClick={onDone}><IconX size={16} /></button>
      </div>
      <div className="field">
        <FieldLabel as="span" tip="Tap everything that applies. Tags are counted over time, so you can see at a glance whether something happens more often (for example vomiting twice this month and five times last month).">What happened</FieldLabel>
        <div className="chips" role="group" aria-label="What happened">
          {HEALTH_TAGS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tags.includes(t.id)} className={'chip' + (tags.includes(t.id) ? ' on' : '')} onClick={() => toggle(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="nt">Note <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></label>
        <textarea id="nt" className="input" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Vomited after breakfast, seems fine now" style={{ padding: 12, minHeight: 84, resize: 'vertical' }} />
      </div>
      <div className="stack-sm" style={{ gap: 12 }}>
        <div className="field">
          <FieldLabel htmlFor="nw" tip="Defaults to now. Change it if you're writing this down later.">When</FieldLabel>
          <input id="nw" className="input" type="datetime-local" value={when} max={nowLocalInput()} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <label htmlFor="np" className="btn ghost" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
          {preview ? <img src={preview} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 6 }} /> : <IconCamera size={18} />}
          {file ? 'Change photo' : 'Add photo'}
        </label>
        <input id="np" type="file" accept="image/*" className="visually-hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
      </div>
      <button className="btn" type="submit" disabled={busy || saving}>{saving ? 'Saving…' : 'Save note'}</button>
    </form>
  )
}
