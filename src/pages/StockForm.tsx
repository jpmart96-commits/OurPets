import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg } from '../lib/supabase'
import { addDays, fmtShort, parseISO, todayISO } from '../lib/dates'
import { UNIT_PLURAL, fmtNum, itemInfo, ordinal } from '../lib/calc'
import type { Frequency, ItemStatus, ItemType, MedForm, StockItem } from '../lib/types'
import { Chips, ErrorNote, Segmented } from '../components/ui'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DEFAULT_TIMES = ['08:00', '20:00', '14:00', '23:00']

export default function StockForm() {
  const { id } = useParams()
  const [qs] = useSearchParams()
  const nav = useNavigate()
  const { items, pets, stores, userId, household, reload, nameOf } = useApp()
  const existing = id ? items.find((i) => i.id === id) : undefined
  const myPets = pets.filter((p) => p.owner_id === userId)

  const [type, setType] = useState<ItemType>((qs.get('type') as ItemType) || 'food')
  const [name, setName] = useState('')
  const [petIds, setPetIds] = useState<string[]>(() => {
    const p = qs.get('pet')
    if (p) return [p]
    return myPets.length === 1 ? [myPets[0].id] : []
  })
  const [status, setStatus] = useState<ItemStatus>('active')
  const [source, setSource] = useState<'store' | 'vet'>('store')
  const [storeId, setStoreId] = useState<string>('')
  const [productUrl, setProductUrl] = useState('')
  const [cartUrl, setCartUrl] = useState('')
  const [price, setPrice] = useState('')
  const [lead, setLead] = useState(4)
  // food / supply
  const [packKg, setPackKg] = useState('')
  const [grams, setGrams] = useState<Record<string, string>>({})
  const [packDays, setPackDays] = useState('')
  const [openedOn, setOpenedOn] = useState(todayISO())
  // med
  const [form, setForm] = useState<MedForm>('tablet')
  const [dose, setDose] = useState('1')
  const [freq, setFreq] = useState<Frequency>('daily')
  const [times, setTimes] = useState<string[]>(['08:00'])
  const [startDate, setStartDate] = useState(todayISO())
  const [boxSize, setBoxSize] = useState('')
  const [onHand, setOnHand] = useState('')
  const [onHandInitial, setOnHandInitial] = useState('')
  const [alertAt, setAlertAt] = useState('2')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!existing) return
    const e = existing
    setType(e.type); setName(e.name); setPetIds(e.stock_item_pets.map((p) => p.pet_id)); setStatus(e.status); setSource(e.source)
    setStoreId(e.store_id ?? ''); setProductUrl(e.product_url ?? ''); setCartUrl(e.cart_url ?? ''); setPrice(e.price != null ? String(e.price) : '')
    setLead(e.lead_days); setPackKg(e.pack_kg != null ? String(e.pack_kg) : ''); setPackDays(e.pack_days != null ? String(e.pack_days) : '')
    setOpenedOn(e.opened_on ?? todayISO())
    setGrams(Object.fromEntries(e.stock_item_pets.map((p) => [p.pet_id, p.daily_grams != null ? String(p.daily_grams) : ''])))
    setForm(e.form ?? 'tablet'); setDose(e.dose != null ? String(e.dose) : '1'); setFreq(e.frequency ?? 'daily')
    setTimes(e.dose_times?.length ? e.dose_times : ['08:00']); setStartDate(e.start_date ?? todayISO())
    setBoxSize(e.box_size != null ? String(e.box_size) : '')
    const now = e.type === 'med' ? String(itemInfo(e).countNow ?? '') : ''
    setOnHand(now); setOnHandInitial(now); setAlertAt(e.alert_at != null ? String(e.alert_at) : '2')
  }, [existing])

  // Recognise the store from the product link
  useEffect(() => {
    if (!productUrl || source !== 'store') return
    try {
      const host = new URL(productUrl).hostname.toLowerCase()
      const match = stores.find((s) => host.includes(s.name.toLowerCase().replace(/\s+/g, '')))
      if (match && match.id !== storeId) setStoreId(match.id)
    } catch { /* not a full URL yet */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productUrl])

  const isMed = type === 'med', isFood = type === 'food', isSupply = type === 'supply'
  const unit = UNIT_PLURAL[form]
  const unitCap = unit[0].toUpperCase() + unit.slice(1)

  const summary = useMemo(() => {
    const where = source === 'vet' ? 'vet' : stores.find((s) => s.id === storeId)?.name ?? 'shopping'
    const n = (s: string) => parseFloat(s.replace(',', '.')) || 0
    if (isMed) {
      const d = n(dose), h = n(onHand), b = n(boxSize)
      if (!onHand.trim()) return { big: `How many ${unit} do you have?`, txt: 'Count what\'s in the box now. The app then counts down with each scheduled dose.' }
      const per = freq === 'daily' ? d * times.length : freq === 'weekly' ? d / 7 : freq === 'monthly' ? d / 30 : 0
      if (status !== 'active') return { big: `${fmtNum(h)} ${unit} left`, txt: status === 'paused' ? 'Paused: no countdown and no reminders until you set it back to Active.' : 'Finished: it leaves your stock list and stays in the pet\'s history.' }
      if (freq === 'as_needed' || per <= 0) return { big: `${fmtNum(h)} ${unit} left`, txt: `Given only when needed, so there's no countdown. You'll get an alert when ${fmtNum(n(alertAt))} are left.` }
      const left = Math.floor(h / per)
      return {
        big: `${fmtNum(h)} ${unit} left · about ${left} days`,
        txt: `${b ? `A new box of ${fmtNum(b)} lasts about ${Math.floor(b / per)} days. ` : ''}You'll be reminded on ${fmtShort(addDays(todayISO(), Math.max(0, left - lead)))} and it goes on your ${where} list.`
      }
    }
    if (isFood) {
      const g = petIds.reduce((s, p) => s + n(grams[p] ?? ''), 0)
      const days = g > 0 ? Math.floor((n(packKg) * 1000) / g) : 0
      if (!days) return { big: 'Pick who eats it', txt: 'Choose at least one pet and a daily amount to see how long a pack lasts.' }
      const perDay = n(price) ? ` That's about €${(n(price) / days).toFixed(2)} a day.` : ''
      return { big: `One pack lasts about ${days} days`, txt: `${perDay} You'll get a reminder ${lead} days before it runs out and it goes on your ${where} list.`.trim() }
    }
    const days = n(packDays)
    return days ? { big: `One pack lasts about ${days} days`, txt: `You'll get a reminder ${lead} days before it runs out and it goes on your ${where} list.` } : { big: 'How long does a pack last?', txt: 'Add the number of days one pack lasts.' }
  }, [isMed, isFood, dose, onHand, boxSize, freq, times, status, alertAt, unit, lead, source, storeId, stores, petIds, grams, packKg, price, packDays])

  if (existing && existing.owner_id !== userId) {
    return (
      <div className="login">
        <button className="back" onClick={() => nav(-1)}>Back</button>
        <h1 className="title">{existing.name}</h1>
        <p className="note">This belongs to {nameOf(existing.owner_id)}. Only they can change it.</p>
      </div>
    )
  }

  function togglePet(pid: string) {
    if (isMed) setPetIds([pid])
    else setPetIds(petIds.includes(pid) ? petIds.filter((x) => x !== pid) : [...petIds, pid])
  }

  function setTimesCount(n: number) {
    const next = [...times]
    while (next.length < n) next.push(DEFAULT_TIMES[next.length] ?? '12:00')
    setTimes(next.slice(0, n))
  }

  async function save(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!name.trim()) { setError('Give it a name.'); return }
    if (!petIds.length) { setError(isMed ? 'Choose which pet it is for.' : 'Choose at least one pet.'); return }
    const num = (s: string) => { const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : null }
    const row: Partial<StockItem> & Record<string, unknown> = {
      type, name: name.trim(), status, source, lead_days: lead,
      store_id: source === 'store' ? storeId || null : null,
      product_url: source === 'store' ? productUrl.trim() || null : null,
      cart_url: source === 'store' ? cartUrl.trim() || null : null,
      price: num(price)
    }
    if (isFood || isSupply) {
      row.opened_on = openedOn || todayISO()
      row.pack_kg = isFood ? num(packKg) : null
      row.pack_days = isSupply ? Math.round(num(packDays) ?? 0) || null : null
    }
    if (isMed) {
      Object.assign(row, {
        form, dose: num(dose) ?? 1, frequency: freq, dose_times: freq === 'daily' ? [...times].sort() : null,
        start_date: startDate || todayISO(), box_size: num(boxSize), alert_at: num(alertAt) ?? 2
      })
      const statusChanged = existing && existing.status !== status
      const scheduleChanged = existing && (existing.frequency !== freq || String(existing.dose) !== String(num(dose)) || (existing.dose_times ?? []).join() !== (freq === 'daily' ? [...times].sort().join() : ''))
      if (!existing || onHand !== onHandInitial || statusChanged || scheduleChanged) {
        row.on_hand = num(onHand) ?? 0
        row.counted_at = new Date().toISOString()
      }
    }
    setBusy(true)
    const res = existing
      ? await supabase.from('stock_items').update(row).eq('id', existing.id).select('id').single()
      : await supabase.from('stock_items').insert({ ...row, household_id: household?.id, owner_id: userId }).select('id').single()
    if (res.error) { setBusy(false); setError(errMsg(res.error)); return }
    const itemId = res.data.id as string
    const del = await supabase.from('stock_item_pets').delete().eq('item_id', itemId)
    const ins = del.error ? del : await supabase.from('stock_item_pets').insert(
      petIds.map((pid) => ({ item_id: itemId, pet_id: pid, daily_grams: isFood ? num(grams[pid] ?? '') : null }))
    )
    setBusy(false)
    if (ins.error) { setError(errMsg(ins.error)); return }
    await reload()
    nav(-1)
  }

  async function remove() {
    if (!existing || !window.confirm(`Delete ${existing.name}? Its dose history goes too.`)) return
    setBusy(true)
    const { error } = await supabase.from('stock_items').delete().eq('id', existing.id)
    setBusy(false)
    if (error) { setError(errMsg(error)); return }
    await reload()
    nav('/stock', { replace: true })
  }

  const start = parseISO(startDate || todayISO())

  return (
    <div className="screen">
      <form className="content" onSubmit={save} style={{ paddingBottom: 40 }}>
        <div className="topbar">
          <button type="button" onClick={() => nav(-1)}>Cancel</button>
          <h1>{existing ? 'Edit item' : 'Add to stock'}</h1>
          <button type="submit" className="strong" disabled={busy}>Save</button>
        </div>

        {!existing && (
          <Segmented<ItemType> label="Item type" value={type} onChange={(t) => { setType(t); if (t === 'med' && petIds.length > 1) setPetIds(petIds.slice(0, 1)) }}
            options={[{ id: 'food', label: 'Food' }, { id: 'med', label: 'Medication' }, { id: 'supply', label: 'Supply' }]} />
        )}

        <div className="field">
          <label htmlFor="sn">Name</label>
          <input id="sn" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
            placeholder={isMed ? 'e.g. Joint supplement' : isFood ? 'e.g. Dog kibble 12 kg' : 'e.g. Cat litter 10 L'} required />
        </div>

        <div className="field">
          <span className="label">{isMed ? 'For' : isFood ? 'Who eats it' : 'Used for'}</span>
          {myPets.length === 0 ? <div className="hint">Add a pet first.</div> : (
            <div className="chips" role="group" aria-label="Pets">
              {myPets.map((p) => (
                <button key={p.id} type="button" className={'chip' + (petIds.includes(p.id) ? ' on' : '')} aria-pressed={petIds.includes(p.id)} onClick={() => togglePet(p.id)} style={{ minHeight: 44, fontSize: 14 }}>{p.name}</button>
              ))}
            </div>
          )}
        </div>

        {isMed && (
          <>
            <div className="field">
              <span className="label">Form</span>
              <Chips<MedForm> label="Form" dark value={form} onChange={setForm}
                options={[{ id: 'tablet', label: 'Tablet' }, { id: 'chew', label: 'Chew' }, { id: 'capsule', label: 'Capsule' }, { id: 'sachet', label: 'Sachet' }, { id: 'dose', label: 'Liquid / drops' }]} />
            </div>
            <div className="field">
              <span className="label">How often</span>
              <Chips<Frequency> label="How often" dark value={freq} onChange={setFreq}
                options={[{ id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' }, { id: 'as_needed', label: 'As needed' }]} />
            </div>
            <div className="row">
              <label htmlFor="sd" className="grow" style={{ fontSize: 14 }}>{unitCap} per dose</label>
              <input id="sd" className="input num" inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} />
            </div>
            {freq === 'daily' && (
              <>
                <div className="row between">
                  <span style={{ fontSize: 14 }}>Times a day</span>
                  <div className="stepper">
                    <button type="button" aria-label="Fewer times a day" onClick={() => setTimesCount(Math.max(1, times.length - 1))}>−</button>
                    <span>{times.length}×</span>
                    <button type="button" aria-label="More times a day" onClick={() => setTimesCount(Math.min(4, times.length + 1))}>+</button>
                  </div>
                </div>
                <div className="grid2" style={{ gap: 10 }}>
                  {times.map((t, i) => (
                    <div className="field" key={i}>
                      <label htmlFor={`t${i}`} className="small" style={{ fontWeight: 600 }}>Dose {i + 1}</label>
                      <input id={`t${i}`} className="input" type="time" value={t} onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))} required />
                    </div>
                  ))}
                </div>
              </>
            )}
            {freq !== 'as_needed' && (
              <div className="field">
                <label htmlFor="ss">{freq === 'daily' ? 'Starts on' : 'Next dose on'}</label>
                <input id="ss" className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                {freq === 'weekly' && <div className="hint">Every {WEEKDAYS[start.getDay()]}.</div>}
                {freq === 'monthly' && <div className="hint">On the {ordinal(start.getDate())} of each month.</div>}
              </div>
            )}
            <div className="grid2" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="sb">{unitCap} per box</label><input id="sb" className="input" inputMode="decimal" value={boxSize} onChange={(e) => setBoxSize(e.target.value)} /></div>
              <div className="field"><label htmlFor="sh">You have now</label><input id="sh" className="input" inputMode="decimal" value={onHand} onChange={(e) => setOnHand(e.target.value)} required /></div>
            </div>
            {freq === 'as_needed' && (
              <div className="row">
                <label htmlFor="sa" className="grow" style={{ fontSize: 14 }}>Alert me when this many are left</label>
                <input id="sa" className="input num" inputMode="decimal" value={alertAt} onChange={(e) => setAlertAt(e.target.value)} />
              </div>
            )}
            <div className="field">
              <span className="label">Status</span>
              <Segmented<ItemStatus> label="Status" value={status} onChange={setStatus}
                options={[{ id: 'active', label: 'Active' }, { id: 'paused', label: 'Paused' }, { id: 'finished', label: 'Finished' }]} />
            </div>
            <div className="field">
              <span className="label">Buy from</span>
              <Segmented<'store' | 'vet'> label="Buy from" value={source} onChange={setSource}
                options={[{ id: 'store', label: 'Store' }, { id: 'vet', label: 'Vet (prescription)' }]} />
            </div>
          </>
        )}

        {source === 'store' && (
          <>
            <div className="field">
              <label htmlFor="su">Product link</label>
              <input id="su" className="input" type="url" inputMode="url" value={productUrl} onChange={(e) => setProductUrl(e.target.value)} placeholder="https://www.zooplus.pt/…" />
            </div>
            <div className="field">
              <span className="label">Store</span>
              <Chips<string> label="Store" value={storeId} onChange={setStoreId}
                options={[...stores.map((s) => ({ id: s.id, label: s.name })), { id: '', label: 'Other' }]} />
            </div>
            <div className="field">
              <label htmlFor="sc">Add-to-cart link <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></label>
              <input id="sc" className="input" type="url" inputMode="url" value={cartUrl} onChange={(e) => setCartUrl(e.target.value)} placeholder="Paste if the store gives you one" />
              <div className="hint">If set, “Add to cart” uses this link and skips the product page.</div>
            </div>
          </>
        )}

        {isFood && (
          <>
            <div className="grid2" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="sk">Pack size (kg)</label><input id="sk" className="input" inputMode="decimal" value={packKg} onChange={(e) => setPackKg(e.target.value)} /></div>
              <div className="field"><label htmlFor="sp">Price (€)</label><input id="sp" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            </div>
            {petIds.map((pid) => {
              const p = pets.find((x) => x.id === pid)
              return (
                <div className="row" key={pid}>
                  <label htmlFor={`g-${pid}`} className="grow" style={{ fontSize: 14 }}>{p?.name} eats per day (g)</label>
                  <input id={`g-${pid}`} className="input num" inputMode="numeric" value={grams[pid] ?? ''} onChange={(e) => setGrams({ ...grams, [pid]: e.target.value })} />
                </div>
              )
            })}
          </>
        )}

        {isSupply && (
          <div className="grid2" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="sl">One pack lasts (days)</label><input id="sl" className="input" inputMode="numeric" value={packDays} onChange={(e) => setPackDays(e.target.value)} /></div>
            <div className="field"><label htmlFor="sp2">Price (€)</label><input id="sp2" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          </div>
        )}
        {isMed && source === 'store' && (
          <div className="field" style={{ maxWidth: '50%' }}><label htmlFor="sp3">Price per box (€)</label><input id="sp3" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        )}

        {(isFood || isSupply) && (
          <div className="field">
            <label htmlFor="so">Current pack opened on</label>
            <input id="so" className="input" type="date" value={openedOn} max={todayISO()} onChange={(e) => setOpenedOn(e.target.value)} />
          </div>
        )}

        <div className="row between">
          <div>
            <div className="label">Remind me before it runs out</div>
            <div className="small muted" style={{ marginTop: 2 }}>How long it takes to get more</div>
          </div>
          <div className="stepper">
            <button type="button" aria-label="Fewer days" onClick={() => setLead(Math.max(0, lead - 1))}>−</button>
            <span>{lead} days</span>
            <button type="button" aria-label="More days" onClick={() => setLead(Math.min(30, lead + 1))}>+</button>
          </div>
        </div>

        <section className="summary" aria-live="polite">
          <div className="big">{summary.big}</div>
          <div className="txt">{summary.txt}</div>
        </section>

        <ErrorNote msg={error} />
        <button className="btn block" type="submit" disabled={busy}>{existing ? 'Save changes' : 'Add to stock'}</button>
        {existing && <button type="button" className="btn danger block" onClick={remove} disabled={busy}>Delete</button>}
      </form>
    </div>
  )
}
