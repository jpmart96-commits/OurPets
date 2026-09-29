import { supabase } from './supabase'
import { addDays, parseISO, toISO } from './dates'

/** Quick titles offered when logging a visit. */
export const VISIT_KINDS = ['Check-up', 'Vaccines', 'Sick visit', 'Follow-up', 'Blood / urine test', 'Dental', 'Surgery', 'Emergency']

export type FollowUp = 'none' | '1w' | '2w' | '1m' | '3m' | '6m' | '1y' | 'pick'
export const FOLLOW_UPS: { id: FollowUp; label: string }[] = [
  { id: 'none', label: 'No' }, { id: '1w', label: '1 week' }, { id: '2w', label: '2 weeks' }, { id: '1m', label: '1 month' },
  { id: '3m', label: '3 months' }, { id: '6m', label: '6 months' }, { id: '1y', label: '1 year' }, { id: 'pick', label: 'Pick a date' }
]

/** The date a "come back in …" choice lands on, counted from the visit day. */
export function followUpDate(visitDay: string, f: FollowUp, picked: string): string | null {
  if (f === 'none') return null
  if (f === 'pick') return picked || null
  if (f === '1w') return addDays(visitDay, 7)
  if (f === '2w') return addDays(visitDay, 14)
  const months = f === '1m' ? 1 : f === '3m' ? 3 : f === '6m' ? 6 : 12
  const d = parseISO(visitDay)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return toISO(d)
}

/** Local date + HH:MM → ISO timestamp. */
export function localStamp(day: string, time: string): string {
  const d = parseISO(day)
  const [h, m] = (time || '12:00').split(':').map(Number)
  d.setHours(h || 0, m || 0, 0, 0)
  return d.toISOString()
}

export function hhmm(ts: string): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Upload a file the vet gave you and record it in Files, linked to the visit. */
export async function uploadVisitFile(petId: string, visitId: string, day: string, file: File) {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)
  const path = `${petId}/${crypto.randomUUID()}-${safe}`
  const up = await supabase.storage.from('pet-docs').upload(path, file, { contentType: file.type || undefined })
  if (up.error) return { error: up.error }
  const res = await supabase.from('documents').insert({
    pet_id: petId, appointment_id: visitId, title: (file.name.replace(/\.[^.]+$/, '') || 'Vet document').slice(0, 120),
    taken_on: day, storage_path: path, mime_type: file.type || null, size_bytes: file.size
  })
  if (res.error) void supabase.storage.from('pet-docs').remove([path])
  return { error: res.error }
}

const draftKey = (petId: string, visitId: string) => `ourpets.visitDraft.${petId}.${visitId}`
export function loadDraft(petId: string, visitId: string): string | null {
  try { return localStorage.getItem(draftKey(petId, visitId)) } catch { return null }
}
export function saveDraft(petId: string, visitId: string, text: string | null) {
  try {
    if (text == null) localStorage.removeItem(draftKey(petId, visitId))
    else localStorage.setItem(draftKey(petId, visitId), text)
  } catch { /* storage unavailable */ }
}

/** First lines of a note, for previews. */
export function notePreview(notes: string | null, max = 220): string {
  const t = (notes ?? '').trim()
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s.,;:–—-]+$/, '') + '…' : t
}
