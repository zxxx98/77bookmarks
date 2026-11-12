const MAX_ICON_BYTES = 100 * 1024
const MAX_HTML_BYTES = 256 * 1024
const TIMEOUT_MS = 5000
/** A site without a usable icon is not asked again for a while */
const RETRY_AFTER = 6 * 60 * 60 * 1000

async function read(response: Response, limit: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) return null
      chunks.push(value)
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(chunks)
}

const request = (url: string, accept: string) => fetch(url, {
  headers: { accept, 'user-agent': 'Mozilla/5.0 (compatible; bookmarks-icon-fetcher)' },
  signal: AbortSignal.timeout(TIMEOUT_MS),
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
})

/** Icon addresses a page declares, best first; only the head is read */
export function iconLinks(html: string, base: string): string[] {
  const found: { url: string; rank: number }[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attribute = (name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((value) => value !== undefined)
    const rel = attribute('rel')?.toLowerCase() ?? ''
    const href = attribute('href')
    if (!href || !/\bicon\b/.test(rel)) continue
    try {
      const url = new URL(href.replaceAll('&amp;', '&'), base)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      // Touch icons are larger than needed, so the page's ordinary icon goes first
      found.push({ url: url.href, rank: rel.includes('apple') ? 1 : 0 })
    } catch { /* Not an address. */ }
  }
  return found.sort((a, b) => a.rank - b.rank).map((item) => item.url)
}

/** Servers often send favicon.ico without a useful type, so the first bytes decide */
function imageType(bytes: Uint8Array, declared: string): string | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value)
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (starts(0, 0, 1, 0)) return 'image/x-icon'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp'
  return /^image\/svg\+xml$/i.test(declared) ? 'image/svg+xml' : null
}

async function download(url: string): Promise<string | null> {
  try {
    const response = await request(url, 'image/*')
    if (!response.ok) return null
    const bytes = await read(response, MAX_ICON_BYTES)
    const type = bytes?.length ? imageType(bytes, (response.headers.get('content-type') ?? '').split(';')[0].trim()) : null
    return type ? `data:${type};base64,${Buffer.from(bytes!).toString('base64')}` : null
  } catch {
    return null
  }
}

/** Reads the icon a site declares on its homepage, falling back to /favicon.ico */
export async function fetchSiteIcon(origin: string): Promise<string | null> {
  let candidates: string[] = []
  try {
    const response = await request(origin, 'text/html')
    if (response.ok && /html/i.test(response.headers.get('content-type') ?? '')) {
      // An oversized page still has its head at the start
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let html = ''
      let size = 0
      while (reader && size < MAX_HTML_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        html += decoder.decode(value, { stream: true })
        if (/<\/head\s*>/i.test(html)) break
      }
      void reader?.cancel().catch(() => undefined)
      candidates = iconLinks(html, response.url || origin)
    }
  } catch { /* The homepage being unreachable still leaves /favicon.ico to try. */ }
  for (const url of [...candidates.slice(0, 4), `${origin}/favicon.ico`]) {
    const icon = await download(url)
    if (icon) return icon
  }
  return null
}

/** The board asks again for every card without an icon each time it opens; misses are remembered */
export function rememberMisses(fetchIcon: (origin: string) => Promise<string | null>, now: () => number = Date.now) {
  const misses = new Map<string, number>()
  return async (origin: string) => {
    if ((misses.get(origin) ?? 0) > now()) return null
    const icon = await fetchIcon(origin)
    if (icon) misses.delete(origin)
    else misses.set(origin, now() + RETRY_AFTER)
    return icon
  }
}
