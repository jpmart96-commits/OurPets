// product-lookup: given a store product link, return name, photo, price and pack size.
// Reads the page server-side (browsers can't, because of CORS), parses schema.org JSON-LD,
// Open Graph and common meta tags, and copies the product photo into the household's photos bucket.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const MAX_HTML = 3_000_000
const MAX_IMG = 6_000_000

type Json = Record<string, unknown>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// ── safety: only public http(s) hosts ──
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  if (h.includes(':')) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h === '::'
  return false
}

async function assertPublic(u: URL) {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) links are supported')
  if (isPrivateHost(u.hostname)) throw new Error('That address is not allowed')
  try {
    const addrs = [
      ...(await Deno.resolveDns(u.hostname, 'A').catch(() => [] as string[])),
      ...(await Deno.resolveDns(u.hostname, 'AAAA').catch(() => [] as string[]))
    ]
    if (addrs.some(isPrivateHost)) throw new Error('That address is not allowed')
  } catch (e) {
    if (e instanceof Error && e.message.includes('not allowed')) throw e
  }
}

async function safeFetch(url: string, accept: string, maxBytes: number): Promise<{ res: Response; body: Uint8Array; finalUrl: string }> {
  let current = new URL(url)
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(current)
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8' },
      signal: AbortSignal.timeout(12000)
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current)
      await res.body?.cancel()
      continue
    }
    const reader = res.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > maxBytes) { await reader.cancel(); break }
        chunks.push(value)
      }
    }
    const body = new Uint8Array(size > maxBytes ? chunks.reduce((s, c) => s + c.length, 0) : size)
    let o = 0
    for (const c of chunks) { body.set(c, o); o += c.length }
    return { res, body, finalUrl: current.toString() }
  }
  throw new Error('Too many redirects')
}

// ── parsing ──
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

function metaContent(html: string, key: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key.replace(/[.:]/g, '\\$&')}["'][^>]*>`, 'i')
  const tag = html.match(re)?.[0]
  if (!tag) return undefined
  const c = tag.match(/content=["']([^"']*)["']/i)?.[1]
  return c ? decodeEntities(c).trim() : undefined
}

function flattenLd(node: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(node)) node.forEach((n) => flattenLd(n, out))
  else if (node && typeof node === 'object') {
    const o = node as Json
    out.push(o)
    if (o['@graph']) flattenLd(o['@graph'], out)
    if (o['hasVariant']) flattenLd(o['hasVariant'], out)
  }
  return out
}

function isType(o: Json, t: string) {
  const ty = o['@type']
  return Array.isArray(ty) ? ty.includes(t) : ty === t
}

function firstString(v: unknown): string | undefined {
  if (!v) return undefined
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return firstString(v[0])
  if (typeof v === 'object') {
    const o = v as Json
    return firstString(o.url ?? o.contentUrl ?? o.name ?? o['@id'])
  }
  return undefined
}

function offerPrice(offers: unknown): { price?: number; currency?: string } {
  const list = flattenLd(offers)
  for (const o of list) {
    const p = o.price ?? o.lowPrice ?? (o.priceSpecification as Json | undefined)?.price
    const n = typeof p === 'number' ? p : typeof p === 'string' ? parseFloat(p.replace(',', '.')) : NaN
    if (Number.isFinite(n) && n > 0) return { price: n, currency: (o.priceCurrency as string) ?? undefined }
  }
  return {}
}

function cleanTitle(t: string, site?: string): string {
  let s = decodeEntities(t).replace(/\s+/g, ' ').trim()
  const parts = s.split(/\s[|–—-]\s/)
  if (parts.length > 1) {
    const last = parts[parts.length - 1].toLowerCase()
    if ((site && last.includes(site.toLowerCase())) || /zooplus|newpet|kiwoko|tiendanimal|amazon|loja|store|shop/.test(last)) s = parts.slice(0, -1).join(' - ')
  }
  s = s.replace(/^comprar\s+/i, '').replace(/\s+(em|na|no)\s+(zooplus|newpet).*$/i, '')
  return s.trim()
}

// "12 kg", "2 x 12 kg", "400g", "10 L", "60 comprimidos", "24 x 85 g"
function parseSize(text: string): { pack_kg?: number; units?: number; pack_text?: string; pack_units?: number } {
  // drop weight ranges like "20-40 kg" (dog size, not pack size)
  const t = text.toLowerCase().replace(/,/g, '.').replace(/\d+(?:\.\d+)?\s*(?:-|a|to)\s*\d+(?:\.\d+)?\s*kg/g, ' ')
  // "10 kg + 2 kg grátis" → 12 kg, "2 x (10 kg + 2kg grátis!)" → 24 kg
  const bonus = t.match(/(?:(\d+)\s*x\s*\(\s*)?(\d+(?:\.\d+)?)\s*(kg|g)\s*\+\s*(\d+(?:\.\d+)?)\s*(kg|g)\b/)
  if (bonus) {
    const kgOf = (v: string, u: string) => (u === 'kg' ? Number(v) : Number(v) / 1000)
    const n = bonus[1] ? Number(bonus[1]) : 1
    const total = n * (kgOf(bonus[2], bonus[3]) + kgOf(bonus[4], bonus[5]))
    return { pack_kg: +total.toFixed(3), pack_text: `${+total.toFixed(3)} kg` }
  }
  // "12 x 135 g", "24 x 85 g", "6 x 400 ml": multipacks of cans/pouches. Small units → also pack_units.
  const multi = t.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|ml)\b/)
  if (multi) {
    const n = Number(multi[1]), v = Number(multi[2])
    const eachKg = multi[3] === 'kg' ? v : v / 1000
    const out: { pack_kg?: number; units?: number; pack_text?: string; pack_units?: number } = { pack_kg: +(n * eachKg).toFixed(3), pack_text: multi[0] }
    if (n > 1 && eachKg <= 1) out.pack_units = n
    return out
  }
  const kg = t.match(/(\d+(?:\.\d+)?)\s*kg\b/)
  if (kg) return { pack_kg: Number(kg[1]), pack_text: kg[0] }
  const g = t.match(/(\d+(?:\.\d+)?)\s*g\b/)
  const units = t.match(/(\d+)\s*(comprimidos?|comp\.?|tablets?|pastilhas?|cápsulas|capsulas|capsules|chews?|saquetas|sachets?|pipetas|pipettes?|unidades|un\.?|doses)\b/)
  if (units) return { units: Number(units[1]), pack_text: units[0] }
  if (g) return { pack_kg: +(Number(g[1]) / 1000).toFixed(3), pack_text: g[0] }
  const l = t.match(/(\d+(?:\.\d+)?)\s*(l|litros?|liters?)\b/)
  if (l) return { pack_text: l[0] }
  return {}
}

// what the units in a multipack are, for food tracked by units
function unitLabel(text: string): 'can' | 'pouch' | 'tray' | 'sachet' {
  const t = text.toLowerCase()
  if (/saquetas?|pouch|bolsas?|frischebeutel/.test(t)) return 'pouch'
  if (/tabuleiros?|terrinas?|barquetas?|trays?|tarrinas?|schalen/.test(t)) return 'tray'
  if (/sachets?|sobres?/.test(t)) return 'sachet'
  return 'can'
}

function medForm(text: string): string | undefined {
  const t = text.toLowerCase()
  if (/pipeta|pipette|gotas|drops|solução|liquid|xarope/.test(t)) return 'dose'
  if (/saqueta|sachet/.test(t)) return 'sachet'
  if (/cápsula|capsula|capsule/.test(t)) return 'capsule'
  if (/chew|mastig/.test(t)) return 'chew'
  if (/comprimid|tablet|pastilha/.test(t)) return 'tablet'
  return undefined
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function textName(v: unknown): string | undefined {
  const s = firstString(typeof v === 'object' && v && !Array.isArray(v) ? (v as Json).name : v)
  return s && !/^https?:/.test(s) ? s : undefined
}

function props(o: Json | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of flattenLd(o?.additionalProperty ?? [])) {
    if (typeof p.name === 'string') out[p.name.toLowerCase()] = String(p.value ?? '')
  }
  return out
}

function guessType(name: string, context: string, productType?: string): 'food' | 'med' | 'supply' {
  const pt = (productType ?? '').toLowerCase()
  if (pt.includes('food') || pt.includes('snack')) return 'food'
  if (/medic|pharma|health|parasit/.test(pt)) return 'med'
  const n = name.toLowerCase()
  const c = context.toLowerCase()
  const MED = /comprimid|tablet|pipeta|pipette|antiparasit|desparasit|verm[ií]fug|suplemento|supplement|probi[óo]tic|condroprotetor|\d\s?mg\b|medicament|spot[- ]on|farmácia|farmacia|antipulgas|pulgas|carraças/
  const FOOD = /ra[çc][ãa]o|racoes|comida|alimento|snack|biscoit|h[úu]mid|pat[êe]|croquete|\bfood\b|saquetas? de|lata|mousse|seca\b/
  const SUPPLY = /areia|arena|litter|resguardo|toalhit|sacos|champ[ôo]|shampoo|brinquedo|\btoy|cama\b|coleira|arranhador|higiene|comedouro|bebedouro|transportadora/
  if (MED.test(n)) return 'med'
  if (FOOD.test(n)) return 'food'
  if (SUPPLY.test(n)) return 'supply'
  if (MED.test(c)) return 'med'
  if (SUPPLY.test(c)) return 'supply'
  return 'food'
}

interface Variant { label: string; name?: string; price?: number; url?: string; image?: string; pack_kg?: number; units?: number; pack_text?: string; pack_units?: number }

function extract(html: string, pageUrl: string) {
  const ld: Json[] = []
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { flattenLd(JSON.parse(m[1].trim()), ld) } catch { /* ignore broken blocks */ }
  }
  const page = new URL(pageUrl)
  const group = ld.find((o) => isType(o, 'ProductGroup'))
  const groupVariants = group ? flattenLd(group.hasVariant ?? []).filter((o) => isType(o, 'Product')) : []
  const wanted = page.searchParams.get('activeVariant') ?? page.searchParams.get('variant') ?? page.searchParams.get('v')
  const product: Json | undefined =
    (wanted ? groupVariants.find((v) => String(v.sku ?? '') === wanted || String(v.url ?? '').includes(wanted)) : undefined) ??
    ld.find((o) => isType(o, 'Product') && !groupVariants.includes(o)) ??
    groupVariants[0] ?? group

  const site = metaContent(html, 'og:site_name')
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const drupalTitle = html.match(/field--name-title[^>]*>([^<]+)</i)?.[1]

  let name = firstString(product?.name) ?? metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title') ?? (drupalTitle ? stripTags(drupalTitle) : undefined) ?? (h1 ? stripTags(h1) : undefined) ?? titleTag
  name = name ? cleanTitle(stripTags(name), site) : undefined
  const brand = textName(product?.brand) ?? textName(group?.brand)

  let image = firstString(product?.image) ?? firstString(group?.image) ?? metaContent(html, 'og:image') ?? metaContent(html, 'og:image:secure_url') ?? metaContent(html, 'twitter:image')
  if (!image) {
    // Shops without metadata (e.g. Drupal Commerce): first image whose path looks like a product photo
    const img = html.match(/<img[^>]+src=["']([^"']*(?:styles\/product|\/produtos?\/|\/products?\/)[^"']*)["']/i)?.[1]
    if (img) image = decodeEntities(img)
  }
  if (image) { try { image = new URL(image, pageUrl).toString() } catch { image = undefined } }

  let { price, currency } = offerPrice(product?.offers)
  if (!price) {
    const p = metaContent(html, 'product:price:amount') ?? metaContent(html, 'og:price:amount') ?? metaContent(html, 'price')
      ?? html.match(/class=["'][^"']*calculated-price[^"']*["'][^>]*>\s*([\d.,]+)/i)?.[1]
      ?? html.match(/itemprop=["']price["'][^>]*content=["']([\d.,]+)/i)?.[1]
    if (p) { const n = parseFloat(p.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')); if (Number.isFinite(n)) price = n }
    currency = currency ?? metaContent(html, 'product:price:currency') ?? (price ? 'EUR' : undefined)
  }
  const rawDesc = firstString(group?.description) ?? firstString(product?.description) ?? metaContent(html, 'og:description') ?? metaContent(html, 'description')
  const description = rawDesc ? stripTags(rawDesc).slice(0, 300) : undefined

  // Size variants
  let variants: Variant[] = []
  if (groupVariants.length > 1) {
    variants = groupVariants.map((v) => {
      const vn = firstString(v.name) ?? ''
      const size = parseSize(vn)
      const base = name && group?.name ? String(group.name) : ''
      const label = (base && vn.startsWith(base) ? vn.slice(base.length) : vn).replace(/^[\s:,-]+/, '').trim() || size.pack_text || vn
      return { label, name: vn || undefined, price: offerPrice(v.offers).price, url: firstString(v.url), image: firstString(v.image), ...size }
    })
  } else {
    // Drupal Commerce / plain HTML: <select name="purchased_entity[0][attributes][attribute_weight]"> options
    const sel = html.match(/<select[^>]+name=["'][^"']*attribute_(?:weight|size|peso|tamanho|quantidade)[^"']*["'][^>]*>([\s\S]*?)<\/select>/i)?.[1]
    if (sel) {
      variants = [...sel.matchAll(/<option[^>]*>([^<]+)/gi)].map((m) => stripTags(m[1])).filter((l) => l && !/^-|escolh|select/i.test(l))
        .map((label) => ({ label, ...parseSize(label) }))
      if (variants.length < 2) variants = []
    }
  }

  const selectedLabel = html.match(/<option[^>]*selected[^>]*>([^<]+)/i)?.[1]
  const sizeText = [name, firstString(product?.size), variants.length && selectedLabel ? stripTags(selectedLabel) : undefined, page.pathname].filter(Boolean).join(' ')
  let size = parseSize(sizeText)
  if (!size.pack_kg && !size.units && selectedLabel) size = parseSize(stripTags(selectedLabel))

  const pr = { ...props(group), ...props(product) }
  const productType = pr['product_type assortment'] ?? pr['product_type'] ?? firstString(group?.category) ?? firstString(product?.category)
  const context = [firstString(group?.category), firstString(product?.category), page.pathname, description].filter(Boolean).join(' ')
  let type = guessType(name ?? '', context, productType)
  // "12 x 135 g" multipacks are wet food (cans/pouches), even when filed under supplements or diets
  if (type !== 'food' && size.pack_units && size.pack_kg && size.pack_kg / size.pack_units >= 0.04 &&
    !/areia|litter|champ[ôo]|shampoo|higiene|toalhit/.test((name ?? '').toLowerCase())) type = 'food'
  if (type === 'med') delete size.pack_kg
  if (type !== 'food') delete size.pack_units
  const unit_label = type === 'food' && (size.pack_units || variants.some((v) => v.pack_units)) ? unitLabel([name, page.pathname].join(' ')) : undefined
  return {
    name, brand, image, price, currency, description,
    ...size,
    unit_label,
    type,
    form: type === 'med' ? medForm([name, description].join(' ')) : undefined,
    site: site ?? page.hostname.replace(/^www\./, ''),
    variants: variants.length > 1 ? variants.slice(0, 12) : undefined,
    selected: variants.length > 1 ? Math.max(0, variants.findIndex((v) => (v.name && v.name === name) || (selectedLabel && v.label === stripTags(selectedLabel)))) : undefined
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let url: string
  let debug = false
  try {
    const body = await req.json()
    debug = body.debug === true
    url = String(body.url ?? '').trim()
    new URL(url)
  } catch {
    return json({ error: 'Send a full product link, starting with https://' }, 400)
  }

  let page
  try {
    page = await safeFetch(url, 'text/html,application/xhtml+xml', MAX_HTML)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not open that link' }, 400)
  }
  if (!page.res.ok) {
    const snippet = debug ? new TextDecoder().decode(page.body).slice(0, 300) : undefined
    return json({ error: page.res.status === 403 || page.res.status === 429 ? 'The store blocked the lookup. Fill the details in by hand.' : `The store answered ${page.res.status}.`, status: page.res.status, snippet }, 200)
  }
  const html = new TextDecoder().decode(page.body)
  const info = extract(html, page.finalUrl)

  // Copy the product photo into the household's private photos bucket (needs a signed-in user)
  let photo_path: string | undefined
  const auth = req.headers.get('Authorization') ?? ''
  if (info.image && auth) {
    try {
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
      const { data: userData } = await sb.auth.getUser()
      if (userData.user) {
        const { data: m } = await sb.from('household_members').select('household_id').eq('user_id', userData.user.id).limit(1).maybeSingle()
        if (m?.household_id) {
          const img = await safeFetch(info.image, 'image/avif,image/webp,image/png,image/jpeg,image/*', MAX_IMG)
          const ct = (img.res.headers.get('content-type') ?? '').split(';')[0].trim()
          if (img.res.ok && ct.startsWith('image/') && img.body.length > 200) {
            const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg'
            const path = `${m.household_id}/items/${crypto.randomUUID()}.${ext}`
            const up = await sb.storage.from('photos').upload(path, img.body, { contentType: ct })
            if (!up.error) photo_path = path
          }
        }
      }
    } catch { /* photo is optional */ }
  }

  const dbg = debug
    ? { html_bytes: html.length, ld_types: [...html.matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)].map((m) => m[1]).slice(0, 20), head: html.slice(0, 300) }
    : undefined
  return json({ ...info, photo_path, url: page.finalUrl, debug: dbg })
})
