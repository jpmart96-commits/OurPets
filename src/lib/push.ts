import { supabase } from './supabase'

// Public half of the VAPID key pair (the private half lives only on the server).
export const VAPID_PUBLIC_KEY = 'BImDQb_77y7kwNoZWU9FrCBwl5zW6uSvMbPlMmWl-1YAjhKBQx0hugs9JdMo28-FDLrmxOGI3D2OK3AiPOZn5M0'

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function pushState(): Promise<PushState> {
  if (isIOS() && !isStandalone()) return 'needs-install'
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

function keyBytes(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function b64(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Ask permission, subscribe this device and save it. */
export async function enablePush(userId: string): Promise<void> {
  if (!supported()) throw new Error('This browser cannot show notifications.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in your phone settings.')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) as BufferSource })
  const row = {
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: b64(sub.getKey('p256dh')),
    auth: b64(sub.getKey('auth')),
    user_agent: navigator.userAgent.slice(0, 200)
  }
  const { error } = await supabase.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' })
  if (error) throw error
  // keep the reminder clock in the phone's time zone
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (tz) await supabase.from('profiles').update({ timezone: tz }).eq('id', userId)
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

export async function sendTestPush(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('send-reminders', { body: { test: true } })
  if (error) {
    try {
      const b = await (error as { context?: Response }).context?.json()
      if (b?.error) return String(b.error)
    } catch { /* ignore */ }
    return 'Could not send the test.'
  }
  if (data?.sent) return 'Test sent. It should appear in a few seconds.'
  return `The test could not reach this device${data?.errors?.[0] ? ` (${data.errors[0]})` : ''}.`
}
