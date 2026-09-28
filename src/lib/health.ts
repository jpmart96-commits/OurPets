import { supabase } from './supabase'
import { resizeImage } from './photos'

/** One-tap tags for the health journal. `good` is the only positive one. */
export const HEALTH_TAGS: { id: string; label: string; good?: boolean }[] = [
  { id: 'ate_less', label: 'Ate less' },
  { id: 'no_food', label: "Didn't eat" },
  { id: 'vomit', label: 'Vomited' },
  { id: 'diarrhoea', label: 'Diarrhoea' },
  { id: 'drink_more', label: 'Drinking more' },
  { id: 'pee_more', label: 'Peeing more' },
  { id: 'low_energy', label: 'Low energy' },
  { id: 'itching', label: 'Scratching' },
  { id: 'cough', label: 'Coughing / sneezing' },
  { id: 'limping', label: 'Limping' },
  { id: 'good', label: 'Good day', good: true },
  { id: 'other', label: 'Other' }
]

export function tagLabel(id: string): string {
  return HEALTH_TAGS.find((t) => t.id === id)?.label ?? id
}

/** Journal photos live next to the pet's files: pet-docs/<pet_id>/notes/<random>.jpg */
export async function uploadNotePhoto(petId: string, file: File): Promise<string> {
  const blob = await resizeImage(file, 1600)
  const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${petId}/notes/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('pet-docs').upload(path, blob, { contentType: blob.type || file.type || 'image/jpeg' })
  if (error) throw error
  return path
}

export async function signPetDocs(paths: string[], seconds = 3600): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return {}
  const { data } = await supabase.storage.from('pet-docs').createSignedUrls(unique, seconds)
  const out: Record<string, string> = {}
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  return out
}

/** Open a private file in a new tab (opens the tab first so phones don't block it). */
export async function openPetDoc(path: string): Promise<string | null> {
  const w = window.open('', '_blank')
  const { data, error } = await supabase.storage.from('pet-docs').createSignedUrl(path, 120)
  if (error || !data) { w?.close(); return error?.message ?? 'Could not open the file' }
  if (w) w.location.href = data.signedUrl
  else window.location.href = data.signedUrl
  return null
}

/** Count problem tags in [from, to) — e.g. the last 30 days. */
export function tagCounts(notes: { noted_at: string; tags: string[] }[], from: Date, to: Date): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of notes) {
    const t = new Date(n.noted_at)
    if (t < from || t >= to) continue
    for (const tag of n.tags) out[tag] = (out[tag] ?? 0) + 1
  }
  return out
}
