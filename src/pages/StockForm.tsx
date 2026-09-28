import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg } from '../lib/supabase'
import { addDays, daysBetween, fmtShort, parseISO, toISO, todayISO } from '../lib/dates'
import { UNIT_PLURAL, fmtKg, fmtNum, itemInfo, medCourse, ordinal, unitRateSuggestion, unitRateText, unitState, unitWord } from '../lib/calc'
import type { Frequency, ItemStatus, ItemType, MedForm, StockItem, TrackBy, UnitLabel } from '../lib/types'
import { removePhoto, signPhotos, uploadPhoto } from '../lib/photos'
import { looksLikeUrl, lookupProduct, type LookupResult, type LookupVariant } from '../lib/lookup'
import { Chips, ErrorNote, FieldLabel, InfoTip, PhotoPicker, Segmented, Toggle, useGoBack } from '../components/ui'
import { ItemPurchases } from '../components/ItemPurchases'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DEFAULT_TIMES = ['08:00', '20:00', '14:00', '23:00']
const COURSE_PRESETS = [5, 7, 10, 14]
const RATE_PRESETS = [{ days: 0.5, label: '2 a day' }, { days: 1, label: '1 a day' }, { days: 2, label: '½ a day' }, { days: 3, label: '⅓ a day' }]

/** A date from the form → a timestamp: now if it's today, otherwise that day at the current time of day. */
function openedAtFromDate(iso: string): string {
  const now = new Date()
  if (!iso || iso >= todayISO()) return now.toISOString()
  const d = parseISO(iso)
  d.setHours(now.getHours(), now.getMinutes(), 0, 0)
  return d.toISOString()
}

export default function StockForm() {
  const { id } = useParams()
  const [qs] = useSearchParams()
  const nav = useNavigate()
  const goBack = useGoBack('/stock')
  const { items, pets, stores, userId, household, reload, nameOf, photoUrl } = useApp()
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
  const [leftKg, setLeftKg] = useState('')
  const [leftInitial, setLeftInitial] = useState('')
  // food tracked by units (cans, pouches…)
  const [trackBy, setTrackBy] = useState<TrackBy>('weight')
  const [unitLabel, setUnitLabel] = useState<UnitLabel>('can')
  const [packUnits, setPackUnits] = useState('')
  const [unitDays, setUnitDays] = useState('')
  const [unitDaysInitial, setUnitDaysInitial] = useState('')
  const [unitsLeft, setUnitsLeft] = useState('')
  const [unitsLeftInitial, setUnitsLeftInitial] = useState('')
  const [curOpened, setCurOpened] = useState(todayISO())
  const [curOpenedInitial, setCurOpenedInitial] = useState('')
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
  const [reason, setReason] = useState('')
  const [courseOn, setCourseOn] = useState(false)
  const [endsOn, setEndsOn] = useState('')
  // used now and then (track_by 'count')
  const [count, setCount] = useState('1')
  const [countInitial, setCountInitial] = useState('')
  const [rebuy, setRebuy] = useState(false)
  // expiry
  const [expiresOn, setExpiresOn] = useState('')
  const [openLife, setOpenLife] = useState('')

  const [photo, setPhoto] = useState<File | null>(null)
  const [dropPhoto, setDropPhoto] = useState(false)
  // photo copied from the store by the product lookup
  const [autoPhoto, setAutoPhoto] = useState<{ path: string; url?: string } | null>(null)
  const [looking, setLooking] = useState(false)
  const [lookup, setLookup] = useState<LookupResult | null>(null)
  const [lookedUp, setLookedUp] = useState('')
  const [variantIdx, setVariantIdx] = useState<number | null>(null)
  const [linkTyped, setLinkTyped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!existing) return
    const e = existing
    setType(e.type); setName(e.name); setPetIds(e.stock_item_pets.map((p) => p.pet_id)); setStatus(e.status); setSource(e.source)
    setStoreId(e.store_id ?? ''); setProductUrl(e.product_url ?? ''); setCartUrl(e.cart_url ?? ''); setPrice(e.price != null ? String(e.price) : '')
    setLead(e.lead_days); setPackKg(e.pack_kg != null ? String(e.pack_kg) : ''); setPackDays(e.pack_days != null ? String(e.pack_days) : '')
    setOpenedOn(e.opened_on ?? todayISO())
    setTrackBy(e.track_by ?? 'weight')
    if (e.track_by === 'count') {
      const c = String(Math.max(0, Number(e.on_hand ?? 0)))
      setCount(c); setCountInitial(c); setRebuy(e.rebuy)
    }
    if (e.type === 'food') {
      setUnitLabel(e.unit_label ?? 'can')
      setPackUnits(e.pack_units != null ? String(e.pack_units) : '')
      const ud = e.unit_days != null ? String(Number(e.unit_days)) : ''
      setUnitDays(ud); setUnitDaysInitial(ud)
      if (e.track_by === 'units') {
        const st = unitState(e)
        setUnitsLeft(String(st.unopened)); setUnitsLeftInitial(String(st.unopened))
        const od = st.openedAt ? toISO(st.openedAt) : todayISO()
        setCurOpened(od); setCurOpenedInitial(od)
      }
      const k = itemInfo(e).kgNow
      const v = k != null ? String(Math.round(k * 100) / 100) : ''
      setLeftKg(v); setLeftInitial(v)
    }
    setGrams(Object.fromEntries(e.stock_item_pets.map((p) => [p.pet_id, p.daily_grams != null ? String(p.daily_grams) : ''])))
    setForm(e.form ?? 'tablet'); setDose(e.dose != null ? String(e.dose) : '1'); setFreq(e.frequency ?? 'daily')
    setTimes(e.dose_times?.length ? e.dose_times : ['08:00']); setStartDate(e.start_date ?? todayISO())
    setBoxSize(e.box_size != null ? String(e.box_size) : '')
    const now = e.type === 'med' ? String(itemInfo(e).countNow ?? '') : ''
    setOnHand(now); setOnHandInitial(now); setAlertAt(e.alert_at != null ? String(e.alert_at) : e.track_by === 'count' ? '1' : '2')
    setCourseOn(!!e.ends_on); setEndsOn(e.ends_on ?? '')
    setExpiresOn(e.expires_on ?? ''); setOpenLife(e.open_life_hours != null ? String(e.open_life_hours) : '')
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

  // Look the product up as soon as a full link is pasted or typed (any keyboard, any paste method)
  useEffect(() => {
    if (!linkTyped || !looksLikeUrl(productUrl) || productUrl.trim() === lookedUp) return
    const t = setTimeout(() => void runLookup(productUrl), 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productUrl, linkTyped])

  const isMed = type === 'med', isFood = type === 'food', isSupply = type === 'supply'
  const unit = UNIT_PLURAL[form]
  const unitCap = unit[0].toUpperCase() + unit.slice(1)
  const byUnits = isFood && trackBy === 'units'
  const byCount = !isMed && trackBy === 'count'
  const byWeight = isFood && trackBy === 'weight'
  const course = isMed && freq !== 'as_needed' && courseOn
  const uOne = unitWord(unitLabel, 1), uMany = unitWord(unitLabel, 2)
  const uManyCap = uMany[0].toUpperCase() + uMany.slice(1)
  const learned = existing && existing.track_by === 'units' ? unitRateSuggestion(existing) : null
  const numOf = (s: string) => { const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : null }
  const medChanged = !!existing && isMed && (
    existing.status !== status || existing.frequency !== freq || Number(existing.dose) !== (numOf(dose) ?? 1)
    || (existing.dose_times ?? []).slice().sort().join() !== (freq === 'daily' ? [...times].sort().join() : ''))
  const lifeH = numOf(openLife) ?? 0
  const unitDaysN = numOf(unitDays) ?? 0

  const summary = useMemo(() => {
    const where = source === 'vet' ? 'vet' : stores.find((s) => s.id === storeId)?.name ?? 'shopping'
    const n = (s: string) => parseFloat(s.replace(',', '.')) || 0
    if (byCount) {
      const c = n(count)
      if (rebuy) return { big: `${fmtNum(c)} left`, txt: `No countdown: tap “Used one up” on Stock when one's finished. When ${fmtNum(n(alertAt))} or fewer are left, it goes on your ${where} list.` }
      return c > 0
        ? { big: `${fmtNum(c)} left · not bought again`, txt: 'No countdown and no reminders. Tap “Used one up” on Stock when one\'s finished; at 0 it moves to Used up and stays in the history. Want one more some day? Use “Add to next order”.' }
        : { big: 'Used up', txt: 'It stays in the history under “Paused & finished”. Set a number above to bring it back.' }
    }
    if (isMed) {
      const d = n(dose), h = n(onHand), b = n(boxSize)
      if (!onHand.trim()) return { big: `How many ${unit} do you have?`, txt: 'Count what\'s in the box now. The app then counts down with each scheduled dose.' }
      const per = freq === 'daily' ? d * times.length : freq === 'weekly' ? d / 7 : freq === 'monthly' ? d / 30 : 0
      if (status !== 'active') return { big: `${fmtNum(h)} ${unit} left`, txt: status === 'paused' ? 'Paused: no countdown and no reminders until you set it back to Active.' : 'Finished: it leaves your stock list and stays in the pet\'s history.' }
      if (freq === 'as_needed' || per <= 0) return { big: `${fmtNum(h)} ${unit} left`, txt: `Given only when needed, so there's no countdown. You'll get an alert when ${fmtNum(n(alertAt))} are left.` }
      const left = Math.floor(h / per)
      if (course && endsOn) {
        const at = new Date().toISOString()
        const c = medCourse({
          type: 'med', status: 'active', frequency: freq, dose: d, dose_times: freq === 'daily' ? times : null,
          start_date: startDate || todayISO(), ends_on: endsOn, on_hand: h, counted_at: at, created_at: at, stock_item_pets: []
        } as unknown as StockItem)
        if (c?.ended) return { big: 'This course is over', txt: 'Its last day has passed, so it moves to Finished. Pick a later last day to keep it going.' }
        if (c?.covered) return { big: `${fmtNum(h)} ${unit} left · enough for the course`, txt: `The rest of the course needs ${fmtNum(c.need)} ${unit} (last dose ${fmtShort(endsOn)}), so there's no reorder reminder. The day after, it moves to Finished and stays in the pet's history.` }
        if (c) return { big: `${fmtNum(c.short)} ${unit} short for the course`, txt: `The rest of the course needs ${fmtNum(c.need)} ${unit} and you have ${fmtNum(h)}. You'll be reminded on ${fmtShort(addDays(todayISO(), Math.max(0, left - lead)))} to get more, and it goes on your ${where} list.` }
      }
      return {
        big: `${fmtNum(h)} ${unit} left · about ${left} days`,
        txt: `${b ? `A new box of ${fmtNum(b)} lasts about ${Math.floor(b / per)} days. ` : ''}You'll be reminded on ${fmtShort(addDays(todayISO(), Math.max(0, left - lead)))} and it goes on your ${where} list.`
      }
    }
    if (isFood && trackBy === 'units') {
      const d = n(unitDays), P = Math.round(n(packUnits))
      const U = unitsLeft.trim() ? Math.round(n(unitsLeft)) : Math.max(0, P - 1)
      if (!d) return { big: `How long does one ${uOne} last?`, txt: `Add how many days one ${uOne} lasts to see when you'll run out.` }
      const e = Math.max(0, daysBetween(curOpened || todayISO(), todayISO()))
      const leftDays = Math.floor(Math.max(0, (U + 1) * d - e))
      const packLasts = P ? Math.floor(P * d) : 0
      const perDay = n(price) && packLasts ? ` That's about €${(n(price) / (P * d)).toFixed(2)} a day.` : ''
      return {
        big: `${U} ${U === 1 ? uOne : uMany} unopened · about ${leftDays} days`,
        txt: `${packLasts ? `A pack of ${P} lasts about ${packLasts} days (${unitRateText(unitLabel, d)}).` : ''}${perDay} You'll be reminded on ${fmtShort(addDays(todayISO(), Math.max(0, leftDays - lead)))} and it goes on your ${where} list.`
      }
    }
    if (isFood) {
      const g = petIds.reduce((s, p) => s + n(grams[p] ?? ''), 0)
      const days = g > 0 ? Math.floor((n(packKg) * 1000) / g) : 0
      if (!days) return { big: 'Pick who eats it', txt: 'Choose at least one pet and a daily amount to see how long a pack lasts.' }
      const perDay = n(price) ? ` That's about €${(n(price) / days).toFixed(2)} a day.` : ''
      const left = leftKg.trim() ? n(leftKg) : n(packKg)
      const leftDays = Math.floor((left * 1000) / g)
      return {
        big: `${fmtKg(left)} kg left · about ${leftDays} days`,
        txt: `A full ${fmtKg(n(packKg))} kg pack lasts about ${days} days.${perDay} You'll be reminded on ${fmtShort(addDays(todayISO(), Math.max(0, leftDays - lead)))} and it goes on your ${where} list.`
      }
    }
    const days = n(packDays)
    return days ? { big: `One pack lasts about ${days} days`, txt: `You'll get a reminder ${lead} days before it runs out and it goes on your ${where} list.` } : { big: 'How long does a pack last?', txt: 'Add the number of days one pack lasts.' }
  }, [byCount, count, rebuy, course, endsOn, startDate, trackBy, unitDays, packUnits, unitsLeft, curOpened, unitLabel, uOne, uMany, leftKg, isMed, isFood, dose, onHand, boxSize, freq, times, status, alertAt, unit, lead, source, storeId, stores, petIds, grams, packKg, price, packDays])

  if (existing && existing.owner_id !== userId) {
    return (
      <div className="login">
        <button className="back" onClick={() => goBack()}>Back</button>
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

  function applyVariant(v: LookupVariant, base: LookupResult) {
    if (v.name) setName(v.name)
    else if (base.name) setName(base.name.includes(v.label) ? base.name : `${base.name.replace(/\s+\d+(?:[.,]\d+)?\s*(?:kg|g)\b.*$/i, '')} ${v.label}`.trim())
    if (v.price != null) setPrice(String(v.price))
    if (v.pack_kg) setPackKg(String(v.pack_kg))
    if (v.pack_units && (type === 'food' || base.type === 'food')) {
      setTrackBy('units'); setPackUnits(String(v.pack_units))
      if (v.unit_label ?? base.unit_label) setUnitLabel((v.unit_label ?? base.unit_label)!)
      if (!existing) setUnitsLeft(String(Math.max(0, v.pack_units - 1)))
    }
    if (v.units) setBoxSize(String(v.units))
    if (v.url) { setLookedUp(v.url); setProductUrl(v.url) }
  }

  async function runLookup(url: string, force = false) {
    const u = url.trim()
    if (!looksLikeUrl(u) || looking || (!force && u === lookedUp)) return
    setLooking(true); setLookup(null); setLookedUp(u)
    const r = await lookupProduct(u)
    setLooking(false)
    setLookup(r)
    if (r.error) return
    const t: ItemType = !existing && r.type ? r.type : type
    if (!existing && r.type) setType(r.type)
    if (r.name) setName(r.name)
    if (r.price != null) setPrice(String(r.price))
    if (t === 'food' && r.pack_kg) setPackKg(String(r.pack_kg))
    if (t === 'food' && r.pack_units) {
      setTrackBy('units'); setPackUnits(String(r.pack_units))
      if (r.unit_label) setUnitLabel(r.unit_label)
      if (!existing && !unitsLeft.trim()) setUnitsLeft(String(Math.max(0, r.pack_units - 1)))
    }
    if (t === 'med') {
      if (r.form) setForm(r.form)
      if (r.units) { setBoxSize(String(r.units)); if (!onHand.trim()) setOnHand(String(r.units)) }
      setSource('store')
    }
    if (r.url && r.url !== u) { setLookedUp(r.url); setProductUrl(r.url) }
    if (r.site) {
      const match = stores.find((s) => r.site!.toLowerCase().includes(s.name.toLowerCase().replace(/\s+/g, '')))
      if (match) setStoreId(match.id)
    }
    if (r.variants?.length) {
      const i = r.selected ?? 0
      setVariantIdx(i)
      if (r.variants[i]) applyVariant(r.variants[i], r)
    } else setVariantIdx(null)
    if (r.photo_path && !photo) {
      const signed = await signPhotos([r.photo_path])
      setAutoPhoto({ path: r.photo_path, url: signed[r.photo_path] })
      setDropPhoto(false)
    }
  }

  async function save(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!name.trim()) { setError('Give it a name.'); return }
    if (!petIds.length) { setError(isMed ? 'Choose which pet it is for.' : 'Choose at least one pet.'); return }
    const num = (s: string) => { const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : null }
    if (byCount && (num(count) == null || num(count)! < 0)) { setError('Type how many you have, e.g. 1.'); return }
    if (course && !endsOn) { setError('Pick the day of the last dose, or choose Ongoing.'); return }
    if (course && endsOn < (startDate || todayISO())) { setError('The last dose can\'t be before the course starts.'); return }
    const row: Partial<StockItem> & Record<string, unknown> = {
      type, name: name.trim(), status, source, lead_days: lead,
      store_id: source === 'store' ? storeId || null : null,
      product_url: source === 'store' ? productUrl.trim() || null : null,
      cart_url: source === 'store' ? cartUrl.trim() || null : null,
      price: num(price)
    }
    if (isFood || isSupply) {
      row.opened_on = isFood ? (existing?.opened_on ?? todayISO()) : openedOn || todayISO()
      if (isFood) {
        row.track_by = trackBy
        row.unit_label = unitLabel
        row.pack_units = Math.round(num(packUnits) ?? 0) || null
        row.unit_days = num(unitDays)
      } else {
        row.track_by = byCount ? 'count' : 'weight'
      }
      if (byCount) {
        const c = Math.max(0, num(count) ?? 0)
        if (!existing || existing.track_by !== 'count' || count !== countInitial) {
          row.on_hand = c
          row.counted_at = new Date().toISOString()
        }
        row.rebuy = rebuy
        row.alert_at = rebuy ? num(alertAt) ?? 1 : null
        // used up and not bought again: Finished ("Used up"); a new count brings it back
        row.status = c > 0 || rebuy ? 'active' : 'finished'
      } else if (existing?.track_by === 'count') {
        row.status = 'active'
      }
      if (isFood && trackBy === 'units') {
        const countChanged = unitsLeft !== unitsLeftInitial || curOpened !== curOpenedInitial
        const wasUnits = existing?.track_by === 'units'
        if (!existing || !wasUnits || countChanged) {
          const P = Math.round(num(packUnits) ?? 0)
          row.units_left = unitsLeft.trim() ? Math.max(0, Math.round(num(unitsLeft) ?? 0)) : Math.max(0, P - 1)
          row.unit_opened_at = openedAtFromDate(curOpened)
        } else if (unitDays !== unitDaysInitial) {
          // new rate applies from now; what was used so far stays
          const st = unitState(existing)
          row.units_left = st.unopened
          row.unit_opened_at = (st.openedAt ?? new Date()).toISOString()
        }
      }
      if (isFood && trackBy === 'weight') {
        const g0 = existing ? existing.stock_item_pets.reduce((a, p) => a + Number(p.daily_grams ?? 0), 0) : -1
        const g1 = petIds.reduce((a, p) => a + (num(grams[p] ?? '') ?? 0), 0)
        const packChanged = existing && String(existing.pack_kg ?? '') !== String(num(packKg) ?? '')
        if (!existing || leftKg !== leftInitial || g0 !== g1 || packChanged) {
          row.left_kg = leftKg.trim() ? num(leftKg) : num(packKg)
          row.left_counted_at = new Date().toISOString()
        }
      }
      row.pack_kg = isFood ? num(packKg) : null
      row.pack_days = isSupply && !byCount ? Math.round(num(packDays) ?? 0) || null : null
    }
    if (isMed) {
      Object.assign(row, {
        form, dose: num(dose) ?? 1, frequency: freq, dose_times: freq === 'daily' ? [...times].sort() : null,
        start_date: startDate || todayISO(), box_size: num(boxSize), alert_at: num(alertAt) ?? 2,
        ends_on: course ? endsOn : null
      })
      if (medChanged && reason.trim()) row.change_reason = reason.trim().slice(0, 300)
      const statusChanged = existing && existing.status !== status
      const scheduleChanged = existing && (existing.frequency !== freq || String(existing.dose) !== String(num(dose)) || (existing.dose_times ?? []).join() !== (freq === 'daily' ? [...times].sort().join() : ''))
      if (!existing || onHand !== onHandInitial || statusChanged || scheduleChanged) {
        row.on_hand = num(onHand) ?? 0
        row.counted_at = new Date().toISOString()
      }
    }
    row.expires_on = expiresOn || null
    row.open_life_hours = isFood && trackBy === 'units' && lifeH > 0 ? Math.round(lifeH) : null
    setBusy(true)
    let photo_path = existing?.photo_path ?? null
    try {
      if (photo && household) photo_path = await uploadPhoto(household.id, 'items', photo)
      else if (dropPhoto) photo_path = null
      else if (autoPhoto) photo_path = autoPhoto.path
    } catch (e) { setBusy(false); setError('Photo upload failed: ' + errMsg(e)); return }
    row.photo_path = photo_path
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
    if (existing?.photo_path && existing.photo_path !== photo_path) void removePhoto(existing.photo_path)
    await reload()
    goBack()
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
          <button type="button" onClick={() => goBack()}>Cancel</button>
          <h1>{existing ? 'Edit item' : 'Add to stock'}</h1>
          <button type="submit" className="strong" disabled={busy}>Save</button>
        </div>

        {!existing && (
          <Segmented<ItemType> label="Item type" value={type} onChange={(t) => { setType(t); if (t === 'med' && petIds.length > 1) setPetIds(petIds.slice(0, 1)) }}
            options={[{ id: 'food', label: 'Food' }, { id: 'med', label: 'Medication' }, { id: 'supply', label: 'Supply' }]} />
        )}

        {source === 'store' && (
          <section className="card pad stack-sm" aria-labelledby="link-h" style={{ background: 'var(--accent-soft)', borderColor: 'transparent' }}>
            <label id="link-h" htmlFor="su" className="label">Product link</label>
            <div className="row" style={{ gap: 8 }}>
              <input id="su" className="input" type="url" inputMode="url" value={productUrl} placeholder="Paste a Zooplus or Newpet link"
                onChange={(e) => { setProductUrl(e.target.value); setLinkTyped(true) }} />
              <button type="button" className="btn small" style={{ minHeight: 46, flexShrink: 0 }} disabled={!looksLikeUrl(productUrl) || looking}
                onClick={() => void runLookup(productUrl, true)}>{looking ? 'Reading…' : 'Fill in'}</button>
            </div>
            {looking && <div className="hint">Reading the store page…</div>}
            {!looking && lookup?.error && <div className="hint" style={{ color: 'var(--warn)' }}>{lookup.error}</div>}
            {!looking && lookup && !lookup.error && (
              <div className="hint">
                Filled in from {lookup.site ?? 'the store'}: {[lookup.name && 'name', (autoPhoto || lookup.photo_path) && 'photo', lookup.price != null && 'price', (lookup.pack_kg || lookup.units || lookup.variants) && 'pack size', !existing && lookup.type && 'type'].filter(Boolean).join(', ') || 'nothing useful, sorry'}. Check it looks right.
              </div>
            )}
            {!looking && !lookup && <div className="hint">Paste the link and the name, photo, price and pack size fill in by themselves.</div>}
            {lookup?.variants && lookup.variants.length > 1 && (
              <div className="stack-sm" style={{ marginTop: 4 }}>
                <span className="label">Which size do you buy?</span>
                <div className="chips" role="group" aria-label="Pack size">
                  {lookup.variants.map((v, i) => (
                    <button key={i} type="button" aria-pressed={variantIdx === i} className={'chip' + (variantIdx === i ? ' on' : '')}
                      onClick={() => { setVariantIdx(i); applyVariant(v, lookup) }}>
                      {v.label}{v.price != null ? ` · €${v.price.toFixed(2)}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <PhotoPicker label="Item photo" round={false} file={photo} current={dropPhoto ? undefined : (autoPhoto?.url ?? photoUrl(existing?.photo_path))}
          onFile={(f) => { setPhoto(f); setDropPhoto(false); setAutoPhoto(null) }} onRemove={() => { setPhoto(null); setDropPhoto(true); setAutoPhoto(null) }} />

        <div className="field">
          <label htmlFor="sn">Name</label>
          <input id="sn" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
            placeholder={isMed ? 'e.g. Joint supplement' : byCount ? (isFood ? 'e.g. Chicken treats' : 'e.g. Flea shampoo') : isFood ? 'e.g. Dog kibble 12 kg' : 'e.g. Cat litter 10 L'} required />
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
            {freq !== 'as_needed' && (
              <div className="field">
                <FieldLabel as="span" tip={<><b>Ongoing</b>: keeps going until you change it, and you're reminded before it runs out.<br /><b>Course</b>: has a last day, like a 10-day antibiotic. No doses after it, no reorder reminder if what you have covers it, and the next day it moves to Finished by itself.</>}>How long</FieldLabel>
                <Segmented<'ongoing' | 'course'> label="How long" value={courseOn ? 'course' : 'ongoing'}
                  onChange={(v) => { setCourseOn(v === 'course'); if (v === 'course' && !endsOn) setEndsOn(addDays(startDate || todayISO(), 6)) }}
                  options={[{ id: 'ongoing', label: 'Ongoing' }, { id: 'course', label: 'Course with an end' }]} />
              </div>
            )}
            {course && (
              <div className="field">
                <label htmlFor="se">Last dose on</label>
                <input id="se" className="input" type="date" value={endsOn} min={startDate || undefined} onChange={(e) => setEndsOn(e.target.value)} />
                {freq === 'daily' && (
                  <div className="chips" role="group" aria-label="Course length">
                    {COURSE_PRESETS.map((d) => {
                      const on = endsOn === addDays(startDate || todayISO(), d - 1)
                      return <button key={d} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setEndsOn(addDays(startDate || todayISO(), d - 1))}>{d} days</button>
                    })}
                  </div>
                )}
                {endsOn && endsOn >= (startDate || todayISO()) && (
                  <div className="hint">{daysBetween(startDate || todayISO(), endsOn) + 1} days, {fmtShort(startDate || todayISO())} to {fmtShort(endsOn)} (both included).</div>
                )}
              </div>
            )}
            <div className="grid2" style={{ gap: 12, alignItems: 'end' }}>
              <div className="field"><label htmlFor="sb">{unitCap} per box</label><input id="sb" className="input" inputMode="decimal" value={boxSize} onChange={(e) => setBoxSize(e.target.value)} /></div>
              <div className="field"><FieldLabel htmlFor="sh" tip={`Count what's in the box right now. The app then takes off each scheduled dose on its own, so you only count again if it drifts.`}>You have now</FieldLabel><input id="sh" className="input" inputMode="decimal" value={onHand} onChange={(e) => setOnHand(e.target.value)} required /></div>
            </div>
            {freq === 'as_needed' && (
              <div className="row">
                <label htmlFor="sa" className="grow" style={{ fontSize: 14 }}>Alert me when this many are left</label>
                <InfoTip label="About as-needed alerts">As-needed meds have no schedule, so there's no countdown. Each dose you log takes one off, and you're alerted at this number.</InfoTip>
                <input id="sa" className="input num" inputMode="decimal" value={alertAt} onChange={(e) => setAlertAt(e.target.value)} />
              </div>
            )}
            <div className="field">
              <FieldLabel as="span" tip={<><b>Active</b>: counts down and reminds you.<br /><b>Paused</b>: a break in treatment; no countdown, no reminders.<br /><b>Finished</b>: leaves the stock list but stays in the pet's history.</>}>Status</FieldLabel>
              <Segmented<ItemStatus> label="Status" value={status} onChange={setStatus}
                options={[{ id: 'active', label: 'Active' }, { id: 'paused', label: 'Paused' }, { id: 'finished', label: 'Finished' }]} />
            </div>
            {medChanged && (
              <div className="field" style={{ padding: 12, borderRadius: 12, background: 'var(--accent-soft)' }}>
                <FieldLabel htmlFor="sr" tip={<>Dose, schedule and status changes are saved in the pet's medication history and Timeline, with the date. A short reason helps later, for example at the next vet visit.<br />The pill count is kept: the app starts counting down at the new dose from now.</>}>Why the change? <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></FieldLabel>
                <input id="sr" className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Vet: kidney values better, lower dose" />
              </div>
            )}
            <div className="field">
              <FieldLabel as="span" tip="Prescription meds come from the vet. In the Shop tab they get “Ask vet” instead of an add-to-cart button.">Buy from</FieldLabel>
              <Segmented<'store' | 'vet'> label="Buy from" value={source} onChange={setSource}
                options={[{ id: 'store', label: 'Store' }, { id: 'vet', label: 'Vet (prescription)' }]} />
            </div>
          </>
        )}

        {source === 'store' && (
          <>
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
          <div className="field">
            <FieldLabel as="span" tip={<>Bags of kibble: <b>by weight</b>. The app uses how many grams each pet eats a day.<br />Cans, pouches or trays you don't weigh: <b>by units</b>. You say how long one lasts, and tap “Opened a new can” when you open one.<br />Treats or a bag you open once in a while: <b>now and then</b>. No countdown, just how many you have; you can say it isn't bought again.</>}>How do you track it?</FieldLabel>
            <Segmented<TrackBy> label="How do you track it?" value={trackBy} onChange={(t) => { setTrackBy(t); if (t === 'count' && !existing) setAlertAt('1') }} tight
              options={[{ id: 'weight', label: 'By weight' }, { id: 'units', label: 'By units' }, { id: 'count', label: 'Now and then' }]} />
          </div>
        )}
        {isSupply && (
          <div className="field">
            <FieldLabel as="span" tip={<><b>Steadily</b>: litter, pads, bags — one pack lasts about the same each time, so the app counts down and reminds you.<br /><b>Now and then</b>: shampoo, a spare leash, a toy — no countdown, just how many you have; you can say it isn't bought again.</>}>How is it used?</FieldLabel>
            <Segmented<'weight' | 'count'> label="How is it used?" value={byCount ? 'count' : 'weight'} onChange={(t) => { setTrackBy(t); if (t === 'count' && !existing) setAlertAt('1') }}
              options={[{ id: 'weight', label: 'Steadily' }, { id: 'count', label: 'Now and then' }]} />
          </div>
        )}

        {byCount && (
          <>
            <div className="grid2" style={{ gap: 12, alignItems: 'end' }}>
              <div className="field">
                <FieldLabel htmlFor="scn" tip="How many you have, the open one included. On Stock, tap “Used one up” when one is finished and “Got one more” when you buy another.">How many you have</FieldLabel>
                <input id="scn" className="input" inputMode="decimal" value={count} onChange={(e) => setCount(e.target.value)} placeholder="e.g. 1" />
              </div>
              <div className="field"><label htmlFor="sp5">Price (€)</label><input id="sp5" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            </div>
            <div className="row between">
              <div>
                <div className="label-row"><span id="rb-l" className="label">Buy it again when it runs low</span>
                  <InfoTip label="About buying again"><b>Off</b>: for things you don't rebuy, like a bag of treats you're trying. When the last one is used up it moves to “Used up”, and nothing reminds you. Its purchases count as one-off in Costs.<br /><b>On</b>: when it gets down to the number below, it goes on your Shopping run and in the morning summary.</InfoTip>
                </div>
                <div className="small muted" style={{ marginTop: 2 }}>{rebuy ? 'Goes on the Shopping run when low' : 'Not bought again when it runs out'}</div>
              </div>
              <Toggle on={rebuy} onChange={setRebuy} labelledBy="rb-l" />
            </div>
            {rebuy && (
              <div className="row">
                <label htmlFor="sa2" className="grow" style={{ fontSize: 14 }}>Remind me when this many are left</label>
                <input id="sa2" className="input num" inputMode="decimal" value={alertAt} onChange={(e) => setAlertAt(e.target.value)} />
              </div>
            )}
          </>
        )}

        {byUnits && (
          <>
            <div className="field">
              <span className="label">What comes in the pack</span>
              <Chips<UnitLabel> label="What comes in the pack" dark value={unitLabel} onChange={setUnitLabel}
                options={[{ id: 'can', label: 'Cans' }, { id: 'pouch', label: 'Pouches' }, { id: 'tray', label: 'Trays' }, { id: 'sachet', label: 'Sachets' }]} />
            </div>
            <div className="grid2" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="su1">{uManyCap} per pack</label><input id="su1" className="input" inputMode="numeric" value={packUnits} onChange={(e) => setPackUnits(e.target.value)} placeholder="e.g. 12" /></div>
              <div className="field"><label htmlFor="sp4">Price per pack (€)</label><input id="sp4" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            </div>
            <div className="field">
              <FieldLabel htmlFor="sud" tip={<>How many days until you open the next {uOne}, for all the pets that eat it together. If they get half a {uOne} a day, that's 2. Fractions like 1.5 are fine.<br />Not sure? Guess. After a few “Opened a new {uOne}” taps, the app tells you the real number.</>}>One {uOne} lasts (days)</FieldLabel>
              <div className="row" style={{ gap: 8 }}>
                <input id="sud" className="input num" inputMode="decimal" value={unitDays} onChange={(e) => setUnitDays(e.target.value)} placeholder="e.g. 2" />
                <div className="chips" role="group" aria-label="Quick picks" style={{ flexWrap: 'wrap' }}>
                  {RATE_PRESETS.map((r) => (
                    <button key={r.days} type="button" className={'chip' + (parseFloat(unitDays.replace(',', '.')) === r.days ? ' on' : '')} aria-pressed={parseFloat(unitDays.replace(',', '.')) === r.days}
                      onClick={() => setUnitDays(String(r.days))}>{r.label}</button>
                  ))}
                </div>
              </div>
              {parseFloat(unitDays.replace(',', '.')) > 0 && <div className="hint">That's {unitRateText(unitLabel, parseFloat(unitDays.replace(',', '.')))}.</div>}
              {learned && (
                <div className="hint row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span>Your last {learned.samples} {uMany} lasted about {fmtNum(learned.days)} days each.</span>
                  <button type="button" className="link-btn" style={{ minHeight: 32, padding: 0 }} onClick={() => setUnitDays(String(learned.days))}>Use {fmtNum(learned.days)}</button>
                </div>
              )}
            </div>
            <div className="grid2" style={{ gap: 12 }}>
              <div className="field">
                <FieldLabel htmlFor="sul" tip={<>Closed {uMany} only; don't count the open one. From here the app takes one off every time a {uOne} should be finished.</>}>Unopened {uMany}</FieldLabel>
                <input id="sul" className="input" inputMode="numeric" value={unitsLeft} onChange={(e) => setUnitsLeft(e.target.value)}
                  placeholder={packUnits ? `e.g. ${Math.max(0, Math.round(parseFloat(packUnits) || 1) - 1)}` : 'e.g. 11'} />
              </div>
              <div className="field">
                <FieldLabel htmlFor="suo" tip={<>When you opened the {uOne} you're using now. The countdown for it starts here.</>}>Current {uOne} opened</FieldLabel>
                <input id="suo" className="input" type="date" value={curOpened} max={todayISO()} onChange={(e) => setCurOpened(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <FieldLabel htmlFor="sol" tip={<>How long an opened {uOne} keeps in the fridge; the label usually says (often 24–48 hours). The app shows a use-by time for the open {uOne} and warns you when it's past it.<br />Leave empty if you don't want this.</>}>Opened {uOne} keeps (hours)</FieldLabel>
              <div className="row" style={{ gap: 8 }}>
                <input id="sol" className="input num" inputMode="numeric" value={openLife} onChange={(e) => setOpenLife(e.target.value)} placeholder="—" />
                <div className="chips" role="group" aria-label="Quick picks">
                  {[24, 48, 72].map((h) => (
                    <button key={h} type="button" className={'chip' + (lifeH === h ? ' on' : '')} aria-pressed={lifeH === h} onClick={() => setOpenLife(lifeH === h ? '' : String(h))}>{h} h</button>
                  ))}
                </div>
              </div>
              {lifeH > 0 && unitDaysN * 24 > lifeH && (
                <div className="hint warn-text">One {uOne} lasts {fmtNum(unitDaysN)} days but keeps {lifeH} hours once open, so part of each {uOne} may go off. Smaller {uMany} would waste less.</div>
              )}
            </div>
          </>
        )}

        {byWeight && (
          <>
            <div className="grid2" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="sk">Pack size (kg)</label><input id="sk" className="input" inputMode="decimal" value={packKg} onChange={(e) => setPackKg(e.target.value)} /></div>
              <div className="field"><label htmlFor="sp">Price (€)</label><input id="sp" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            </div>
            {petIds.map((pid, i) => {
              const p = pets.find((x) => x.id === pid)
              return (
                <div className="row" key={pid}>
                  <label htmlFor={`g-${pid}`} className="grow" style={{ fontSize: 14 }}>{p?.name} eats per day (g)</label>
                  {i === 0 && <InfoTip label="About grams per day">Check the feeding guide on the bag, or weigh one meal and multiply by meals a day. The app uses the total for all pets to count down the bag.</InfoTip>}
                  <input id={`g-${pid}`} className="input num" inputMode="numeric" value={grams[pid] ?? ''} onChange={(e) => setGrams({ ...grams, [pid]: e.target.value })} />
                </div>
              )
            })}
          </>
        )}

        {isSupply && !byCount && (
          <div className="grid2" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="sl">One pack lasts (days)</label><input id="sl" className="input" inputMode="numeric" value={packDays} onChange={(e) => setPackDays(e.target.value)} /></div>
            <div className="field"><label htmlFor="sp2">Price (€)</label><input id="sp2" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          </div>
        )}
        {isMed && (
          <div className="field">
            <label htmlFor="sp3">Price per box (€)</label>
            <input id="sp3" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} style={{ maxWidth: '50%' }} />
            {source === 'vet' && <div className="hint">What the vet charges for a box. Used in Shop and Costs.</div>}
          </div>
        )}

        {byWeight && (
          <div className="field">
            <FieldLabel htmlFor="sleft" tip="Weigh the bag (or guess). The app counts down from this amount using how much your pets eat each day. Change it any time the number drifts.">Left right now (kg)</FieldLabel>
            <div className="row" style={{ gap: 8 }}>
              <input id="sleft" className="input" inputMode="decimal" value={leftKg} onChange={(e) => setLeftKg(e.target.value)}
                placeholder={packKg ? `Full bag · ${packKg} kg` : 'e.g. 4.35'} />
              {packKg && <button type="button" className="btn ghost small" style={{ minHeight: 46, flexShrink: 0 }} onClick={() => setLeftKg(packKg)}>Full bag</button>}
            </div>
            <div className="hint">Weigh the bag or guess. The app counts down from here using how much your pets eat each day.</div>
          </div>
        )}

        {isSupply && !byCount && (
          <div className="field">
            <label htmlFor="so">Current pack opened on</label>
            <input id="so" className="input" type="date" value={openedOn} max={todayISO()} onChange={(e) => setOpenedOn(e.target.value)} />
          </div>
        )}

        <div className="field">
          <FieldLabel htmlFor="sx" tip={<>The expiry or best-before date on the {isMed ? 'box' : 'pack'} you're using now. It shows on Stock and Today when it's close (and in the morning summary), or when it would expire before you finish it.<br />When a new {isMed ? 'box' : 'pack'} arrives, update the date.</>}>Expires on <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></FieldLabel>
          <div className="row" style={{ gap: 8 }}>
            <input id="sx" className="input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            {expiresOn && <button type="button" className="btn ghost small" style={{ minHeight: 46, flexShrink: 0 }} onClick={() => setExpiresOn('')}>Clear</button>}
          </div>
        </div>

        {!byCount && <div className="row between">
          <div>
            <div className="label-row"><span className="label">Remind me before it runs out</span>
              <InfoTip label="About the reminder">How many days an order takes to arrive, plus a margin. The item shows up in the Shop tab that many days before it runs out, and in the week before that as “order soon”.</InfoTip>
            </div>
            <div className="small muted" style={{ marginTop: 2 }}>How long it takes to get more</div>
          </div>
          <div className="stepper">
            <button type="button" aria-label="Fewer days" onClick={() => setLead(Math.max(0, lead - 1))}>−</button>
            <span>{lead} days</span>
            <button type="button" aria-label="More days" onClick={() => setLead(Math.min(30, lead + 1))}>+</button>
          </div>
        </div>}

        <section className="summary" aria-live="polite">
          <div className="big">{summary.big}</div>
          <div className="txt">{summary.txt}</div>
        </section>

        {existing && household && <ItemPurchases item={existing} householdId={household.id} />}

        <ErrorNote msg={error} />
        <button className="btn block" type="submit" disabled={busy}>{existing ? 'Save changes' : 'Add to stock'}</button>
        {existing && <button type="button" className="btn danger block" onClick={remove} disabled={busy}>Delete</button>}
      </form>
    </div>
  )
}
