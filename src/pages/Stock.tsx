import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../lib/store'
import { errMsg } from '../lib/supabase'
import { fmtShort } from '../lib/dates'
import { daysText, expiryText, expiryWarn, fmtKg, fmtNum, foodGramsPerDay, isUnitFood, itemInfo, scheduleText, showExpiry, unitFor, unitRateText, unitWord } from '../lib/calc'
import { refill, setFoodLeft } from '../lib/actions'
import type { ItemType, StockItem } from '../lib/types'
import { Bar, Chips, Empty, ErrorNote, InfoTip, ItemThumb, OwnerSwitch, Screen } from '../components/ui'
import { UnitFood } from '../components/UnitFood'
import { IconCart, IconChevron, IconPlus } from '../components/icons'

type TypeFilter = 'all' | ItemType

export default function Stock() {
  const app = useApp()
  const { items, stores, userId, showOwner, petById, nameOf, reload, error } = app
  const [type, setType] = useState<TypeFilter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [amount, setAmount] = useState('')

  const visible = items.filter((it) => showOwner(it.owner_id))
  const active = visible.filter((it) => it.status === 'active')
  const counts = { all: active.length, food: 0, med: 0, supply: 0 } as Record<TypeFilter, number>
  active.forEach((it) => { counts[it.type] += 1 })

  const list = useMemo(() => active
    .filter((it) => type === 'all' || it.type === type)
    .map((it) => ({ it, info: itemInfo(it) }))
    .sort((a, b) => (a.info.daysLeft ?? (a.info.lowAsNeeded ? -1 : 9999)) - (b.info.daysLeft ?? (b.info.lowAsNeeded ? -1 : 9999))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [items, type, app.filter])
  const inactive = visible.filter((it) => it.status !== 'active' && (type === 'all' || it.type === type))
  const due = list.filter((x) => x.info.due).length

  const petNames = (it: StockItem) => it.stock_item_pets.map((p) => petById(p.pet_id)?.name).filter(Boolean).join(' & ')
  const storeName = (it: StockItem) => it.source === 'vet' ? 'Vet · Rx' : stores.find((s) => s.id === it.store_id)?.name ?? ''
  const detail = (it: StockItem) => {
    const pets = petNames(it)
    if (it.type === 'med') return [pets, scheduleText(it)].filter(Boolean).join(' · ')
    if (isUnitFood(it)) return [pets, unitRateText(it.unit_label, it.unit_days)].filter(Boolean).join(' · ')
    if (it.type === 'food') {
      const g = foodGramsPerDay(it)
      return [pets, g ? `${fmtNum(g)} g/day` : null].filter(Boolean).join(' · ')
    }
    return [pets, it.pack_days ? `1 pack every ~${it.pack_days} days` : null].filter(Boolean).join(' · ')
  }

  async function saveAmount(it: StockItem) {
    const kg = parseFloat(amount.replace(',', '.'))
    if (!Number.isFinite(kg) || kg < 0) { setErr('Type how many kg are left, e.g. 4.35'); return }
    setBusy(it.id); setErr(null)
    const r = await setFoodLeft(it, kg)
    if (r.error) setErr(errMsg(r.error))
    await reload()
    setBusy(null); setEditing(null)
  }

  async function doRefill(it: StockItem) {
    setBusy(it.id); setErr(null)
    const r = await refill(it)
    if (r.error) setErr(errMsg(r.error))
    await reload()
    setBusy(null)
  }

  return (
    <Screen>
      <header className="row between">
        <div>
          <h1 className="title">Stock</h1>
          <div className="sub">Food, meds and supplies · what runs out first</div>
        </div>
        <Link to="/stock/new" className="icon-btn" aria-label="Add to stock"><IconPlus size={20} /></Link>
      </header>
      <OwnerSwitch />
      <Chips<TypeFilter> label="Type" value={type} onChange={setType} dark scroll
          options={[
            { id: 'all', label: `All · ${counts.all}` }, { id: 'food', label: `Food · ${counts.food}` },
            { id: 'med', label: `Meds · ${counts.med}` }, { id: 'supply', label: `Supplies · ${counts.supply}` }
          ]} />
      <ErrorNote msg={error || err} />

      {due > 0 && (
        <Link to="/shop" className="banner">
          <IconCart size={22} />
          <div className="grow"><div style={{ fontSize: 15, fontWeight: 700 }}>{due} {due === 1 ? 'item' : 'items'} to order this week</div><div className="small" style={{ opacity: 0.8, marginTop: 2 }}>Build the cart, store by store</div></div>
          <IconChevron size={18} />
        </Link>
      )}

      {visible.length === 0 && (
        <Empty title="Nothing in stock yet">
          <div className="hint">Add food, medication or supplies. OurPets works out how many days each one lasts and reminds you before it runs out.</div>
          <Link to="/stock/new" className="btn" style={{ alignSelf: 'flex-start' }}>Add to stock</Link>
        </Empty>
      )}

      {list.map(({ it, info }) => {
        const mine = it.owner_id === userId
        const isMed = it.type === 'med'
        return (
          <article key={it.id} className="card pad stack" style={{ gap: 10 }}>
            <Link to={`/stock/${it.id}`} className="row" style={{ alignItems: 'flex-start', textDecoration: 'none', color: 'inherit' }}>
              <ItemThumb type={it.type} src={app.photoUrl(it.photo_path)} size={it.photo_path ? 52 : 36} />
              <div className="grow"><h2 className="h">{it.name}</h2><div className="row-sub">{detail(it)}</div></div>
              {storeName(it) && <span className="badge">{storeName(it)}</span>}
            </Link>
            {isUnitFood(it) && <UnitFood item={it} info={info} mine={mine} reload={reload} />}
            {it.type === 'food' && !isUnitFood(it) && info.kgNow != null && (
              <div className="row between" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
                <span className="small tabular" style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}>≈ {fmtKg(info.kgNow)}{it.pack_kg ? ` of ${fmtKg(Number(it.pack_kg))}` : ''} kg left
                  <InfoTip label="How the kg left is worked out">An estimate: the last amount you entered minus what your pets eat each day since then. Tap “Update amount” after weighing the bag to correct it.</InfoTip>
                </span>
                {it.left_counted_at && <span className="small muted">counted {fmtShort(it.left_counted_at.slice(0, 10))}</span>}
              </div>
            )}
            {isMed && info.countNow != null && (
              <div className="row between" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
                <span className="small tabular" style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}>{fmtNum(info.countNow)}{it.box_size ? ` of ${fmtNum(Number(it.box_size))}` : ''} {unitFor(it)} left
                  {it.frequency !== 'as_needed' && <InfoTip label="How the count is worked out">Your last count minus every scheduled dose since then. Edit the item to type a new count if it's off.</InfoTip>}
                </span>
                <span className="badge pill good">{it.frequency === 'as_needed' ? 'As needed' : 'Active'}{it.source === 'vet' ? ' · Rx' : ''}</span>
              </div>
            )}
            {info.daysLeft != null ? (
              <div>
                {info.pct != null && <Bar pct={info.pct} urgent={info.urgent} label={`${info.daysLeft} days remaining`} />}
                <div className="row between" style={{ marginTop: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }} className={info.urgent ? 'warn-text' : ''}>{daysText(info.daysLeft)}</span>
                  {info.orderIn != null && (
                    <span className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>{info.orderIn <= 0 ? 'Order today' : `Order by ${fmtShort(info.orderBy!)}`}
                      <InfoTip label="About the order date">The day it runs out, minus the {it.lead_days} {it.lead_days === 1 ? 'day' : 'days'} you said it takes to get more. From a week before, it shows up in the Shop tab.</InfoTip>
                    </span>
                  )}
                </div>
              </div>
            ) : isMed && it.frequency === 'as_needed' ? (
              <div className={'small ' + (info.lowAsNeeded ? 'warn-text' : 'muted')}>{info.lowAsNeeded ? 'Running low. ' : ''}Given only when needed, so there's no countdown. Alert at {fmtNum(Number(it.alert_at ?? 2))} left.</div>
            ) : (
              <div className="small muted">Add {isUnitFood(it) ? `${unitWord(it.unit_label)} per pack and how long one lasts` : it.type === 'food' ? 'pack size and daily amounts' : it.type === 'supply' ? 'how long a pack lasts' : 'the dose and schedule'} to see days left.</div>
            )}
            {showExpiry(info) && (
              <div className={'small ' + (expiryWarn(info) ? 'warn-text' : 'muted')} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontWeight: expiryWarn(info) ? 600 : 400 }}>
                {expiryText(info, it.expires_on)}
                <InfoTip label="About the expiry date">From the “Expires on” date saved on this item{info.expiresFirst ? '. At the current rate it runs out after that date, so part of it may go to waste' : ''}. When a new {it.type === 'med' ? 'box' : 'pack'} arrives, edit the item to update the date.</InfoTip>
              </div>
            )}
            {editing === it.id && (
              <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void saveAmount(it) }}>
                <label htmlFor={`amt-${it.id}`} className="visually-hidden">Kg left now</label>
                <input id={`amt-${it.id}`} className="input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Kg left, e.g. 4.35" />
                <button className="btn small" style={{ minHeight: 46, flexShrink: 0 }} type="submit" disabled={busy === it.id}>Save</button>
                <button className="btn ghost small" style={{ minHeight: 46, flexShrink: 0 }} type="button" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            )}
            {(!isUnitFood(it) || !mine || it.in_cart) && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {mine ? (isUnitFood(it) ? null : (
                <>
                  <button className="btn ghost small" disabled={busy === it.id || (isMed && !it.box_size)} onClick={() => doRefill(it)}>
                    {isMed ? 'Refilled +1 box' : 'New pack opened'}
                  </button>
                  {it.type === 'food' && editing !== it.id && (
                    <button className="btn ghost small" onClick={() => { setEditing(it.id); setAmount(info.kgNow != null ? String(info.kgNow) : '') }}>Update amount</button>
                  )}
                </>
              )) : <span className="owner-tag">{nameOf(it.owner_id)}'s</span>}
              {it.in_cart && <span className="badge good">{it.ordered_at ? 'Ordered' : 'In cart'}</span>}
            </div>}
          </article>
        )
      })}

      {inactive.length > 0 && (
        <section className="stack-sm" style={{ marginTop: 4 }}>
          <h2 className="section-label">Paused &amp; finished</h2>
          {inactive.map((it) => (
            <Link key={it.id} to={`/stock/${it.id}`} className="card pad row" style={{ background: 'var(--surface-2)', textDecoration: 'none', color: 'inherit' }}>
              <div className="grow"><div className="row-title">{it.name}</div><div className="row-sub">{detail(it)}</div></div>
              <span className="badge pill grey">{it.status === 'paused' ? 'Paused' : 'Finished'}</span>
            </Link>
          ))}
        </section>
      )}
    </Screen>
  )
}
