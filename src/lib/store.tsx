import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { signPhotos } from './photos'
import { addDays, todayISO } from './dates'
import type { Appointment, DoseLog, Household, Member, Pet, Profile, StockItem, Store, Vaccination } from './types'

export type OwnerFilter = 'mine' | 'others' | 'all'

interface Data {
  profile: Profile | null
  household: Household | null
  members: Member[]
  profiles: Profile[]
  pets: Pet[]
  stores: Store[]
  items: StockItem[]
  logs: DoseLog[]
  appointments: Appointment[]
  vaccinations: Vaccination[]
  photos: Record<string, string>
}

const empty: Data = {
  profile: null, household: null, members: [], profiles: [], pets: [], stores: [], items: [], logs: [], appointments: [], vaccinations: [], photos: {}
}

interface Ctx extends Data {
  session: Session | null
  authReady: boolean
  loading: boolean
  error: string | null
  userId: string | null
  reload: () => Promise<void>
  shared: boolean
  filter: OwnerFilter
  setFilter: (f: OwnerFilter) => void
  othersLabel: string
  nameOf: (userId: string) => string
  petById: (id: string) => Pet | undefined
  showOwner: (ownerId: string) => boolean
  photoUrl: (path: string | null | undefined) => string | undefined
}

const AppCtx = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [data, setData] = useState<Data>(empty)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<OwnerFilter>('mine')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  const reload = useCallback(async () => {
    if (!userId) { setData(empty); return }
    setLoading(true)
    setError(null)
    try {
      const since = addDays(todayISO(), -14)
      const [pr, hm, hh, pets, stores, items, logs, appts, vax] = await Promise.all([
        supabase.from('profiles').select('*'),
        supabase.from('household_members').select('*'),
        supabase.from('households').select('*').limit(1),
        supabase.from('pets').select('*').eq('archived', false).order('name'),
        supabase.from('stores').select('*').order('name'),
        supabase.from('stock_items').select('*, stock_item_pets(*)').order('name'),
        supabase.from('dose_logs').select('*').gte('slot_date', since),
        supabase.from('appointments').select('*').gte('starts_at', new Date(Date.now() - 86400000).toISOString()).order('starts_at'),
        supabase.from('vaccinations').select('*').order('next_due', { nullsFirst: false })
      ])
      const firstErr = [pr, hm, hh, pets, stores, items, logs, appts, vax].find((r) => r.error)?.error
      if (firstErr) throw firstErr
      const profiles = (pr.data ?? []) as Profile[]
      const petRows = (pets.data ?? []) as Pet[]
      const itemRows = (items.data ?? []) as StockItem[]
      const photos = await signPhotos([
        ...petRows.map((p) => p.photo_path ?? ''),
        ...profiles.map((p) => p.avatar_path ?? ''),
        ...itemRows.map((i) => i.photo_path ?? '')
      ])
      setData({
        photos,
        profile: profiles.find((p) => p.id === userId) ?? null,
        profiles,
        members: (hm.data ?? []) as Member[],
        household: ((hh.data ?? [])[0] ?? null) as Household | null,
        pets: petRows,
        stores: (stores.data ?? []) as Store[],
        items: itemRows,
        logs: (logs.data ?? []) as DoseLog[],
        appointments: (appts.data ?? []) as Appointment[],
        vaccinations: (vax.data ?? []) as Vaccination[]
      })
    } catch (e) {
      setError(e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'Could not load your data')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { void reload() }, [reload])

  const value = useMemo<Ctx>(() => {
    const shared = !!data.profile?.shares_home && data.members.length >= 2
    const others = data.profiles.filter((p) => p.id !== userId)
    const othersLabel = others.length === 1 ? `${others[0].display_name || 'Partner'}'s` : "Others'"
    const f: OwnerFilter = shared ? filter : 'mine'
    return {
      ...data,
      session, authReady, loading, error, userId, reload,
      shared,
      filter: f,
      setFilter,
      othersLabel,
      nameOf: (id: string) => data.profiles.find((p) => p.id === id)?.display_name || 'Someone',
      petById: (id: string) => data.pets.find((p) => p.id === id),
      showOwner: (ownerId: string) => f === 'all' || (f === 'mine' ? ownerId === userId : ownerId !== userId),
      photoUrl: (path) => (path ? data.photos[path] : undefined)
    }
  }, [data, session, authReady, loading, error, userId, reload, filter])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp outside provider')
  return c
}
