import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../lib/store'
import { errMsg } from '../lib/supabase'
import { fmtShort } from '../lib/dates'
import { daysShort, daysText, expiryText, expiryTone, fmtKg, fmtNum, foodGramsPerDay, isUnitFood, itemInfo, orderText, scheduleText, showExpiry, stockTone, unitFor, unitRateText, unitWord, type ItemInfo } from '../lib/calc'
import { refill, setFoodLeft } from '../lib/actions'
import type { ItemType, StockItem } from '../lib/types'
import { Bar, Chips, Collapse, Meta, Empty, ErrorNote, InfoTip, ItemThumb, OwnerSwitch, PetDot, petTint, Screen, ToneBadge, haptic } from '../components/ui'
import { UnitFood } from '../components/UnitFood'
import { IconCart, IconChevron, IconPlus } from '../components/icons'

type TypeFilter = 'all' | ItemType

export default function Stock() {
  const app = useApp()
  const { items, pets, stores, userId, showOwner, petById, petColor, nameOf, reload, error } = app
  const [type, setType] = useState<TypeFilter>('all')
  const [petF, setPetF] = useState<string>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [amount, setAmount] = useState('')

  const visible = items.filter((it) => showOwner(it.owner_id))
  const active = visible.filter((it) => it.status === 'active')
  const counts = { all: active.length, food: 0, med: 0, supply: 0 } as Record<TypeFilter, number>
  active.forEach((it) => { counts[it.type] += 1 })
  const shownPets = pets.filter((p) => showOwner(p.owner_id) && active.some((it) => it.stock_item_pets.some((sp) => sp.pet_id === p.id)))
  const manyPets = shownPets.length > 1
  const pet = manyPets ? petF : 'all'
  const matches = (it: StockItem) => (type === 'all' || it.type === type) && (pet === 'all' || it.stock_item_pets.some((sp) => sp.pet_id === pet))

  const list = useMemo(() => active
    .filter(matches)
    .map((it) => ({ it, info: itemInfo(it) }))
    .sort((a, b) => (a.info.daysLeft ?? (a.info.lowAsNeeded ? -1 : 9999)) - (b.info.daysLeft ?? (b.info.lowAsNeeded ? -1 : 9999))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [items, type, pet, app.filter])
  const inactive = visible.filter((it) => it.status !== 'active' && matches(it))
  const dueList = list.filter((x) => x.info.due)
  const restList = list.filter((x) => !x.info.due)

  const petIds = (it: StockItem) => it.stock_item_pets.map((p) => p.pet_id)
  const petNames = (it: StockItem) => petIds(it).map((id) => petById(id)?.name).filter(Boolean).join(' & ')
  const storeName = (it: StockItem) => it.source === 'vet' ? 'Vet · Rx' : stores.find((s) => s.id === it.store_id)?.name ?? ''
  const rate = (it: StockItem) => {
    if (it.type === 'med') return scheduleText(it)
    if (isUnitFood(it)) return unitRateText(it.unit_label, it.unit_days)
    if (it.type === 'food') { const g = foodGramsPerDay(it); return g ? `${fmtNum(g)} g/day` : '' }
    return it.pack_days ? `1 pack every ~${it.pack_days} days` : ''
  }
  /** One short "how much is left" figure for the collapsed row. */
  const amountText = (it: StockItem, info: ItemInfo) => {
    if (it.type === 'med' && info.countNow != null) return `${fmtNum(info.countNow)}${it.box_size ? `/${fmtNum(Number(it.box_size))}` : ''} ${unitFor(it, info.countNow)}`
    if (isUnitFood(it) && info.units) return `${fmtNum(info.units.unopened)} ${unitWord(it.unit_label, info.units.unopened)} unopened`
    if (it.type === 'food' && info.kgNow != null) return `≈ ${fmtKg(info.kgNow)} kg`
    return rate(it)
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
    haptic(15)
    const r = await refill(it)
    if (r.error) setErr(errMsg(r.error))
    await reload()
    setBusy(null)
  }

  const row = ({ it, info }: { it: StockItem; info: ItemInfo }) => {
    const mine = it.owner_id === userId
    const isMed = it.type === 'med'
    const isOpen = open === it.id
    const tone = stockTone(info)
    const order = orderText(info)
    const ids = petIds(it)
    const moreId = 'more-' + it.id
    const exp = showExpiry(info) && expiryTone(info) !== 'ok'
    return (
      <div key={it.id} className="stock-item" style={manyPets ? petTint(ids.map(petColor)) : undefined}>
        <button type="button" className="stock-row" aria-expanded={isOpen} aria-controls={moreId} onClick={() => setOpen(isOpen ? null : it.id)}>
          <ItemThumb type={it.type} src={app.photoUrl(it.photo_path)} />
          <div className="grow">
            <div className="row-title">{it.name}</div>
            {info.pct != null && <Bar thin pct={info.pct} tone={tone} label={`${info.daysLeft} days remaining`} />}
            <Meta parts={[
              manyPets && pet === 'all' && ids.length > 0 && petNames(it),
              !mine && <span className="owner-tag">{nameOf(it.owner_id)}'s</span>,
              // Days left is already in the badge and bar; the count only shows here when there's no countdown (open the row for it).
              info.daysLeft == null && <span className="tabular">{amountText(it, info)}</span>,
              it.in_cart ? <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{it.ordered_at ? 'Ordered' : 'In cart'}</span>
                : order && tone !== 'ok' && <span className={'tone-text-' + tone}>{order}</span>,
              exp && <span className={'tone-text-' + expiryTone(info)}>{expiryText(info, it.expires_on)}</span>
            ]} />
          </div>
          <div className="stock-right">
            {info.daysLeft != null ? <ToneBadge tone={tone}>{daysShort(info.daysLeft)}</ToneBadge>
              : isMed && it.frequency === 'as_needed' ? <ToneBadge tone={info.lowAsNeeded ? 'soon' : 'ok'}>{info.lowAsNeeded ? 'Low' : 'As needed'}</ToneBadge>
              : <ToneBadge tone="ok">—</ToneBadge>}
          </div>
          <IconChevron size={16} className={'chev' + (isOpen ? ' open' : '')} />
        </button>

        <Collapse open={isOpen} id={moreId}>
          <div className="stock-more">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {rate(it) && <span className="small muted grow">{rate(it)}</span>}
              {storeName(it) && <span className="badge">{storeName(it)}</span>}
            </div>

            {isMed && info.countNow != null && (
              <div className="kv"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Left
                {it.frequency !== 'as_needed' && <InfoTip label="How the count is worked out">Your last count minus every scheduled dose since then. Edit the item to type a new count if it's off.</InfoTip>}</span>
                <span className="tabular">{fmtNum(info.countNow)}{it.box_size ? ` of ${fmtNum(Number(it.box_size))}` : ''} {unitFor(it)}</span></div>
            )}
            {it.type === 'food' && !isUnitFood(it) && info.kgNow != null && (
              <div className="kv"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Left
                <InfoTip label="How the kg left is worked out">An estimate: the last amount you entered minus what your pets eat each day since then. Tap “Update amount” after weighing the bag to correct it.</InfoTip></span>
                <span className="tabular">≈ {fmtKg(info.kgNow)}{it.pack_kg ? ` of ${fmtKg(Number(it.pack_kg))}` : ''} kg{it.left_counted_at ? ` · counted ${fmtShort(it.left_counted_at.slice(0, 10))}` : ''}</span></div>
            )}
            {info.daysLeft != null && (
              <div className="kv"><span>Runs out</span><span className={'tone-text-' + tone}>{daysText(info.daysLeft).replace('About ', '')}</span></div>
            )}
            {order && (
              <div className="kv"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Order
                <InfoTip label="About the order date">The day it runs out, minus the {it.lead_days} {it.lead_days === 1 ? 'day' : 'days'} you said it takes to get more. From a week before, it shows up in the Shop tab.</InfoTip></span>
                <span className={'tone-text-' + tone}>{order.replace('Order ', '').replace(/^by /, '')}</span></div>
            )}
            {showExpiry(info) && (
              <div className="kv"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Expiry
                <InfoTip label="About the expiry date">From the “Expires on” date saved on this item{info.expiresFirst ? '. At the current rate it runs out after that date, so part of it may go to waste' : ''}. When a new {isMed ? 'box' : 'pack'} arrives, edit the item to update the date.</InfoTip></span>
                <span className={'tone-text-' + expiryTone(info)}>{expiryText(info, it.expires_on)}</span></div>
            )}
            {isMed && it.frequency === 'as_needed' && (
              <div className={'small ' + (info.lowAsNeeded ? 'warn-text' : 'muted')}>{info.lowAsNeeded ? 'Running low. ' : ''}Given only when needed, so there's no countdown. Alert at {fmtNum(Number(it.alert_at ?? 2))} left.</div>
            )}
            {info.daysLeft == null && !(isMed && it.frequency === 'as_needed') && (
              <div className="small muted">Add {isUnitFood(it) ? `${unitWord(it.unit_label)} per pack and how long one lasts` : it.type === 'food' ? 'pack size and daily amounts' : it.type === 'supply' ? 'how long a pack lasts' : 'the dose and schedule'} to see days left.</div>
            )}

            {isUnitFood(it) && <UnitFood item={it} info={info} mine={mine} reload={reload} />}

            {editing === it.id && (
              <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void saveAmount(it) }}>
                <label htmlFor={`amt-${it.id}`} className="visually-hidden">Kg left now</label>
                <input id={`amt-${it.id}`} className="input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Kg left, e.g. 4.35" />
                <button className="btn small" style={{ minHeight: 46, flexShrink: 0 }} type="submit" disabled={busy === it.id}>Save</button>
                <button className="btn ghost small" style={{ minHeight: 46, flexShrink: 0 }} type="button" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            )}

            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {mine && !isUnitFood(it) && (
                <>
                  <button className="btn ghost small" disabled={busy === it.id || (isMed && !it.box_size)} onClick={() => doRefill(it)}>
                    {isMed ? 'Refilled +1 box' : 'New pack opened'}
                  </button>
                  {it.type === 'food' && editing !== it.id && (
                    <button className="btn ghost small" onClick={() => { setEditing(it.id); setAmount(info.kgNow != null ? String(info.kgNow) : '') }}>Update amount</button>
                  )}
                </>
              )}
              <Link to={`/stock/${it.id}`} className="btn ghost small">Details</Link>
            </div>
          </div>
        </Collapse>
      </div>
    )
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
      {manyPets && (
        <div className="chips scroll pets" role="group" aria-label="Pet">
          <button type="button" aria-pressed={pet === 'all'} className={'chip' + (pet === 'all' ? ' on' : '')} onClick={() => setPetF('all')}>All pets</button>
          {shownPets.map((p) => (
            <button key={p.id} type="button" aria-pressed={pet === p.id} className={'chip' + (pet === p.id ? ' on' : '')} onClick={() => setPetF(p.id)}>
              <PetDot color={petColor(p.id)} />{p.name}
            </button>
          ))}
        </div>
      )}
      <ErrorNote msg={error || err} />

      {visible.length === 0 && (
        <Empty title="Nothing in stock yet">
          <div className="hint">Add food, medication or supplies. OurPets works out how many days each one lasts and reminds you before it runs out.</div>
          <Link to="/stock/new" className="btn" style={{ alignSelf: 'flex-start' }}>Add to stock</Link>
        </Empty>
      )}

      {dueList.length > 0 && (
        <section className="stack-sm" aria-labelledby="due-h">
          <div className="row between" style={{ margin: '4px 4px 0' }}>
            <h2 id="due-h" className="section-label" style={{ margin: 0 }}>Order this week · {dueList.length}</h2>
            <Link to="/shop" className="small" style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 32 }}><IconCart size={16} />Build cart</Link>
          </div>
          <div className="card">{dueList.map(row)}</div>
        </section>
      )}

      {restList.length > 0 && (
        <section className="stack-sm" aria-labelledby="ok-h">
          <h2 id="ok-h" className="section-label">{dueList.length ? 'Stocked' : 'All stocked'}</h2>
          <div className="card">{restList.map(row)}</div>
        </section>
      )}

      {inactive.length > 0 && (
        <section className="stack-sm" style={{ marginTop: 4 }}>
          <h2 className="section-label">Paused &amp; finished</h2>
          <div className="card">
            {inactive.map((it) => (
              <Link key={it.id} to={`/stock/${it.id}`} className="card-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="grow"><div className="row-title" style={{ color: 'var(--muted)' }}>{it.name}</div><div className="row-sub">{[petNames(it), rate(it)].filter(Boolean).join(' · ')}</div></div>
                <span className="badge pill grey">{it.status === 'paused' ? 'Paused' : 'Finished'}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </Screen>
  )
}
