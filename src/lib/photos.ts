import { supabase } from './supabase'

export type PhotoKind = 'pets' | 'people' | 'items'

/** Shrink a camera photo to at most `max` px on the long side, as JPEG. Falls back to the original file. */
export async function resizeImage(file: File, max = 1024): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
    return blob ?? file
  } catch {
    return file
  }
}

export async function uploadPhoto(householdId: string, kind: PhotoKind, file: File): Promise<string> {
  const blob = await resizeImage(file)
  const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${householdId}/${kind}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: blob.type || file.type || 'image/jpeg', upsert: false })
  if (error) throw error
  return path
}

export async function removePhoto(path: string | null | undefined) {
  if (!path) return
  await supabase.storage.from('photos').remove([path])
}

export async function signPhotos(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))]
  if (!unique.length) return {}
  const { data, error } = await supabase.storage.from('photos').createSignedUrls(unique, 60 * 60 * 24)
  if (error || !data) return {}
  const out: Record<string, string> = {}
  for (const d of data) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  return out
}
