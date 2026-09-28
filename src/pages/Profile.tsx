import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/store'
import { supabase, errMsg } from '../lib/supabase'
import type { Store } from '../lib/types'
import { Avatar, BackLink, ErrorNote, Screen, Toggle } from '../components/ui'
import { IconPlus } from '../components/icons'

export default function Profile() {
  const { profile, profiles, members, pets, stores, userId, household, session, reload, error, othersLabel } = useApp()
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
        <Avatar name={profile?.display_name || '?'} size={60} />
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
              <Avatar name={profile?.display_name || '?'} size={36} />
              <div className="grow"><div className="row-title">{profile?.display_name} <span className="muted" style={{ fontWeight: 500 }}>(you)</span></div><div className="row-sub">{petsOf(userId!)}</div></div>
            </div>
            {others.map((m) => {
              const p = profiles.find((x) => x.id === m.user_id)
              return (
                <div key={m.user_id} className="card-row">
                  <Avatar name={p?.display_name || '?'} size={36} owner="other" />
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

      <StoresCard stores={stores} householdId={household?.id} run={run} busy={busy} />

      <button className="btn ghost block" onClick={() => supabase.auth.signOut()}>Sign out</button>
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
          <div className="field"><label htmlFor="stc">Cart page link</label><input id="stc" className="input" type="url" value={cart} onChange={(e) => setCart(e.target.value)} placeholder="https://…/cart" /></div>
          <div className="field"><label htmlFor="stt">Free shipping from (€)</label><input id="stt" className="input" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>
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
