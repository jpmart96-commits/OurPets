import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg } from '../lib/supabase'
import { fmtShort } from '../lib/dates'
import { euro, fmtNum, itemInfo, type ItemInfo } from '../lib/calc'
import type { StockItem, Store } from '../lib/types'
import { Bar, Empty, ErrorNote, OwnerSwitch, Screen, InfoTip } from '../components/ui'
import { deleteOrder, logOrder, round2 } from '../lib/costs'
import { IconCheck, IconExternal } from '../components/icons'

interface Row { it: StockItem; info: ItemInfo }
interface Group { key: string; name: string; store?: Store; vet: boolean; rows: Row[]; suggestions: Row[] }

export default function Shop() {
  const app = useApp()
  const { items, stores, userId, showOwner, nameOf, reload, error, household } = app
  const [pulled, setPulled] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // the store whose order is being confirmed (quantities + total → Costs)
  const [logging, setLogging] = useState<string | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [total, setTotal] = useState('')

  const groups = useMemo(() => {
    const map = new Map<string, Group>()
    const keyOf = (it: StockItem) => (it.source === 'vet' ? 'vet' : it.store_id ?? 'other')
    const ensure = (it: StockItem) => {
      const key = keyOf(it)
      if (!map.has(key)) {
        const store = stores.find((s) => s.id === it.store_id)
        map.set(key, { key, name: key === 'vet' ? 'Vet (prescription)' : store?.name ?? 'Other', store: key === 'vet' ? undefined : store, vet: key === 'vet', rows: [], suggestions: [] })
      }
      return map.get(key)!
    }
    const all = items.filter((it) => it.status === 'active' && showOwner(it.owner_id)).map((it) => ({ it, info: itemInfo(it) }))
    for (const r of all) {
      if (r.info.due || r.it.in_cart || r.it.ordered_at || pulled.includes(r.it.id)) ensure(r.it).rows.push(r)
    }
    for (const r of all) {
      if (r.info.due || r.it.in_cart || r.it.ordered_at || pulled.includes(r.it.id)) continue
      if (r.it.owner_id !== userId || r.info.orderIn == null || r.info.orderIn > 14) continue
      const g = map.get(keyOf(r.it))
      if (g && !g.vet) g.suggestions.push(r)
    }
    const out = [...map.values()]
    out.forEach((g) => g.rows.sort((a, b) => (a.info.orderIn ?? -1) - (b.info.orderIn ?? -1)))
    return out.sort((a, b) => Number(a.vet) - Number(b.vet) || a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, stores, pulled, app.filter])

  const count = groups.reduce((s, g) => s + g.rows.length, 0)
  const handled = groups.reduce((s, g) => s + g.rows.filter((r) => r.it.in_cart || r.it.ordered_at).length, 0)

  async function update(ids: string[], patch: Partial<StockItem>) {
    setErr(null)
    const { error } = await supabase.from('stock_items').update(patch).in('id', ids)
    if (error) setErr(errMsg(error))
    await reload()
  }

  const lineSum = (rows: Row[], q: Record<string, number>) => round2(rows.reduce((s, r) => s + Number(r.it.price ?? 0) * (q[r.it.id] ?? 1), 0))

  function startOrder(g: Group, rows: Row[]) {
    const q = Object.fromEntries(rows.map((r) => [r.it.id, 1]))
    setQty(q); setTotal(String(lineSum(rows, q))); setLogging(g.key)
  }

  async function placeOrder(g: Group, rows: Row[], withCost: boolean) {
    setErr(null)
    let orderId: string | null = null
    const t = parseFloat(total.replace(',', '.'))
    if (withCost && household) {
      if (!Number.isFinite(t)) { setErr('Type the order total, e.g. 42.90'); return }
      setBusy(g.key)
      const r = await logOrder({
        householdId: household.id, storeId: g.store?.id ?? null, storeName: g.vet ? 'Vet' : g.name,
        lines: rows.map((r) => ({ item: r.it, qty: qty[r.it.id] ?? 1, amount: Number(r.it.price ?? 0) * (qty[r.it.id] ?? 1) })),
        total: t
      })
      if (r.error) { setBusy(null); setErr(errMsg(r.error)); return }
      orderId = r.orderId
    }
    setBusy(g.key)
    await update(rows.map((r) => r.it.id), { ordered_at: new Date().toISOString(), in_cart: true, last_order_id: orderId })
    setBusy(null); setLogging(null)
  }

  async function undoOrder(rows: Row[]) {
    const orderId = rows.find((r) => r.it.last_order_id)?.it.last_order_id
    if (orderId && !window.confirm('Undo this order? Its cost is removed from Costs too.')) return
    if (orderId) {
      const r = await deleteOrder(orderId)
      if (r.error) { setErr(errMsg(r.error)); return }
    }
    await update(rows.map((r) => r.it.id), { ordered_at: null, last_order_id: null })
  }

  async function addToCart(g: Group, r: Row) {
    if (!g.vet) {
      const url = r.it.cart_url || r.it.product_url || g.store?.cart_url
      if (url) window.open(url, '_blank', 'noopener')
    }
    setBusy(r.it.id)
    await update([r.it.id], { in_cart: true })
    setBusy(null)
  }

  return (
    <Screen>
      <header className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="title">Shopping run</h1>
          <div className="sub">{count ? `${handled} of ${count} handled · ${groups.length} ${groups.length === 1 ? 'place' : 'places'}` : 'Nothing to buy this week'}</div>
        </div>
        <Link to="/costs" className="btn ghost small" aria-label="Costs: what you've spent">€ Costs</Link>
      </header>
      <OwnerSwitch />
      {count > 0 && <p className="note">“Add to cart” opens the item in the store. Add it there, come back, and it's ticked off here.</p>}
      <ErrorNote msg={error || err} />

      {count === 0 && (
        <Empty title="You're stocked up">
          <div className="hint">Items show up here a week before they need ordering, grouped by store.</div>
          <Link to="/stock" className="btn ghost" style={{ alignSelf: 'flex-start' }}>See stock</Link>
        </Empty>
      )}

      {groups.map((g) => {
        const mineRows = g.rows.filter((r) => r.it.owner_id === userId)
        const ordered = mineRows.length > 0 && mineRows.every((r) => r.it.ordered_at)
        const sub = g.rows.reduce((s, r) => s + Number(r.it.price ?? 0), 0)
        const threshold = g.store?.free_shipping_threshold ? Number(g.store.free_shipping_threshold) : 0
        const inCart = g.rows.filter((r) => r.it.in_cart || r.it.ordered_at).length
        return (
          <section key={g.key} className="card">
            <div className="card-head">
              <h2 style={{ fontSize: 18 }}>{g.name}</h2>
              <span className="small muted">{inCart} of {g.rows.length} {g.vet ? 'requested' : 'in cart'}</span>
            </div>

            {ordered ? (
              <div className="card-row">
                <span className="tick done" aria-hidden="true" style={{ width: 28 }}><span><IconCheck size={16} /></span></span>
                <div className="grow">
                  <div className="row-title">{g.vet ? 'Requested' : 'Order placed'} {fmtShort(mineRows[0].it.ordered_at!.slice(0, 10))}</div>
                  <div className="row-sub">When it arrives, tap “{g.vet ? 'Refilled' : 'New pack opened'}” in Stock.</div>
                </div>
                <button className="link-btn" onClick={() => void undoOrder(mineRows)}>Undo</button>
              </div>
            ) : (
              <>
                {g.rows.map((r) => {
                  const mine = r.it.owner_id === userId
                  const done = r.it.in_cart || !!r.it.ordered_at
                  const why = r.info.daysLeft != null ? `${r.info.daysLeft} days left` : r.info.countNow != null ? `${fmtNum(r.info.countNow)} left` : ''
                  return (
                    <div key={r.it.id} className="card-row">
                      <div className="grow">
                        <div className="row-title">{r.it.name}</div>
                        <div className="row-sub">{[r.it.price != null && !g.vet ? `1 × ${euro(r.it.price)}` : null, why, mine ? null : `${nameOf(r.it.owner_id)}'s`].filter(Boolean).join(' · ')}</div>
                      </div>
                      {!mine ? (
                        done ? <span className="badge good">{g.vet ? 'Asked' : 'In cart'}</span> : <span className="owner-tag">Theirs</span>
                      ) : done ? (
                        <button className="btn small" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }} disabled={busy === r.it.id}
                          aria-label={`${r.it.name} is ${g.vet ? 'requested' : 'in the cart'}. Tap to undo.`} onClick={() => update([r.it.id], { in_cart: false, ordered_at: null })}>
                          <IconCheck size={14} strokeWidth={3} />{g.vet ? 'Asked' : 'In cart'}
                        </button>
                      ) : (
                        <button className="btn small" disabled={busy === r.it.id} onClick={() => addToCart(g, r)}>
                          {g.vet ? 'Ask vet' : 'Add to cart'}{!g.vet && <IconExternal size={14} />}
                        </button>
                      )}
                    </div>
                  )
                })}

                {g.suggestions.slice(0, 2).map((r) => (
                  <div key={r.it.id} style={{ margin: '4px 16px 12px', padding: 12, borderRadius: 12, border: '1.5px dashed var(--dash)' }} className="stack-sm">
                    <div className="small" style={{ lineHeight: 1.45, color: 'var(--ink-2)' }}>
                      <strong style={{ color: 'var(--ink)' }}>{r.it.name}</strong> runs out in {r.info.daysLeft} days. Add it to this order and save a delivery?
                    </div>
                    <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setPulled([...pulled, r.it.id])}>
                      Add to this order{r.it.price != null ? ` · ${euro(r.it.price)}` : ''}
                    </button>
                  </div>
                ))}

                <div className="card-foot">
                  {!g.vet && (
                    <div className="row between" style={{ alignItems: 'baseline' }}>
                      <span className="small" style={{ fontSize: 14, color: 'var(--ink-2)' }}>Subtotal</span>
                      <span className="tabular" style={{ fontSize: 17, fontWeight: 700 }}>{euro(sub)}</span>
                    </div>
                  )}
                  {threshold > 0 && (
                    <div>
                      <Bar pct={Math.max(3, Math.min(100, Math.round((sub / threshold) * 100)))} label="Progress to free shipping" />
                      <div className="small" style={{ color: 'var(--muted-2)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 2 }}>
                        {sub >= threshold ? 'Free shipping unlocked' : `${euro(threshold - sub)} away from free shipping (${euro(threshold)})`}
                        <InfoTip label="About free shipping">Adds up the prices saved on these items. Change the store's free-shipping amount in Profile, under Stores.</InfoTip>
                      </div>
                    </div>
                  )}
                  {g.vet && <div className="hint">Prescription items: ask the vet for a refill, then mark it here.</div>}
                  <div className="row" style={{ gap: 8 }}>
                    {!g.vet && g.store?.cart_url && (
                      <a href={g.store.cart_url} target="_blank" rel="noopener" className="btn ghost" style={{ flex: 1 }}>Open cart<IconExternal size={14} /></a>
                    )}
                    {mineRows.length > 0 && logging !== g.key && (
                      <button className="btn dark" style={{ flex: 1 }} onClick={() => startOrder(g, mineRows)}>
                        {g.vet ? 'Mark as requested' : 'I placed the order'}
                      </button>
                    )}
                  </div>
                  {logging === g.key && (
                    <div className="stack-sm" style={{ padding: 12, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                      <div className="label-row"><span className="label">{g.vet ? 'What did it cost?' : 'What did you order?'}</span>
                        <InfoTip label="About logging the order">This goes into Costs, split by pet. Set how many of each you ordered; change the total if it included shipping or a discount, and the difference is logged as its own line.</InfoTip>
                      </div>
                      {mineRows.map((r) => (
                        <div key={r.it.id} className="row" style={{ gap: 8 }}>
                          <div className="grow small"><div style={{ fontWeight: 600 }}>{r.it.name}</div>
                            <div className="muted">{r.it.price != null ? euro(Number(r.it.price) * (qty[r.it.id] ?? 1)) : 'no price saved'}</div></div>
                          <div className="stepper">
                            <button type="button" aria-label={`Fewer ${r.it.name}`} onClick={() => { const q = { ...qty, [r.it.id]: Math.max(0, (qty[r.it.id] ?? 1) - 1) }; setQty(q); setTotal(String(lineSum(mineRows, q))) }}>−</button>
                            <span style={{ minWidth: 32 }}>{qty[r.it.id] ?? 1}</span>
                            <button type="button" aria-label={`More ${r.it.name}`} onClick={() => { const q = { ...qty, [r.it.id]: Math.min(50, (qty[r.it.id] ?? 1) + 1) }; setQty(q); setTotal(String(lineSum(mineRows, q))) }}>+</button>
                          </div>
                        </div>
                      ))}
                      <div className="row" style={{ gap: 8 }}>
                        <label htmlFor={`tot-${g.key}`} className="grow" style={{ fontSize: 14, fontWeight: 600 }}>Order total (€)</label>
                        <input id={`tot-${g.key}`} className="input num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <button className="btn dark" style={{ flex: 1 }} disabled={busy === g.key} onClick={() => void placeOrder(g, mineRows, true)}>Save order</button>
                        <button className="btn ghost" style={{ flex: 1 }} disabled={busy === g.key} onClick={() => void placeOrder(g, mineRows, false)}>Don't log cost</button>
                      </div>
                      <button className="link-btn" style={{ alignSelf: 'flex-start', minHeight: 32, padding: 0 }} onClick={() => setLogging(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )
      })}
    </Screen>
  )
}
