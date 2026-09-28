import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg, SUPABASE_URL } from '../lib/supabase'
import type { Store } from '../lib/types'
import { Avatar, BackLink, ErrorNote, Screen, Toggle, FieldLabel, InfoTip } from '../components/ui'
import { IconCamera, IconPlus } from '../components/icons'
import { removePhoto, uploadPhoto } from '../lib/photos'
import { disablePush, enablePush, isIOS, pushState, sendTestPush, type PushState } from '../lib/push'

export default function Profile() {
  const { profile, profiles, members, pets, stores, userId, household, session, reload, error, othersLabel, photoUrl } = useApp()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [invite, setInvite] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setName(profile?.display_name ?? '') }, [profile?.display_name])

  const sharesHome = !!profile?.shares_home
  const others = members.filter((m) => m.user_id !== userId)
  const petsOf = (uid: string) => pets.filter((p) => p.owner_id === uid).map((p) => p.name).join(', ') || 'No pets yet'
  const link = invite ? `${window.location.href.split('#')[0]}#/join/${invite}` : ''

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true); setErr(null)
    const r = await fn()
    if (r.error) setErr(errMsg(r.error))
    await reload()
    setBusy(false)
  }

  async function setAvatar(f: File) {
    if (!household || !userId) return
    setBusy(true); setErr(null)
    try {
      const old = profile?.avatar_path
      const path = await uploadPhoto(household.id, 'people', f)
      const { error } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId)
      if (error) throw error
      if (old) void removePhoto(old)
      await reload()
    } catch (e) {
      setErr('Photo upload failed: ' + errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function makeInvite() {
    setBusy(true); setErr(null); setCopied(false)
    const { data, error } = await supabase.rpc('create_invite')
    setBusy(false)
    if (error) { setErr(errMsg(error)); return }
    setInvite(String(data))
    await reload()
  }

  async function shareLink() {
    try {
      if (navigator.share) { await navigator.share({ title: 'Join me on OurPets', url: link }); return }
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch { /* cancelled */ }
  }

  function saveName(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || name.trim() === profile?.display_name) return
    void run(() => supabase.from('profiles').update({ display_name: name.trim() }).eq('id', userId!))
  }

  return (
    <Screen>
      <BackLink to="/" label="Today" />
      <header className="row" style={{ gap: 14 }}>
        <label className="photo-circle" style={{ width: 64, height: 64, fontSize: 26 }} aria-label={profile?.avatar_path ? 'Change your photo' : 'Add your photo'}>
          {photoUrl(profile?.avatar_path) ? <img src={photoUrl(profile?.avatar_path)} alt="" /> : (profile?.display_name || '?').slice(0, 1).toUpperCase()}
          <span className="photo-badge" aria-hidden="true" style={{ width: 26, height: 26 }}><IconCamera size={12} /></span>
          <input type="file" accept="image/*" className="visually-hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void setAvatar(f) }} />
        </label>
        <div className="grow">
          <h1 className="title" style={{ fontSize: 28 }}>{profile?.display_name || 'You'}</h1>
          <div className="sub" style={{ fontSize: 14 }}>{session?.user.email}</div>
        </div>
      </header>
      <ErrorNote msg={error || err} />

      <form className="card pad stack-sm" onSubmit={saveName}>
        <label htmlFor="dn" className="label">Your name</label>
        <div className="row" style={{ gap: 8 }}>
          <input id="dn" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <button className="btn small" type="submit" disabled={busy || !name.trim() || name.trim() === profile?.display_name} style={{ minHeight: 46 }}>Save</button>
        </div>
      </form>

      <section className="card" aria-labelledby="hh-h">
        <div className="card-head" style={{ paddingBottom: 4 }}><h2 id="hh-h">Household</h2></div>
        <div className="row" style={{ padding: '10px 16px 14px' }}>
          <div className="grow">
            <div id="share-label" className="row-title">I share my home with someone</div>
            <div className="row-sub" style={{ lineHeight: 1.4 }}>Each of you keeps your own pets. You see each other's, read-only.</div>
          </div>
          <Toggle on={sharesHome} labelledBy="share-label" onChange={(v) => run(() => supabase.from('profiles').update({ shares_home: v }).eq('id', userId!))} />
        </div>

        {sharesHome && (
          <>
            <div className="card-row">
              <Avatar name={profile?.display_name || '?'} size={36} src={photoUrl(profile?.avatar_path)} />
              <div className="grow"><div className="row-title">{profile?.display_name} <span className="muted" style={{ fontWeight: 500 }}>(you)</span></div><div className="row-sub">{petsOf(userId!)}</div></div>
            </div>
            {others.map((m) => {
              const p = profiles.find((x) => x.id === m.user_id)
              return (
                <div key={m.user_id} className="card-row">
                  <Avatar name={p?.display_name || '?'} size={36} owner="other" src={photoUrl(p?.avatar_path)} />
                  <div className="grow"><div className="row-title">{p?.display_name || 'Member'}</div><div className="row-sub">{petsOf(m.user_id)}</div></div>
                  <span className="badge pill good">Joined</span>
                </div>
              )
            })}
            <div className="card-foot">
              {!invite ? (
                <button className="btn ghost" onClick={makeInvite} disabled={busy}><IconPlus size={16} />Invite someone</button>
              ) : (
                <div className="stack-sm" style={{ padding: 12, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>Send this link. It works once and expires in 7 days. If they already have an account, their pets come with them.</div>
                  <div style={{ fontSize: 14, fontWeight: 600, wordBreak: 'break-all' }}>{link}</div>
                  <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={shareLink}>{copied ? 'Copied' : 'Share link'}</button>
                </div>
              )}
              <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (code.trim()) nav(`/join/${code.trim().split('/').pop()}`) }}>
                <input className="input" aria-label="Invite code or link" placeholder="Have an invite? Paste it here" value={code} onChange={(e) => setCode(e.target.value)} />
                <button className="btn ghost small" style={{ minHeight: 46 }} type="submit" disabled={!code.trim()}>Join</button>
              </form>
            </div>
          </>
        )}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line-2)', background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>
          {sharesHome
            ? (others.length ? `On: Today, Stock and Shopping show a Mine / ${othersLabel} / Both switch, and Pets lists everyone's pets.` : 'On: invite someone and a switch between your pets and theirs appears on Today, Stock and Shopping.')
            : 'Off: it\'s just you. Only your pets appear and there\'s no switch.'}
        </div>
      </section>

      <RemindersCard run={run} busy={busy} />

      <CalendarCard />

      <StoresCard stores={stores} householdId={household?.id} run={run} busy={busy} />

      <button className="btn ghost block" onClick={() => supabase.auth.signOut()}>Sign out</button>
      <div className="small muted" style={{ textAlign: 'center' }}>Version {new Date(__BUILD__).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
    </Screen>
  )
}

function StoresCard({ stores, householdId, run, busy }: { stores: Store[]; householdId?: string; run: (fn: () => PromiseLike<{ error: unknown }>) => Promise<void>; busy: boolean }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [cart, setCart] = useState('')
  const [threshold, setThreshold] = useState('')

  function start(s?: Store) {
    setEditing(s?.id ?? 'new'); setName(s?.name ?? ''); setCart(s?.cart_url ?? ''); setThreshold(s?.free_shipping_threshold != null ? String(s.free_shipping_threshold) : '')
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const t = parseFloat(threshold.replace(',', '.'))
    const row = { name: name.trim(), cart_url: cart.trim() || null, free_shipping_threshold: Number.isFinite(t) ? t : null }
    if (!row.name) return
    await run(() => editing === 'new'
      ? supabase.from('stores').insert({ ...row, household_id: householdId })
      : supabase.from('stores').update(row).eq('id', editing!))
    setEditing(null)
  }

  return (
    <section className="card" aria-labelledby="st-h">
      <div className="card-head" style={{ alignItems: 'center', paddingBottom: 6 }}>
        <h2 id="st-h">Stores</h2>
        <button className="icon-btn plain" aria-label="Add store" onClick={() => start()}><IconPlus size={20} /></button>
      </div>
      {stores.map((s) => (
        <button key={s.id} className="card-row" onClick={() => start(s)} style={{ width: '100%', border: 0, borderTop: '1px solid var(--line-2)', background: 'transparent', textAlign: 'left' }}>
          <span className="grow row-title">{s.name}</span>
          <span className="small muted">{s.free_shipping_threshold != null ? `Free shipping over €${Number(s.free_shipping_threshold)}` : 'Free shipping: not set'}</span>
        </button>
      ))}
      {editing && (
        <form className="card-foot" onSubmit={save}>
          <div className="field"><label htmlFor="stn">Store name</label><input id="stn" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="field"><FieldLabel htmlFor="stc" tip="The store's basket page. “Open cart” in the Shop tab takes you here to check out.">Cart page link</FieldLabel><input id="stc" className="input" type="url" value={cart} onChange={(e) => setCart(e.target.value)} placeholder="https://…/cart" /></div>
          <div className="field"><FieldLabel htmlFor="stt" tip="The order total at which this store ships for free. The Shop tab shows how close your order is and suggests items due soon to reach it.">Free shipping from (€)</FieldLabel><input id="stt" className="input" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" type="submit" disabled={busy} style={{ flex: 1 }}>Save store</button>
            <button className="btn ghost" type="button" onClick={() => setEditing(null)} style={{ flex: 1 }}>Cancel</button>
          </div>
          {editing !== 'new' && (
            <button type="button" className="link-btn" style={{ color: 'var(--warn)' }} onClick={() => { if (window.confirm('Delete this store? Items keep their links.')) { void run(() => supabase.from('stores').delete().eq('id', editing)); setEditing(null) } }}>Delete store</button>
          )}
        </form>
      )}
    </section>
  )
}

function RemindersCard({ run, busy }: { run: (fn: () => PromiseLike<{ error: unknown }>) => Promise<void>; busy: boolean }) {
  const { profile, userId } = useApp()
  const [state, setState] = useState<PushState | 'loading'>('loading')
  const [msg, setMsg] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => { void pushState().then(setState) }, [])

  async function turnOn() {
    if (!userId) return
    setWorking(true); setMsg(null)
    try {
      await enablePush(userId)
      setState('on')
      setMsg(await sendTestPush())
    } catch (e) {
      setMsg(errMsg(e))
      setState(await pushState())
    } finally { setWorking(false) }
  }
  async function turnOff() {
    setWorking(true); setMsg(null)
    try { await disablePush(); setState('off') } catch (e) { setMsg(errMsg(e)) } finally { setWorking(false) }
  }
  async function test() {
    setWorking(true); setMsg(null)
    setMsg(await sendTestPush())
    setWorking(false)
  }
  const pref = (key: 'notify_doses' | 'notify_stock' | 'notify_appointments', v: boolean) =>
    run(() => supabase.from('profiles').update({ [key]: v }).eq('id', userId!))

  return (
    <section className="card" aria-labelledby="rem-h">
      <div className="card-head" style={{ paddingBottom: 4 }}><h2 id="rem-h">Reminders</h2></div>
      <div style={{ padding: '6px 16px 14px' }} className="stack-sm">
        {state === 'loading' && <div className="hint">Checking this phone…</div>}
        {state === 'needs-install' && (
          <div className="note">
            On iPhone, reminders only work from the home-screen app. In Safari tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, open OurPets from there, and come back to this page.
          </div>
        )}
        {state === 'unsupported' && <div className="note">This browser can't show notifications. {isIOS() ? 'Update iOS to 16.4 or later.' : 'Try Chrome or Safari.'}</div>}
        {state === 'denied' && <div className="note">Notifications are blocked for OurPets. Allow them in your phone's settings, then reload.</div>}
        {state === 'off' && (
          <>
            <div className="hint">Get a nudge at each dose time, a morning summary, and a reminder 2 hours before appointments.</div>
            <button className="btn" onClick={turnOn} disabled={working}>{working ? 'Turning on…' : 'Turn on reminders on this phone'}</button>
          </>
        )}
        {state === 'on' && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="badge pill good">On for this phone</span>
            <button className="btn ghost small" onClick={test} disabled={working}>Send a test</button>
            <button className="btn ghost small" onClick={turnOff} disabled={working}>Turn off</button>
          </div>
        )}
        {msg && <div className="hint" role="status">{msg}</div>}
      </div>
      {([
        ['notify_doses', 'Medication doses', 'At each dose time, and weekly/monthly doses in the summary'],
        ['notify_stock', 'Running low', 'In the morning summary, on the day to reorder'],
        ['notify_appointments', 'Appointments & vaccines', '2 hours before, and in the summary the day before']
      ] as const).map(([key, label, sub]) => (
        <div key={key} className="card-row">
          <div className="grow"><div id={`lbl-${key}`} className="row-title">{label}</div><div className="row-sub">{sub}</div></div>
          <Toggle on={!!profile?.[key]} labelledBy={`lbl-${key}`} onChange={(v) => void pref(key, v)} />
        </div>
      ))}
      <div className="card-row">
        <label htmlFor="ms" className="grow"><div className="row-title">Morning summary</div><div className="row-sub">What's due today, sent at this time</div></label>
        <input id="ms" className="input" type="time" style={{ width: 136, flexShrink: 0 }} disabled={busy} value={(profile?.morning_summary ?? '08:00').slice(0, 5)}
          onChange={(e) => { const v = e.target.value; if (v) void run(() => supabase.from('profiles').update({ morning_summary: v }).eq('id', userId!)) }} />
      </div>
    </section>
  )
}

function CalendarCard() {
  const { shared, othersLabel } = useApp()
  const [token, setToken] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [all, setAll] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    void supabase.from('calendar_feeds').select('token').maybeSingle().then(({ data }) => { setToken((data?.token as string) ?? null); setLoaded(true) })
  }, [])

  async function getLink(reset = false) {
    if (reset && !window.confirm('Make a new link? The old one stops working, so calendars using it stop updating until you add the new one.')) return
    setWorking(true); setMsg(null)
    const { data, error } = await supabase.rpc('calendar_token', { p_reset: reset })
    setWorking(false)
    if (error) { setMsg(errMsg(error)); return }
    setToken(String(data))
    if (reset) setMsg('New link made. Remove the old OurPets calendar from your calendar app and add this one.')
  }

  const https = token ? `${SUPABASE_URL}/functions/v1/calendar?t=${token}${all ? '&scope=all' : ''}` : ''
  const webcal = https.replace(/^https:/, 'webcal:')
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`

  async function copy() {
    try { await navigator.clipboard.writeText(https); setMsg('Link copied.') } catch { setMsg('Copy the link above by hand.') }
  }

  return (
    <section className="card" aria-labelledby="cal-h">
      <div className="card-head" style={{ paddingBottom: 4 }}>
        <h2 id="cal-h" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Calendar
          <InfoTip label="About the calendar feed">A private link your calendar app subscribes to. It shows appointments, vaccines &amp; treatments when they're due, and “Order …” on the day each item needs ordering. Your calendar app checks it every few hours (Google can take up to a day), so it follows changes on its own. Anyone with the link can see these events: keep it to yourself, and make a new link if it leaks.</InfoTip>
        </h2>
      </div>
      <div style={{ padding: '6px 16px 14px' }} className="stack-sm">
        {!loaded ? <div className="hint">Loading…</div> : !token ? (
          <>
            <div className="hint">See appointments, vaccines due and reorder dates in Google Calendar, Apple Calendar or Outlook, next to everything else.</div>
            <button className="btn" onClick={() => void getLink()} disabled={working}>{working ? 'Making link…' : 'Get my calendar link'}</button>
          </>
        ) : (
          <>
            {shared && (
              <div className="row" style={{ gap: 8 }}>
                <div className="grow"><div id="cal-all" className="row-title">Include {othersLabel} pets</div><div className="row-sub">Off: only your pets</div></div>
                <Toggle on={all} labelledBy="cal-all" onChange={setAll} />
              </div>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <a className="btn small" href={google} target="_blank" rel="noopener">Add to Google Calendar</a>
              <a className="btn ghost small" href={webcal}>iPhone / Mac / Outlook</a>
              <button className="btn ghost small" onClick={() => void copy()}>Copy link</button>
            </div>
            <div className="small muted" style={{ wordBreak: 'break-all', lineHeight: 1.4 }}>{https}</div>
            <button className="link-btn" style={{ alignSelf: 'flex-start', minHeight: 32, padding: 0, color: 'var(--muted-2)' }} onClick={() => void getLink(true)} disabled={working}>Make a new link</button>
          </>
        )}
        {msg && <div className="hint" role="status">{msg}</div>}
      </div>
    </section>
  )
}
