import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg } from '../lib/supabase'
import { addDays, ageText, fmtDate, fmtDateTime, fmtShort, fmtTime, parseISO, todayISO } from '../lib/dates'
import { daysText, fmtNum, isDueOn, itemInfo, medStart, medTimes, scheduleText, unitFor } from '../lib/calc'
import { cycleDose, logAsNeeded, refill, slotState } from '../lib/actions'
import type { Appointment, DocumentRow, DoseLog, StockItem, Weight } from '../lib/types'
import { Avatar, BackLink, Bar, ErrorNote, ItemThumb, Loading, Screen, Segmented } from '../components/ui'
import { IconCheck, IconDoc, IconPlus, IconTrash, IconX } from '../components/icons'
import WeightChart from '../components/WeightChart'
import { EmergencyCard, VaccinesCard } from '../components/PetHealth'

type Tab = 'overview' | 'meds' | 'weight' | 'records'
const SPECIES: Record<string, string> = { dog: 'Dog', cat: 'Cat', other: 'Pet' }

export default function PetDetail() {
  const { id = '' } = useParams()
  const app = useApp()
  const { petById, userId, items, logs, shared, nameOf, reload, photoUrl } = app
  const pet = petById(id)
  const mine = pet?.owner_id === userId
  const [tab, setTab] = useState<Tab>('overview')
  const [weights, setWeights] = useState<Weight[]>([])
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [appts, setAppts] = useState<Appointment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const [w, d, a] = await Promise.all([
      supabase.from('weights').select('*').eq('pet_id', id).order('measured_on'),
      supabase.from('documents').select('*').eq('pet_id', id).order('created_at', { ascending: false }),
      supabase.from('appointments').select('*').eq('pet_id', id).order('starts_at')
    ])
    const e = w.error || d.error || a.error
    if (e) setError(errMsg(e))
    setWeights((w.data ?? []) as Weight[])
    setDocs((d.data ?? []) as DocumentRow[])
    setAppts((a.data ?? []) as Appointment[])
  }, [id])

  useEffect(() => { void load() }, [load])

  const petItems = useMemo(() => items.filter((it) => it.stock_item_pets.some((p) => p.pet_id === id)), [items, id])
  const meds = petItems.filter((it) => it.type === 'med')

  if (!pet) return app.loading ? <Loading /> : <Screen><BackLink to="/pets" label="Pets" /><p className="note">This pet isn't here any more.</p></Screen>

  const latest = weights[weights.length - 1]
  const sixMonthsAgo = addDays(todayISO(), -183)
  const baseline = weights.find((w) => w.measured_on >= sixMonthsAgo)
  const delta = latest && baseline && baseline.id !== latest.id ? latest.kg - baseline.kg : null
  const upcoming = appts.filter((a) => new Date(a.starts_at) >= new Date())
  const past = appts.filter((a) => new Date(a.starts_at) < new Date()).reverse().slice(0, 3)
  const run = async (fn: () => PromiseLike<{ error: unknown }>) => {
    setBusy(true); setError(null)
    const r = await fn()
    if (r.error) setError(errMsg(r.error))
    await Promise.all([reload(), load()])
    setBusy(false)
  }

  return (
    <Screen>
      <BackLink to="/pets" label="Pets" />
      <header className="row" style={{ gap: 16 }}>
        <Avatar name={pet.name} size={72} owner={mine ? 'me' : 'other'} src={photoUrl(pet.photo_path)} />
        <div className="grow">
          <h1 className="title">{pet.name}</h1>
          <div className="sub" style={{ fontSize: 14 }}>{[SPECIES[pet.species], pet.breed, ageText(pet.birth_date)].filter(Boolean).join(' · ')}</div>
          {shared && <div className={'badge pill ' + (mine ? 'good' : '')} style={{ display: 'inline-block', marginTop: 8, ...(mine ? {} : { background: 'var(--other-soft)', color: 'var(--other)' }) }}>{mine ? 'Yours' : `${nameOf(pet.owner_id)}'s`}</div>}
        </div>
        {mine && <Link to={`/pets/${pet.id}/edit`} className="btn ghost small">Edit</Link>}
      </header>

      <div role="tablist" aria-label={`${pet.name} sections`}>
        <Segmented<Tab> label={`${pet.name} sections`} value={tab} onChange={setTab}
          options={[{ id: 'overview', label: 'Overview' }, { id: 'meds', label: 'Meds' }, { id: 'weight', label: 'Weight' }, { id: 'records', label: 'Records' }]} />
      </div>
      <ErrorNote msg={error} />

      {tab === 'overview' && (
        <div className="stack" style={{ gap: 16 }}>
          <EmergencyCard pet={pet} mine={mine} />
          <div className="grid2">
            <div className="stat"><div className="k">Weight</div><div className="v tabular">{latest ? `${fmtNum(latest.kg)} kg` : '—'}</div>
              {delta != null && <div className="s">{delta > 0 ? '+' : delta < 0 ? '−' : '±'}{Math.abs(delta).toFixed(1)} kg since {fmtShort(baseline!.measured_on).slice(4)}</div>}</div>
            <div className="stat"><div className="k">Born</div><div className="v">{pet.birth_date ? fmtDate(pet.birth_date) : '—'}</div>
              <div className="s">{[pet.sex === 'male' ? 'Male' : pet.sex === 'female' ? 'Female' : null, pet.neutered ? 'neutered' : null].filter(Boolean).join(' · ')}</div></div>
            <div className="stat"><div className="k">Microchip</div><div className="v tabular" style={{ fontSize: 15 }}>{pet.microchip || '—'}</div></div>
            <div className="stat"><div className="k">Vet</div><div className="v" style={{ fontSize: 15 }}>{pet.vet_name || '—'}</div></div>
          </div>

          <AppointmentsCard petId={pet.id} mine={mine} upcoming={upcoming} past={past} run={run} busy={busy} />
          <VaccinesCard pet={pet} mine={mine} vaccines={app.vaccinations.filter((v) => v.pet_id === pet.id)} run={run} busy={busy} />

          {petItems.length > 0 && (
            <section className="card">
              <div className="card-head"><h2>Stock</h2><Link to="/stock" className="small">All stock</Link></div>
              {petItems.filter((it) => it.status === 'active').map((it) => {
                const info = itemInfo(it)
                return (
                  <Link key={it.id} to={`/stock/${it.id}`} className="card-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <ItemThumb type={it.type} src={photoUrl(it.photo_path)} />
                    <div className="grow"><div className="row-title">{it.name}</div>
                      <div className="row-sub">{it.type === 'med' ? scheduleText(it) : it.type === 'food' ? `${fmtNum(it.stock_item_pets.find((p) => p.pet_id === pet.id)?.daily_grams ?? 0)} g/day` : ''}</div></div>
                    {info.daysLeft != null ? <span className={'badge ' + (info.urgent ? 'warn' : 'grey')}>{info.daysLeft} days</span>
                      : info.countNow != null ? <span className={'badge ' + (info.lowAsNeeded ? 'warn' : 'grey')}>{fmtNum(info.countNow)} left</span> : null}
                  </Link>
                )
              })}
            </section>
          )}
          {pet.notes && <p className="note" style={{ whiteSpace: 'pre-wrap' }}>{pet.notes}</p>}
        </div>
      )}

      {tab === 'meds' && (
        <div className="stack">
          {meds.length === 0 && <p className="hint">No medication for {pet.name} yet.</p>}
          {[...meds].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)).map((it) => (
            <MedCard key={it.id} item={it} mine={mine} logs={logs.filter((l) => l.item_id === it.id)}
              busy={busy} onRefill={() => run(() => refill(it))} onLog={() => run(() => logAsNeeded(it, pet.id))}
              onCycle={(d, t, log) => run(() => cycleDose(it, pet.id, d, t, log))} />
          ))}
          {mine && <Link to={`/stock/new?type=med&pet=${pet.id}`} className="btn dashed block"><IconPlus size={18} />Add medication</Link>}
        </div>
      )}

      {tab === 'weight' && <WeightTab petId={pet.id} mine={mine} weights={weights} run={run} busy={busy} />}
      {tab === 'records' && <RecordsTab petId={pet.id} mine={mine} docs={docs} run={run} busy={busy} setError={setError} />}
    </Screen>
  )
}

type Run = (fn: () => PromiseLike<{ error: unknown }>) => Promise<void>

function AppointmentsCard({ petId, mine, upcoming, past, run, busy }: { petId: string; mine: boolean; upcoming: Appointment[]; past: Appointment[]; run: Run; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('Vet check-up')
  const [date, setDate] = useState(addDays(todayISO(), 7))
  const [time, setTime] = useState('10:00')
  const [where, setWhere] = useState('')

  async function add(e: FormEvent) {
    e.preventDefault()
    const starts = parseISO(date)
    const [h, m] = time.split(':').map(Number)
    starts.setHours(h, m, 0, 0)
    await run(() => supabase.from('appointments').insert({ pet_id: petId, title: title.trim() || 'Appointment', starts_at: starts.toISOString(), location: where.trim() || null }))
    setOpen(false)
  }

  const row = (a: Appointment, faded = false) => {
    const d = new Date(a.starts_at)
    return (
      <div key={a.id} className="card-row" style={faded ? { opacity: 0.7 } : undefined}>
        <div className="date-tile"><div className="m" style={faded ? { color: 'var(--muted-2)' } : undefined}>{d.toLocaleString('en', { month: 'short' })}</div><div className="d">{d.getDate()}</div></div>
        <div className="grow"><div className="row-title">{a.title}</div><div className="row-sub">{fmtDateTime(a.starts_at)}{a.location ? ` · ${a.location}` : ''}</div></div>
        {mine && <button className="icon-btn plain" aria-label={`Delete ${a.title}`} disabled={busy}
          onClick={() => { if (window.confirm('Delete this appointment?')) void run(() => supabase.from('appointments').delete().eq('id', a.id)) }}><IconTrash size={18} /></button>}
      </div>
    )
  }

  return (
    <section className="card" aria-labelledby="appt-h">
      <div className="card-head" style={{ alignItems: 'center', paddingBottom: 6 }}>
        <h2 id="appt-h">Appointments</h2>
        {mine && <button className="icon-btn plain" aria-label="Add appointment" onClick={() => setOpen(!open)}><IconPlus size={20} /></button>}
      </div>
      {open && (
        <form className="card-foot" onSubmit={add} style={{ borderTop: '1px solid var(--line-2)' }}>
          <div className="field"><label htmlFor="at">What</label><input id="at" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="grid2" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="ad">Date</label><input id="ad" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
            <div className="field"><label htmlFor="ati">Time</label><input id="ati" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
          </div>
          <div className="field"><label htmlFor="aw">Where <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></label><input id="aw" className="input" value={where} onChange={(e) => setWhere(e.target.value)} /></div>
          <button className="btn" type="submit" disabled={busy}>Save appointment</button>
        </form>
      )}
      {upcoming.length === 0 && !open && <div className="card-row"><span className="hint">Nothing booked.</span></div>}
      {upcoming.map((a) => row(a))}
      {past.length > 0 && <div className="card-row small muted" style={{ fontWeight: 700, paddingBottom: 4 }}>Past</div>}
      {past.map((a) => row(a, true))}
    </section>
  )
}

function MedCard({ item, mine, logs, busy, onRefill, onLog, onCycle }: {
  item: StockItem; mine: boolean; logs: DoseLog[]; busy: boolean; onRefill: () => void; onLog: () => void
  onCycle: (date: string, time: string, log: DoseLog | undefined) => void
}) {
  const [openDay, setOpenDay] = useState<string | null>(null)
  const info = itemInfo(item)
  const today = todayISO()
  const status = item.status === 'active' ? (item.frequency === 'as_needed' ? 'As needed' : 'Active') : item.status === 'paused' ? 'Paused' : 'Finished'
  const week = item.frequency === 'daily' && item.status === 'active'
    ? Array.from({ length: 7 }, (_, i) => {
      const d = addDays(today, i - 6)
      const before = d < medStart(item)
      const slots = before ? [] : medTimes(item).map((t) => {
        const log = logs.find((l) => l.slot_date === d && l.slot_time === t)
        return { t, log, state: slotState(d, t, log) }
      })
      const state = before ? 'none'
        : slots.some((x) => x.state === 'missed') ? 'missed'
        : slots.length && slots.every((x) => x.state === 'given' || x.state === 'auto') ? (slots.every((x) => x.state === 'given') ? 'ok' : 'auto')
        : 'none'
      return { d, label: parseISO(d).toLocaleString('en', { weekday: 'narrow' }), state, slots }
    })
    : null
  const missed = week ? week.reduce((n, w) => n + w.slots.filter((x) => x.state === 'missed').length, 0) : 0
  const open = week?.find((w) => w.d === openDay)
  const lastAsNeeded = item.frequency === 'as_needed' ? [...logs].sort((a, b) => b.given_at.localeCompare(a.given_at))[0] : undefined

  return (
    <section className="card pad stack" style={item.status !== 'active' ? { background: 'var(--surface-2)' } : undefined}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h2 className="h">{item.name}</h2>
          <div className="row-sub">{scheduleText(item)}{item.source === 'vet' ? ' · prescription' : ''}</div>
          {lastAsNeeded && <div className="row-sub">Last given {fmtDateTime(lastAsNeeded.given_at)}</div>}
        </div>
        <span className={'badge pill ' + (item.status === 'active' ? 'good' : 'grey')}>{status}</span>
      </div>

      {item.status === 'active' && info.countNow != null && (
        <Link to={`/stock/${item.id}`} className="stack-sm" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', textDecoration: 'none', color: 'inherit' }}>
          <div className="row between small">
            <span className="tabular" style={{ fontWeight: 600 }}>{fmtNum(info.countNow)}{item.box_size ? ` of ${fmtNum(Number(item.box_size))}` : ''} {unitFor(item)} left</span>
            <span className={info.urgent ? 'warn-text' : 'muted'}>
              {info.daysLeft != null ? `${daysText(info.daysLeft).replace('About ', '').replace(' left', '')}${info.orderBy ? ` · order by ${fmtShort(info.orderBy)}` : ''}` : `alert at ${fmtNum(Number(item.alert_at ?? 2))}`}
            </span>
          </div>
          {info.pct != null && <Bar pct={info.pct} urgent={info.urgent} label={`${info.daysLeft} days left`} />}
        </Link>
      )}

      {week && (
        <div>
          <div className="week">
            {week.map((w) => (
              <button key={w.d} type="button" aria-pressed={openDay === w.d} disabled={!w.slots.length}
                onClick={() => setOpenDay(openDay === w.d ? null : w.d)}
                aria-label={`${fmtShort(w.d)}: ${w.state === 'missed' ? 'a dose was missed' : w.state === 'none' ? 'not due yet' : 'given'}. Show doses`}>
                <span className={'wk ' + w.state}>
                  {(w.state === 'ok' || w.state === 'auto') && <IconCheck size={13} strokeWidth={3} />}
                  {w.state === 'missed' && <IconX size={11} />}
                </span>
                {w.label}
              </button>
            ))}
          </div>
          {open && (
            <div className="stack-sm" style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
              <div className="small" style={{ fontWeight: 700 }}>{fmtShort(open.d)}</div>
              {open.slots.map((x) => (
                <div key={x.t} className="row between" style={{ gap: 8 }}>
                  <span className="small">{x.t} · {x.state === 'missed' ? 'Missed (pill added back)' : x.state === 'given' ? `Given ${fmtTime(x.log!.given_at)}` : x.state === 'auto' ? 'Counted as given' : 'Not yet'}</span>
                  {mine && (
                    <button className="btn ghost small" disabled={busy} onClick={() => onCycle(open.d, x.t, x.log)}>
                      {x.state === 'missed' ? 'Mark given' : x.state === 'pending' ? 'Given now' : 'Mark missed'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="small muted" style={{ marginTop: 8 }}>{missed ? `${missed} missed in the last week · tap a day to change` : 'Nothing missed this week · tap a day to mark a missed dose'}</div>
        </div>
      )}
      {!week && item.status === 'active' && item.frequency !== 'as_needed' && isDueOn(item, today) && <div className="small muted">Due today</div>}

      {mine && item.status === 'active' && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {item.frequency === 'as_needed' && <button className="btn small" onClick={onLog} disabled={busy || (info.countNow ?? 0) <= 0}>Give a dose now</button>}
          <button className="btn ghost small" onClick={onRefill} disabled={busy || !item.box_size}>Refilled +1 box</button>
          <Link to={`/stock/${item.id}`} className="btn ghost small">Edit</Link>
        </div>
      )}
      {mine && item.status !== 'active' && <Link to={`/stock/${item.id}`} className="btn ghost small" style={{ alignSelf: 'flex-start' }}>Edit</Link>}
    </section>
  )
}

function WeightTab({ petId, mine, weights, run, busy }: { petId: string; mine: boolean; weights: Weight[]; run: Run; busy: boolean }) {
  const [kg, setKg] = useState('')
  const [date, setDate] = useState(todayISO())
  const points = weights.map((w) => ({ date: w.measured_on, kg: Number(w.kg) }))
  const recent = [...weights].reverse()

  async function add(e: FormEvent) {
    e.preventDefault()
    const v = parseFloat(kg.replace(',', '.'))
    if (!(v > 0)) return
    await run(() => supabase.from('weights').insert({ pet_id: petId, measured_on: date, kg: v }))
    setKg('')
  }

  return (
    <div className="stack">
      {points.length >= 2 ? (
        <section className="card pad">
          <div className="row between" style={{ alignItems: 'baseline' }}><h2 className="h">Weight</h2><span className="small muted">kg · tap a point</span></div>
          <div style={{ marginTop: 8 }}><WeightChart points={points.slice(-24)} /></div>
        </section>
      ) : <p className="hint">Log at least two weights to see a chart.</p>}

      {mine && (
        <form className="card pad stack" onSubmit={add}>
          <div className="field"><label htmlFor="wk">Weight (kg)</label><input id="wk" className="input" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="e.g. 28.4" required /></div>
          <div className="field"><label htmlFor="wd">Date</label><input id="wd" className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} required /></div>
          <button className="btn" type="submit" disabled={busy}>Log weight</button>
        </form>
      )}

      {recent.length > 0 && (
        <section className="card">
          {recent.map((w, i) => {
            const prev = recent[i + 1]
            const d = prev ? Number(w.kg) - Number(prev.kg) : null
            return (
              <div key={w.id} className="card-row" style={i === 0 ? { borderTop: 0 } : undefined}>
                <div className="grow"><div className="row-title tabular">{fmtNum(Number(w.kg))} kg</div><div className="row-sub">{fmtDate(w.measured_on)}{d != null && Math.abs(d) >= 0.05 ? ` · ${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} kg` : ''}</div></div>
                {mine && <button className="icon-btn plain" aria-label={`Delete weight from ${fmtDate(w.measured_on)}`} disabled={busy}
                  onClick={() => { if (window.confirm('Delete this weight?')) void run(() => supabase.from('weights').delete().eq('id', w.id)) }}><IconTrash size={18} /></button>}
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}

function RecordsTab({ petId, mine, docs, run, busy, setError }: { petId: string; mine: boolean; docs: DocumentRow[]; run: Run; busy: boolean; setError: (s: string | null) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayISO())
  const [uploading, setUploading] = useState(false)

  async function upload(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    setUploading(true); setError(null)
    const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)
    const path = `${petId}/${crypto.randomUUID()}-${safe}`
    const up = await supabase.storage.from('pet-docs').upload(path, file, { contentType: file.type || undefined })
    if (up.error) { setError(errMsg(up.error)); setUploading(false); return }
    await run(() => supabase.from('documents').insert({
      pet_id: petId, title: title.trim() || file.name, taken_on: date || null, storage_path: path, mime_type: file.type || null, size_bytes: file.size
    }))
    setFile(null); setTitle(''); setUploading(false)
    const input = document.getElementById('df') as HTMLInputElement | null
    if (input) input.value = ''
  }

  async function open(d: DocumentRow) {
    const w = window.open('', '_blank')
    const { data, error } = await supabase.storage.from('pet-docs').createSignedUrl(d.storage_path, 120)
    if (error || !data) { w?.close(); setError(errMsg(error)); return }
    if (w) w.location.href = data.signedUrl
    else window.location.href = data.signedUrl
  }

  async function remove(d: DocumentRow) {
    if (!window.confirm(`Delete “${d.title}”?`)) return
    await supabase.storage.from('pet-docs').remove([d.storage_path])
    await run(() => supabase.from('documents').delete().eq('id', d.id))
  }

  return (
    <div className="stack">
      {docs.length === 0 && <p className="hint">No exams or documents yet. Upload a PDF or a photo, like a blood panel or vaccination booklet.</p>}
      {docs.map((d) => (
        <div key={d.id} className="card pad row">
          <div className="icon-tile" style={{ width: 40, height: 48, fontSize: 10, fontWeight: 800 }}>
            {d.mime_type?.includes('pdf') ? 'PDF' : d.mime_type?.startsWith('image/') ? 'IMG' : <IconDoc size={18} />}
          </div>
          <button className="grow" onClick={() => open(d)} style={{ border: 0, background: 'transparent', textAlign: 'left', padding: 0 }}>
            <div className="row-title">{d.title}</div>
            <div className="row-sub">{d.taken_on ? fmtDate(d.taken_on) : fmtDate(d.created_at.slice(0, 10))}{d.size_bytes ? ` · ${Math.max(1, Math.round(d.size_bytes / 1024))} KB` : ''}</div>
          </button>
          {mine && <button className="icon-btn plain" aria-label={`Delete ${d.title}`} onClick={() => remove(d)} disabled={busy}><IconTrash size={18} /></button>}
        </div>
      ))}
      {mine && (
        <form className="card pad stack" onSubmit={upload}>
          <h2 className="h">Add an exam or document</h2>
          <label htmlFor="df" className="file-pick">
            <span className="icon-tile"><IconDoc size={18} /></span>
            <span className="grow">{file ? file.name : 'Choose a PDF or photo'}</span>
            <span className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>{file ? 'Change' : 'Browse'}</span>
          </label>
          <input id="df" className="visually-hidden" type="file" accept="application/pdf,image/*" onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setFile(f)
            if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''))
          }} />
          <div className="field"><label htmlFor="dt">Title</label><input id="dt" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Blood panel" /></div>
          <div className="field"><label htmlFor="dd">Date of the exam</label><input id="dd" className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></div>
          <button className="btn" type="submit" disabled={!file || uploading || busy}>{uploading ? 'Uploading…' : 'Upload'}</button>
          <div className="hint">PDF or photo, up to 20 MB. Only people in your household can open it.</div>
        </form>
      )}
    </div>
  )
}

