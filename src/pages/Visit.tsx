import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg } from '../lib/supabase'
import { fmtDate, fmtDateTime, fmtShort, todayISO, toISO } from '../lib/dates'
import { euro, fmtNum } from '../lib/calc'
import { round2 } from '../lib/costs'
import { openPetDoc } from '../lib/health'
import { FOLLOW_UPS, VISIT_KINDS, followUpDate, hhmm, loadDraft, localStamp, saveDraft, uploadVisitFile, type FollowUp } from '../lib/visits'
import type { Appointment, DocumentRow, Expense, Weight } from '../lib/types'
import { BackLink, ErrorNote, FieldLabel, InfoTip, Loading, Screen, Toggle, useGoBack } from '../components/ui'
import { IconCalendar, IconDoc, IconTrash, IconX } from '../components/icons'

const MAX_FILE = 20 * 1024 * 1024

function nowRounded(): string {
  const d = new Date()
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15)
  return hhmm(d.toISOString())
}

/** Remount per visit, so moving between a visit and its follow-up starts from a clean form. */
export default function VisitRoute() {
  const { id = '', visitId = 'new' } = useParams()
  return <Visit key={`${id}/${visitId}`} />
}

/** One vet visit: free-text notes plus what came out of it (files, weight, cost, follow-up). */
function Visit() {
  const { id: petId = '', visitId = 'new' } = useParams()
  const app = useApp()
  const { petById, userId, household, reload } = app
  const pet = petById(petId)
  const mine = pet?.owner_id === userId
  const isNew = visitId === 'new'
  const nav = useNavigate()
  const goBack = useGoBack(`/pets/${petId}?tab=visits`)

  const [loaded, setLoaded] = useState(isNew)
  const [visit, setVisit] = useState<Appointment | null>(null)
  const [docs, setDocs] = useState<DocumentRow[]>([])
  const [weight, setWeight] = useState<Weight | null>(null)
  const [cost, setCost] = useState<Expense | null>(null)
  const [followUps, setFollowUps] = useState<Appointment[]>([])
  const [parent, setParent] = useState<Appointment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [restored, setRestored] = useState(false)

  const [title, setTitle] = useState('Vet visit')
  const [day, setDay] = useState(todayISO())
  const [time, setTime] = useState(nowRounded())
  const [where, setWhere] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [kg, setKg] = useState('')
  const [amount, setAmount] = useState('')
  const [oneOff, setOneOff] = useState(false)
  const [fu, setFu] = useState<FollowUp>('none')
  const [fuDay, setFuDay] = useState('')
  const [fuTime, setFuTime] = useState('')
  const initial = useRef('')

  const load = useCallback(async () => {
    if (isNew) {
      setWhere(pet?.vet_name ?? '')
      const draft = loadDraft(petId, 'new')
      if (draft) { setNotes(draft); setRestored(true) }
      initial.current = JSON.stringify(['Vet visit', todayISO(), nowRounded(), pet?.vet_name ?? '', '', '', '', false, 'none'])
      return
    }
    const [a, d, w, x, f] = await Promise.all([
      supabase.from('appointments').select('*').eq('id', visitId).maybeSingle(),
      supabase.from('documents').select('*').eq('appointment_id', visitId).order('created_at'),
      supabase.from('weights').select('*').eq('appointment_id', visitId).order('created_at', { ascending: false }).limit(1),
      supabase.from('expenses').select('*').eq('appointment_id', visitId).order('created_at'),
      supabase.from('appointments').select('*').eq('follow_up_of', visitId).order('starts_at')
    ])
    const e = a.error || d.error || w.error || x.error || f.error
    if (e) setError(errMsg(e))
    const v = (a.data ?? null) as Appointment | null
    setVisit(v)
    setDocs((d.data ?? []) as DocumentRow[])
    const wt = ((w.data ?? [])[0] ?? null) as Weight | null
    setWeight(wt)
    const costs = (x.data ?? []) as Expense[]
    const c = costs.find((r) => r.owner_id === userId) ?? costs[0] ?? null
    setCost(c)
    setFollowUps((f.data ?? []) as Appointment[])
    if (v?.follow_up_of) {
      const p = await supabase.from('appointments').select('*').eq('id', v.follow_up_of).maybeSingle()
      setParent((p.data ?? null) as Appointment | null)
    } else setParent(null)
    if (v) {
      const vDay = toISO(new Date(v.starts_at)), vTime = hhmm(v.starts_at)
      const draft = loadDraft(petId, v.id)
      const n = draft != null && draft !== (v.notes ?? '') ? draft : (v.notes ?? '')
      setRestored(draft != null && draft !== (v.notes ?? ''))
      setTitle(v.title); setDay(vDay); setTime(vTime); setWhere(v.location ?? ''); setNotes(n)
      setKg(wt ? fmtNum(Number(wt.kg)) : ''); setAmount(c ? Number(c.amount).toFixed(2) : ''); setOneOff(c?.one_off ?? false)
      setFu('none'); setFuDay(''); setFuTime(vTime); setFiles([])
      initial.current = JSON.stringify([v.title, vDay, vTime, v.location ?? '', v.notes ?? '', wt ? fmtNum(Number(wt.kg)) : '', c ? Number(c.amount).toFixed(2) : '', c?.one_off ?? false, 'none'])
    }
    setLoaded(true)
  }, [isNew, visitId, petId, userId, pet?.vet_name])

  useEffect(() => { void load() }, [load])

  // keep a local copy of the notes while typing, in case the app is closed before saving
  useEffect(() => {
    if (!loaded || !mine) return
    const key = isNew ? 'new' : visitId
    const saved = isNew ? '' : (visit?.notes ?? '')
    const t = window.setTimeout(() => saveDraft(petId, key, notes && notes !== saved ? notes : null), 400)
    return () => window.clearTimeout(t)
  }, [notes, loaded, mine, isNew, visitId, petId, visit?.notes])

  const happened = day <= todayISO()
  const fuTarget = followUpDate(day, fu, fuDay)
  const dirty = JSON.stringify([title, day, time, where, notes, kg, amount, oneOff, fu]) !== initial.current || files.length > 0
  const myCost = !cost || cost.owner_id === userId

  const sortedFollowUps = useMemo(() => followUps, [followUps])

  if (!pet) return app.loading ? <Loading /> : <Screen><BackLink to="/pets" label="Pets" /><p className="note">This pet isn't here any more.</p></Screen>
  if (!loaded) return <Loading />
  if (!isNew && !visit) return <Screen><BackLink label={pet.name} /><p className="note">This visit was deleted.</p></Screen>
  if (!mine && isNew) return <Screen><BackLink label={pet.name} /><p className="note">Only {pet.name}'s owner can log visits.</p></Screen>

  function cancel() {
    if (dirty && !window.confirm('Leave without saving? Your changes will be lost.')) return
    saveDraft(petId, isNew ? 'new' : visitId, null)
    goBack()
  }

  function pickFiles(list: FileList | null) {
    if (!list) return
    const add = Array.from(list)
    const big = add.find((f) => f.size > MAX_FILE)
    if (big) { setError(`“${big.name}” is over 20 MB.`); return }
    setError(null)
    setFiles((cur) => [...cur, ...add])
  }

  async function save(e?: FormEvent) {
    e?.preventDefault()
    if (!pet || !household) return
    const kgNum = kg.trim() ? parseFloat(kg.replace(',', '.')) : null
    if (kgNum != null && !(kgNum > 0 && kgNum < 200)) { setError('Type the weight in kg, e.g. 4.2'); return }
    const amt = amount.trim() ? parseFloat(amount.replace(',', '.')) : null
    if (amt != null && !(Number.isFinite(amt) && amt >= 0 && amt < 100000)) { setError('Type what you paid, e.g. 45.50'); return }
    if (fu === 'pick' && !fuDay) { setError('Pick the follow-up date, or choose “No”.'); return }
    setSaving(true); setError(null)
    const fail = (err: unknown) => { setError(errMsg(err)); setSaving(false) }

    const row = { title: title.trim().slice(0, 120) || 'Vet visit', starts_at: localStamp(day, time), location: where.trim() || null, notes: notes.trim() || null }
    let vid = visit?.id
    if (vid) {
      const r = await supabase.from('appointments').update(row).eq('id', vid)
      if (r.error) return fail(r.error)
    } else {
      const r = await supabase.from('appointments').insert({ ...row, pet_id: pet.id }).select('id').single()
      if (r.error) return fail(r.error)
      vid = r.data.id as string
    }

    for (const f of files) {
      const r = await uploadVisitFile(pet.id, vid, day, f)
      if (r.error) { setFiles((cur) => cur.slice(cur.indexOf(f))); return fail(r.error) }
    }
    setFiles([])
    if (visit && day !== toISO(new Date(visit.starts_at)) && docs.length) {
      await supabase.from('documents').update({ taken_on: day }).eq('appointment_id', vid)
    }

    if (happened) {
      if (kgNum != null) {
        const r = weight
          ? await supabase.from('weights').update({ kg: kgNum, measured_on: day }).eq('id', weight.id)
          : await supabase.from('weights').insert({ pet_id: pet.id, measured_on: day, kg: kgNum, note: 'At the vet', appointment_id: vid })
        if (r.error) return fail(r.error)
      } else if (weight) {
        const r = await supabase.from('weights').delete().eq('id', weight.id)
        if (r.error) return fail(r.error)
      }

      if (myCost) {
        if (amt != null && amt > 0) {
          const line = { spent_on: day, amount: round2(amt), title: row.title, one_off: oneOff }
          const r = cost
            ? await supabase.from('expenses').update(line).eq('id', cost.id)
            : await supabase.from('expenses').insert({ ...line, owner_id: userId, household_id: household.id, category: 'vet', pet_ids: [pet.id], appointment_id: vid })
          if (r.error) return fail(r.error)
        } else if (cost) {
          const r = await supabase.from('expenses').delete().eq('id', cost.id)
          if (r.error) return fail(r.error)
        }
      }

      if (fuTarget && !followUps.length) {
        const r = await supabase.from('appointments').insert({
          pet_id: pet.id, follow_up_of: vid, title: `Follow-up: ${row.title}`.slice(0, 120),
          starts_at: localStamp(fuTarget, fuTime || time), location: row.location
        })
        if (r.error) return fail(r.error)
      }
    }

    saveDraft(petId, 'new', null)
    saveDraft(petId, vid, null)
    await reload()
    setSaving(false)
    initial.current = ''
    goBack()
  }

  async function removeDoc(d: DocumentRow) {
    if (!window.confirm(`Delete “${d.title}”? It's removed from Files too.`)) return
    await supabase.storage.from('pet-docs').remove([d.storage_path])
    const r = await supabase.from('documents').delete().eq('id', d.id)
    if (r.error) setError(errMsg(r.error))
    setDocs((cur) => cur.filter((x) => x.id !== d.id))
  }

  async function removeVisit() {
    if (!visit) return
    if (!window.confirm('Delete this visit and its notes? Files, the weight and the cost stay in Files, Weight and Costs.')) return
    setSaving(true)
    const r = await supabase.from('appointments').delete().eq('id', visit.id)
    setSaving(false)
    if (r.error) { setError(errMsg(r.error)); return }
    saveDraft(petId, visit.id, null)
    await reload()
    nav(`/pets/${petId}?tab=visits`, { replace: true })
  }

  const docList = docs.length > 0 && (
    <div className="stack-sm">
      {docs.map((d) => (
        <div key={d.id} className="row visit-file">
          <div className="icon-tile" style={{ width: 34, height: 40, fontSize: 10, fontWeight: 800 }}>
            {d.mime_type?.includes('pdf') ? 'PDF' : d.mime_type?.startsWith('image/') ? 'IMG' : <IconDoc size={16} />}
          </div>
          <button type="button" className="grow link-plain" onClick={() => void openPetDoc(d.storage_path).then((m) => m && setError(m))}>
            <div className="row-title" style={{ fontSize: 14 }}>{d.title}</div>
            <div className="row-sub">Tap to open{d.size_bytes ? ` · ${Math.max(1, Math.round(d.size_bytes / 1024))} KB` : ''}</div>
          </button>
          {mine && <button type="button" className="icon-btn plain" aria-label={`Delete ${d.title}`} onClick={() => void removeDoc(d)}><IconTrash size={18} /></button>}
        </div>
      ))}
    </div>
  )

  const followUpList = sortedFollowUps.length > 0 && (
    <div className="stack-sm">
      {sortedFollowUps.map((f) => (
        <Link key={f.id} to={`/pets/${petId}/visits/${f.id}`} className="row visit-file" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="icon-tile soft"><IconCalendar size={18} /></div>
          <div className="grow">
            <div className="row-title" style={{ fontSize: 14 }}>{f.title}</div>
            <div className="row-sub">{fmtDateTime(f.starts_at)}{new Date(f.starts_at) > new Date() ? ' · booked' : ''}</div>
          </div>
          <span className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>Open</span>
        </Link>
      ))}
    </div>
  )

  const parentLink = parent && (
    <Link to={`/pets/${petId}/visits/${parent.id}`} className="small" style={{ fontWeight: 600 }}>
      Follow-up to {parent.title} · {fmtShort(toISO(new Date(parent.starts_at)))}
    </Link>
  )

  // ───────────── read-only (partner's pet) ─────────────
  if (!mine && visit) {
    return (
      <Screen>
        <BackLink label={pet.name} />
        <header className="stack-sm">
          <div className="small muted" style={{ fontWeight: 700 }}>{pet.name} · vet visit</div>
          <h1 className="title" style={{ margin: 0 }}>{visit.title}</h1>
          <div className="sub" style={{ marginTop: 0 }}>{fmtDateTime(visit.starts_at)}{visit.location ? ` · ${visit.location}` : ''}</div>
          {parentLink}
        </header>
        <section className="card pad stack-sm">
          <h2 className="h">Notes</h2>
          {visit.notes ? <div className="visit-notes">{visit.notes}</div> : <p className="hint" style={{ margin: 0 }}>No notes yet.</p>}
        </section>
        {(docs.length > 0 || weight || cost || followUps.length > 0) && (
          <section className="card pad stack">
            {docList}
            {(weight || cost) && (
              <div className="grid2">
                {weight && <div className="stat"><div className="k">Weight</div><div className="v tabular">{fmtNum(Number(weight.kg))} kg</div></div>}
                {cost && <div className="stat"><div className="k">Cost</div><div className="v tabular">{euro(Number(cost.amount))}</div>{cost.one_off && <div className="s">one-off</div>}</div>}
              </div>
            )}
            {followUpList}
          </section>
        )}
      </Screen>
    )
  }

  // ───────────── owner: form ─────────────
  return (
    <div className="screen">
      <form className="content" onSubmit={save} style={{ paddingBottom: 40 }}>
        <div className="topbar">
          <button type="button" onClick={cancel}>Cancel</button>
          <h1>{isNew ? `Log a visit · ${pet.name}` : `${pet.name} · visit`}</h1>
          <button type="submit" className="strong" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
        <ErrorNote msg={error} />
        {parentLink}

        <section className="card pad stack">
          <div className="field">
            <label htmlFor="vt">What</label>
            <input id="vt" className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            {isNew && (
              <div className="chips scroll" role="group" aria-label="Quick titles">
                {VISIT_KINDS.map((k) => (
                  <button key={k} type="button" className={'chip' + (title === k ? ' on' : '')} aria-pressed={title === k} onClick={() => setTitle(k)}>{k}</button>
                ))}
              </div>
            )}
          </div>
          <div className="grid2" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="vd">Date</label><input id="vd" className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} required /></div>
            <div className="field"><label htmlFor="vh">Time</label><input id="vh" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
          </div>
          <div className="field"><label htmlFor="vw">Where <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></label><input id="vw" className="input" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Clinic or vet's name" /></div>
        </section>

        <section className="card pad stack-sm">
          <FieldLabel htmlFor="vn" tip={happened
            ? 'Anything worth remembering: what the vet checked and found, what they said to do, doses, what to watch for, prices. Only your household can see it. It\'s kept on your phone as you type, so nothing is lost if the app closes before you save.'
            : 'Write down what you want to ask or mention, so you don\'t forget at the vet. After the visit, add what they said here too. Only your household can see it.'}>
            {happened ? 'Notes' : 'Notes for the visit'}
          </FieldLabel>
          <textarea id="vn" className="input visit-textarea" rows={happened ? 10 : 6} maxLength={20000} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={happened
              ? 'What did the vet say? e.g.\nKidney values a bit high, repeat bloods in 3 months.\nStart renal diet slowly over a week.\nCall if she stops eating.'
              : 'Questions to ask, things to mention… e.g.\nDrinking more water than usual since August\nAsk whether the new food is working'} />
          {restored && <div className="small muted">Restored what you typed last time (not saved yet).</div>}
        </section>

        <section className="card pad stack">
          <div className="stack-sm">
            <FieldLabel as="span" tip="Reports, prescriptions, invoices or exam results the vet gave you. Photos or PDFs, up to 20 MB each. They also appear in the Files tab, marked with this visit.">Documents from the vet</FieldLabel>
            {docList}
            {files.map((f, i) => (
              <div key={i + f.name} className="row visit-file">
                <div className="icon-tile" style={{ width: 34, height: 40, fontSize: 10, fontWeight: 800 }}>{f.type.includes('pdf') ? 'PDF' : f.type.startsWith('image/') ? 'IMG' : <IconDoc size={16} />}</div>
                <div className="grow"><div className="row-title" style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div><div className="row-sub">Uploads when you save</div></div>
                <button type="button" className="icon-btn plain" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><IconX size={14} /></button>
              </div>
            ))}
            <label htmlFor="vf" className="file-pick">
              <span className="icon-tile"><IconDoc size={18} /></span>
              <span className="grow">Add a PDF or photo</span>
              <span className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>Browse</span>
            </label>
            <input id="vf" className="visually-hidden" type="file" multiple accept="application/pdf,image/*" onChange={(e) => { pickFiles(e.target.files); e.target.value = '' }} />
          </div>

          {happened ? (
            <>
              <div className="grid2" style={{ gap: 12 }}>
                <div className="field">
                  <FieldLabel htmlFor="vk" tip={`The weight measured at the vet. It's added to ${pet.name}'s Weight chart, dated the day of the visit. Clear it to remove it.`}>Weight (kg)</FieldLabel>
                  <input id="vk" className="input" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="e.g. 4.2" />
                </div>
                <div className="field">
                  <FieldLabel htmlFor="va" tip={myCost ? `What you paid. It's added to Costs as a vet cost for ${pet.name}, on the day of the visit. Clear it to remove it.` : 'Logged by someone else; they can change it.'}>Cost (€)</FieldLabel>
                  <input id="va" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" disabled={!myCost} />
                </div>
              </div>
              {amount.trim() !== '' && myCost && (
                <div className="row between">
                  <div>
                    <div className="label-row"><span id="vo-l" className="label">One-off cost</span>
                      <InfoTip label="About one-off vet costs">Turn on for big, unusual bills like surgery or an emergency. It still counts in the totals but is left out of your usual monthly spending, so one expensive month doesn't look like the norm.</InfoTip>
                    </div>
                    <div className="small muted" style={{ marginTop: 2 }}>{oneOff ? 'Left out of the monthly average' : 'Part of normal monthly spending'}</div>
                  </div>
                  <Toggle on={oneOff} onChange={setOneOff} labelledBy="vo-l" />
                </div>
              )}

              <div className="stack-sm">
                <FieldLabel as="span" tip="Books the next visit as an appointment, so you get a reminder 2 hours before, it shows in the morning summary and in your calendar feed. You can add notes to it the same way.">Come back?</FieldLabel>
                {followUpList || (
                  <>
                    <div className="chips" role="group" aria-label="Follow-up">
                      {FOLLOW_UPS.map((o) => (
                        <button key={o.id} type="button" className={'chip' + (fu === o.id ? ' on' : '')} aria-pressed={fu === o.id} onClick={() => setFu(o.id)}>{o.label}</button>
                      ))}
                    </div>
                    {fu !== 'none' && (
                      <div className="grid2" style={{ gap: 12 }}>
                        <div className="field"><label htmlFor="fd">Date</label>
                          {fu === 'pick'
                            ? <input id="fd" className="input" type="date" value={fuDay} min={day} onChange={(e) => setFuDay(e.target.value)} />
                            : <div id="fd" className="input static">{fuTarget ? fmtShort(fuTarget) : '—'}</div>}
                        </div>
                        <div className="field"><label htmlFor="ft">Time</label><input id="ft" className="input" type="time" value={fuTime || time} onChange={(e) => setFuTime(e.target.value)} /></div>
                      </div>
                    )}
                    {fu !== 'none' && fu !== 'pick' && <div className="small muted">Most vets give you a date; change it here or on the appointment later.</div>}
                  </>
                )}
              </div>
            </>
          ) : (
            <p className="hint" style={{ margin: 0 }}>After the visit ({fmtDate(day)}), you can add the weight, the cost and a follow-up here.</p>
          )}
        </section>

        <button className="btn block" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save visit'}</button>
        {!isNew && <button type="button" className="btn danger block" disabled={saving} onClick={() => void removeVisit()}>Delete visit</button>}
      </form>
    </div>
  )
}
