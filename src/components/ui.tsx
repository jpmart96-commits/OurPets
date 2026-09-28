import { NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { IconBack, IconBox, IconBowl, IconCart, IconHome, IconPaw, IconPill } from './icons'
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

export function BackLink({ to, label }: { to?: string; label: string }) {
  const nav = useNavigate()
  return (
    <button className="back" onClick={() => (to ? nav(to) : nav(-1))}>
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

export function Avatar({ name, species, size = 52, owner = 'me' }: { name: string; species?: string; size?: number; owner?: 'me' | 'other' }) {
  return (
    <div className={'avatar ' + (owner === 'me' ? 'mine' : 'theirs')} style={{ width: size, height: size, fontSize: size * 0.42 }} title={species}>
      {name.slice(0, 1).toUpperCase()}
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
