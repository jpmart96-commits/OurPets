import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useId, useState, type ReactNode } from 'react'
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
