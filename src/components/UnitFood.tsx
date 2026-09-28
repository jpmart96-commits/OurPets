import { useState } from 'react'
import { errMsg } from '../lib/supabase'
import { fmtDateTime } from '../lib/dates'
import { agoText, fmtNum, unitRateSuggestion, unitRateText, unitTapCheck, unitWord, type ItemInfo } from '../lib/calc'
import { addUnitPack, countUnits, openedUnit, setUnitDays } from '../lib/actions'
import type { StockItem } from '../lib/types'
import { InfoTip } from './ui'

const dismissKey = (id: string, days: number) => `ourpets.rate-dismissed.${id}.${days}`
function isDismissed(id: string, days: number): boolean {
  try { return localStorage.getItem(dismissKey(id, days)) === '1' } catch { return false }
}
function dismiss(id: string, days: number) {
  try { localStorage.setItem(dismissKey(id, days), '1') } catch { /* private mode: it just shows again */ }
}

/**
 * Status and buttons for food tracked by units (cans, pouches, trays):
 * "Opened a new can", "+1 pack", "Count cans", plus the learned-rate suggestion.
 */
export function UnitFood({ item, info, mine, compact, reload }: {
  item: StockItem
  info: ItemInfo
  mine: boolean
  compact?: boolean
  reload: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [asking, setAsking] = useState<{ since: number; guess: number } | null>(null)
  const [counting, setCounting] = useState(false)
  const [count, setCount] = useState('')
  const [, setTick] = useState(0)

  const st = info.units
  if (!st) return null
  const label = item.unit_label
  const one = unitWord(label, 1), many = unitWord(label, 2)
  const d = Number(item.unit_days ?? 0)
  const suggestion = mine && !compact ? unitRateSuggestion(item) : null
  const showSuggestion = suggestion && !isDismissed(item.id, suggestion.days)

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true); setErr(null)
    const r = await fn()
    if (r.error) setErr(errMsg(r.error))
    await reload()
    setBusy(false)
  }

  function tapOpened() {
    const c = unitTapCheck(item)
    if (c.ambiguous) { setAsking({ since: c.sinceDays, guess: c.guess }); return }
    void run(() => openedUnit(item, 1))
  }

  async function saveCount() {
    const n = parseInt(count, 10)
    if (!Number.isFinite(n) || n < 0) { setErr(`Type how many unopened ${many} you have, e.g. 7`); return }
    await run(() => countUnits(item, n))
    setCounting(false)
  }

  const box = { padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)' }

  return (
    <div className="stack-sm" style={{ gap: 8 }}>
      <div className="row between" style={{ ...box, gap: 8 }}>
        <span className="small tabular" style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          ≈ {st.unopened}{item.pack_units ? ` of ${item.pack_units}` : ''} {unopenedWord(st.unopened, one, many)} unopened
          <InfoTip label={`How the ${one} count works`}>
            The app assumes you open a new {one} every {fmtNum(d)} {d === 1 ? 'day' : 'days'} ({unitRateText(label, d)}), so this number goes down on its own.
            Tap “Opened a new {one}” when you open one and the count corrects itself. After a few taps the app learns how long a {one} really lasts.
          </InfoTip>
        </span>
        {st.openedAt && <span className="small muted">{compact ? 'opened' : `current ${one} opened`} {agoText(st.openedAt)}</span>}
      </div>

      {st.unopened === 0 && mine && (
        <div className="small warn-text">This is the last {one}. Tap “+1 pack” when your order arrives.</div>
      )}

      {info.useBy && (
        <div className={'small ' + (info.pastUseBy ? 'warn-text' : 'muted')} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          {info.pastUseBy
            ? `The open ${one} was due to be used by ${fmtDateTime(info.useBy.toISOString())}. Throw out what's left${mine ? ` and tap “Opened a new ${one}”` : ''}.`
            : `Open ${one}: use by ${fmtDateTime(info.useBy.toISOString())}`}
          <InfoTip label="About the use-by time">When the current {one} was opened plus how long an opened {one} keeps ({item.open_life_hours} h, set on the item).</InfoTip>
        </div>
      )}

      {asking && (
        <div className="card pad stack-sm" style={{ background: 'var(--accent-soft)', borderColor: 'transparent' }}>
          <div className="small" style={{ lineHeight: 1.45 }}>
            It's been {fmtNum(Math.round(asking.since * 2) / 2)} days since the last {one} was opened. You usually get {fmtNum(d)} from one. Was that just one {one}?
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small" disabled={busy} onClick={() => { setAsking(null); void run(() => openedUnit(item, 1)) }}>Yes, one {one} lasted that long</button>
            <button className="btn ghost small" disabled={busy} onClick={() => { const n = asking.guess; setAsking(null); void run(() => openedUnit(item, n)) }}>
              No, I forgot to log {asking.guess - 1 === 1 ? 'one' : `about ${asking.guess - 1}`}
            </button>
            <button className="btn ghost small" disabled={busy} onClick={() => setAsking(null)}>Cancel</button>
          </div>
        </div>
      )}

      {showSuggestion && suggestion && (
        <div className="card pad stack-sm" style={{ background: 'var(--accent-soft)', borderColor: 'transparent' }}>
          <div className="small" style={{ lineHeight: 1.45, display: 'inline-flex', alignItems: 'flex-start', gap: 2 }}>
            <span>Your last {suggestion.samples} {many} lasted about {fmtNum(suggestion.days)} days each. You set {fmtNum(d)}.</span>
            <InfoTip label="How this is worked out">
              The middle value of the time between your last {suggestion.samples} “Opened a new {one}” taps. Taps where you said you forgot to log some {many} are left out.
            </InfoTip>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small" disabled={busy} onClick={() => void run(() => setUnitDays(item, suggestion.days))}>Use {fmtNum(suggestion.days)} days</button>
            <button className="btn ghost small" disabled={busy} onClick={() => { dismiss(item.id, suggestion.days); setTick((t) => t + 1) }}>Keep {fmtNum(d)}</button>
          </div>
        </div>
      )}

      {counting && (
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void saveCount() }}>
          <label htmlFor={`cnt-${item.id}`} className="visually-hidden">Unopened {many} now</label>
          <input id={`cnt-${item.id}`} className="input" inputMode="numeric" autoFocus value={count} onChange={(e) => setCount(e.target.value)} placeholder={`Unopened ${many}, e.g. 7`} />
          <button className="btn small" style={{ minHeight: 46, flexShrink: 0 }} type="submit" disabled={busy}>Save</button>
          <button className="btn ghost small" style={{ minHeight: 46, flexShrink: 0 }} type="button" onClick={() => setCounting(false)}>Cancel</button>
        </form>
      )}

      {err && <p className="error" role="alert">{err}</p>}

      {mine && !asking && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className={'btn small' + (compact ? ' ghost' : '')} disabled={busy} onClick={tapOpened}>Opened a new {one}</button>
          {!compact && (
            <>
              <button className="btn ghost small" disabled={busy || !item.pack_units} onClick={() => void run(() => addUnitPack(item))}>+1 pack{item.pack_units ? ` (${item.pack_units})` : ''}</button>
              {!counting && <button className="btn ghost small" disabled={busy} onClick={() => { setCounting(true); setCount(String(st.unopened)) }}>Count {many}</button>}
              <InfoTip label="What these buttons do">
                <b>Opened a new {one}</b>: takes one off the count and restarts the clock from now.<br />
                <b>+1 pack</b>: your order arrived; adds {item.pack_units ?? 'a pack of'} {many}.<br />
                <b>Count {many}</b>: type how many unopened {many} you really have, if the number has drifted.
              </InfoTip>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function unopenedWord(n: number, one: string, many: string) {
  return n === 1 ? one : many
}
