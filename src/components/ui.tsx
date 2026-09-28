import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { IconBack, IconBox, IconBowl, IconCamera, IconCart, IconHome, IconPaw, IconPill } from './icons'
import { useApp, type OwnerFilter } from '../lib/store'
import type { ItemType } from '../lib/types'

export function TabBar() {
  const tabs = [
    { to: '/', label: 'Today', icon: IconHome, end: true },
    { to: '/pets', label: 'Pets', icon: IconPaw },
    { to: '/stock', label: 'Stock', icon: IconBox },
    { to: '/shop', label: 'Shop', icon: IconCart }
  ]
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>
          <t.icon size={22} />
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

export function Screen({ children, tabs = true }: { children: ReactNode; tabs?: boolean }) {
  return (
    <div className="screen">
      <main className="content">{children}</main>
      {tabs && <TabBar />}
    </div>
  )
}

/** Go back inside the app; if the page was opened directly (no in-app history), go to a sensible screen instead. */
export function useGoBack(fallback: string) {
  const nav = useNavigate()
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) nav(-1)
    else nav(fallback, { replace: true })
  }
}

export function BackLink({ to, label }: { to?: string; label: string }) {
  const nav = useNavigate()
  const back = useGoBack('/')
  return (
    <button className="back" onClick={() => (to ? nav(to) : back())}>
      <IconBack size={20} />
      {label}
    </button>
  )
}

export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} aria-pressed={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chips<T extends string>({ options, value, onChange, label, dark, scroll }: {
  options: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label: string
  dark?: boolean
  scroll?: boolean
}) {
  return (
    <div className={'chips' + (scroll ? ' scroll' : '')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id}
          className={'chip' + (value === o.id ? (dark ? ' on-dark' : ' on') : '')} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function OwnerSwitch() {
  const { shared, filter, setFilter, othersLabel } = useApp()
  if (!shared) return null
  return (
    <Segmented<OwnerFilter>
      label="Whose pets to show"
      value={filter}
      onChange={setFilter}
      options={[{ id: 'mine', label: 'Mine' }, { id: 'others', label: othersLabel }, { id: 'all', label: 'Both' }]}
    />
  )
}

export function Toggle({ on, onChange, labelledBy }: { on: boolean; onChange: (v: boolean) => void; labelledBy: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-labelledby={labelledBy} className={'switch' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}

export function Bar({ pct, urgent, label }: { pct: number; urgent?: boolean; label: string }) {
  return (
    <div className="bar" role="img" aria-label={label}>
      <div className={urgent ? 'urgent' : ''} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function TypeIcon({ type, size = 20 }: { type: ItemType; size?: number }) {
  if (type === 'food') return <IconBowl size={size} />
  if (type === 'med') return <IconPill size={size} />
  return <IconBox size={size} />
}

export function Avatar({ name, species, size = 52, owner = 'me', src }: { name: string; species?: string; size?: number; owner?: 'me' | 'other'; src?: string }) {
  return (
    <div className={'avatar ' + (owner === 'me' ? 'mine' : 'theirs')} style={{ width: size, height: size, fontSize: size * 0.42 }} title={species}>
      {src ? <img src={src} alt="" /> : name.slice(0, 1).toUpperCase()}
    </div>
  )
}

/** Square thumbnail for stock items: photo when there is one, otherwise the type icon. */
export function ItemThumb({ type, src, size = 36 }: { type: ItemType; src?: string; size?: number }) {
  return (
    <div className="icon-tile" style={{ width: size, height: size, overflow: 'hidden' }}>
      {src ? <img src={src} alt="" className="thumb-img" /> : <TypeIcon type={type} size={Math.round(size * 0.55)} />}
    </div>
  )
}

/** Photo chooser: tap to take/choose a photo. Shows the picked file or the current photo. */
export function PhotoPicker({ current, file, onFile, onRemove, round = true, label = 'Photo', fallback }: {
  current?: string
  file: File | null
  onFile: (f: File | null) => void
  onRemove?: () => void
  round?: boolean
  label?: string
  fallback?: ReactNode
}) {
  const [preview, setPreview] = useState<string | undefined>()
  useEffect(() => {
    if (!file) { setPreview(undefined); return }
    const u = URL.createObjectURL(file)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  const shown = preview ?? current
  const id = useId()
  return (
    <div className="photo-picker">
      <label htmlFor={id} className={'photo-circle' + (round ? '' : ' square')} aria-label={shown ? `Change ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}>
        {shown ? <img src={shown} alt="" /> : (fallback ?? <IconCamera size={26} />)}
        <span className="photo-badge" aria-hidden="true"><IconCamera size={14} /></span>
      </label>
      <input id={id} type="file" accept="image/*" className="visually-hidden" onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
      <div className="stack-sm" style={{ gap: 4 }}>
        <label htmlFor={id} className="link-btn" style={{ padding: 0, minHeight: 32, cursor: 'pointer' }}>{shown ? 'Change photo' : 'Add photo'}</label>
        {shown && onRemove && <button type="button" className="link-btn" style={{ padding: 0, minHeight: 32, color: 'var(--muted-2)', textAlign: 'left' }} onClick={onRemove}>Remove</button>}
      </div>
    </div>
  )
}

export function Loading() {
  return <div className="center muted">Loading…</div>
}

export function ErrorNote({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <p className="error" role="alert">{msg}</p>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children}
    </div>
  )
}

/**
 * (i) button with a short explanation. Opens on mouse-over (desktop), on tap (phones) and on keyboard focus + Enter.
 * Tap again, tap elsewhere, scroll or press Escape to close.
 */
export function InfoTip({ children, label = 'More info' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' })
  const id = useId()
  const wrap = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return
    const r = btn.current.getBoundingClientRect()
    const w = pop.current.offsetWidth, h = pop.current.offsetHeight
    const vw = window.innerWidth, vh = window.innerHeight
    const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), vw - w - 12)
    const below = r.bottom + 8
    const top = below + h > vh - 12 && r.top - h - 8 > 12 ? r.top - h - 8 : below
    setPos({ left, top })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => { setOpen(false); setPinned(false); setPos({ visibility: 'hidden' }) }
    const onDown = (e: PointerEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <span className="infotip" ref={wrap}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true) }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !pinned) { setOpen(false); setPos({ visibility: 'hidden' }) } }}>
      <button ref={btn} type="button" className="infotip-btn" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.preventDefault(); e.stopPropagation()
          const next = !(open && pinned)
          setPinned(next); setOpen(next)
          if (!next) setPos({ visibility: 'hidden' })
        }}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
          <path d="M8 7.2v4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {open && <span ref={pop} role="tooltip" id={id} className="infotip-pop" style={pos}>{children}</span>}
    </span>
  )
}

/** A field label with an optional (i) explanation next to it. */
export function FieldLabel({ htmlFor, children, tip, as = 'label' }: { htmlFor?: string; children: ReactNode; tip?: ReactNode; as?: 'label' | 'span' }) {
  const text = typeof children === 'string' ? children : 'this'
  return (
    <div className="label-row">
      {as === 'label' ? <label htmlFor={htmlFor} className="label">{children}</label> : <span className="label">{children}</span>}
      {tip && <InfoTip label={`About ${text.toLowerCase()}`}>{tip}</InfoTip>}
    </div>
  )
}
