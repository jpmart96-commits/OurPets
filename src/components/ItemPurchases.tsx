import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, errMsg } from '../lib/supabase'
import { euro } from '../lib/calc'
import { fmtShort, todayISO } from '../lib/dates'
import { categoryOf, isOneOffItem, round2 } from '../lib/costs'
import type { Expense, StockItem } from '../lib/types'
import { InfoTip, Toggle } from './ui'
import { IconTrash } from './icons'

/** "Log a purchase" for things bought outside the Shopping run, plus this item's recent purchases. */
export function ItemPurchases({ item, householdId }: { item: StockItem; householdId: string }) {
  const [list, setList] = useState<Expense[]>([])
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState(1)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [oneOff, setOneOff] = useState(isOneOffItem(item))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('expenses').select('*').eq('item_id', item.id).order('spent_on', { ascending: false }).limit(6)
    setList((data ?? []) as Expense[])
  }, [item.id])
  useEffect(() => { void load() }, [load])

  const price = item.price != null ? Number(item.price) : null
  useEffect(() => { setAmount(price != null ? String(round2(price * qty)) : '') }, [price, qty])

  // lives inside the stock form, so it can't be a <form> of its own
  async function save() {
    const a = parseFloat(amount.replace(',', '.'))
    if (!Number.isFinite(a)) { setErr('Type what you paid, e.g. 24.99'); return }
    setBusy(true); setErr(null)
    const { error } = await supabase.from('expenses').insert({
      household_id: householdId, spent_on: date || todayISO(), amount: round2(a), category: categoryOf(item.type),
      title: item.name.slice(0, 120), pet_ids: item.stock_item_pets.map((p) => p.pet_id), item_id: item.id,
      store_id: item.source === 'store' ? item.store_id : null, quantity: qty, one_off: oneOff
    })
    setBusy(false)
    if (error) { setErr(errMsg(error)); return }
    setOpen(false); setQty(1)
    await load()
  }

  async function remove(x: Expense) {
    if (!window.confirm('Delete this purchase?')) return
    const { error } = await supabase.from('expenses').delete().eq('id', x.id)
    if (error) setErr(errMsg(error))
    await load()
  }

  const unit = item.type === 'med' ? 'box' : 'pack'

  return (
    <section className="card" aria-labelledby="pur-h">
      <div className="card-head" style={{ alignItems: 'center', paddingBottom: 6 }}>
        <h2 id="pur-h" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Purchases
          <InfoTip label="About purchases">Orders you mark as placed in the Shopping run are logged here on their own. Use “Log a purchase” for anything bought another way, like at the vet or a shop. All of it adds up in Costs.</InfoTip>
        </h2>
        {!open && <button type="button" className="btn ghost small" onClick={() => setOpen(true)}>Log a purchase</button>}
      </div>
      {open && (
        <div className="card-foot" style={{ borderTop: '1px solid var(--line-2)' }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void save() } }}>
          <div className="row between">
            <span style={{ fontSize: 14 }}>How many {unit === 'box' ? 'boxes' : 'packs'}</span>
            <div className="stepper">
              <button type="button" aria-label="Fewer" onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
              <span>{qty}</span>
              <button type="button" aria-label="More" onClick={() => setQty(Math.min(50, qty + 1))}>+</button>
            </div>
          </div>
          <div className="grid2" style={{ gap: 12 }}>
            <div className="field"><label htmlFor="pa">Paid (€)</label><input id="pa" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
            <div className="field"><label htmlFor="pd">Date</label><input id="pd" className="input" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="row between">
            <div className="label-row"><span id="pu-oo" style={{ fontSize: 14 }}>One-off purchase</span>
              <InfoTip label="About one-off purchases">Not part of normal monthly spending, like treats you're trying once. It counts in Costs totals but not in the monthly average.</InfoTip>
            </div>
            <Toggle on={oneOff} onChange={setOneOff} labelledBy="pu-oo" />
          </div>
          {err && <div className="hint warn-text">{err}</div>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => void save()}>Save purchase</button>
            <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {list.length === 0 && !open && <div className="card-row"><span className="hint">None logged yet.</span></div>}
      {list.map((x) => (
        <div key={x.id} className="card-row">
          <div className="grow"><div className="row-title tabular">{euro(Number(x.amount))}{x.quantity && Number(x.quantity) !== 1 ? ` · ${Number(x.quantity)} ${unit === 'box' ? 'boxes' : 'packs'}` : ''}</div>
            <div className="row-sub">{fmtShort(x.spent_on)}{x.order_id ? ' · from the Shopping run' : ''}{x.one_off ? ' · one-off' : ''}</div></div>
          {!x.order_id && <button type="button" className="icon-btn plain" aria-label="Delete purchase" onClick={() => void remove(x)}><IconTrash size={18} /></button>}
        </div>
      ))}
      {list.length > 0 && <div className="card-foot"><Link to="/costs" className="small">All costs</Link></div>}
    </section>
  )
}
