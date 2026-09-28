import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../lib/store'
import { errMsg } from '../lib/supabase'
import { fmtShort } from '../lib/dates'
import { daysText, fmtNum, foodGramsPerDay, itemInfo, scheduleText, unitFor } from '../lib/calc'
import { refill } from '../lib/actions'
import type { ItemType, StockItem } from '../lib/types'
import { Bar, Chips, Empty, ErrorNote, ItemThumb, OwnerSwitch, Screen } from '../components/ui'
import { IconCart, IconChevron, IconPlus } from '../components/icons'

type TypeFilter = 'all' | ItemType

export default function Stock() {
  const app = useApp()
  const { items, stores, userId, showOwner, petById, nameOf, reload, error } = app
  const [type, setType] = useState<TypeFilter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

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
    if (it.type === 'food') {
      const g = foodGramsPerDay(it)
      return [pets, g ? `${fmtNum(g)} g/day` : null].filter(Boolean).join(' · ')
    }
    return [pets, it.pack_days ? `1 pack every ~${it.pack_days} days` : null].filter(Boolean).join(' · ')
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
            {isMed && info.countNow != null && (
              <div className="row between" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }}>
                <span className="small tabular" style={{ fontWeight: 600 }}>{fmtNum(info.countNow)}{it.box_size ? ` of ${fmtNum(Number(it.box_size))}` : ''} {unitFor(it)} left</span>
                <span className="badge pill good">{it.frequency === 'as_needed' ? 'As needed' : 'Active'}{it.source === 'vet' ? ' · Rx' : ''}</span>
              </div>
            )}
            {info.daysLeft != null ? (
              <div>
                {info.pct != null && <Bar pct={info.pct} urgent={info.urgent} label={`${info.daysLeft} days remaining`} />}
                <div className="row between" style={{ marginTop: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }} className={info.urgent ? 'warn-text' : ''}>{daysText(info.daysLeft)}</span>
                  {info.orderIn != null && <span className="small muted">{info.orderIn <= 0 ? 'Order today' : `Order by ${fmtShort(info.orderBy!)}`}</span>}
                </div>
              </div>
            ) : isMed && it.frequency === 'as_needed' ? (
              <div className={'small ' + (info.lowAsNeeded ? 'warn-text' : 'muted')}>{info.lowAsNeeded ? 'Running low. ' : ''}Given only when needed, so there's no countdown. Alert at {fmtNum(Number(it.alert_at ?? 2))} left.</div>
            ) : (
              <div className="small muted">Add {it.type === 'food' ? 'pack size and daily amounts' : it.type === 'supply' ? 'how long a pack lasts' : 'the dose and schedule'} to see days left.</div>
            )}
            <div className="row" style={{ gap: 8 }}>
              {mine ? (
                <button className="btn ghost small" disabled={busy === it.id || (isMed && !it.box_size)} onClick={() => doRefill(it)}>
                  {isMed ? 'Refilled +1 box' : 'New pack opened'}
                </button>
              ) : <span className="owner-tag">{nameOf(it.owner_id)}'s</span>}
              {it.in_cart && <span className="badge good">{it.ordered_at ? 'Ordered' : 'In cart'}</span>}
            </div>
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
