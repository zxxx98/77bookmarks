import { MAX_ICON_BYTES } from './db'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const TIMEOUT_MS = 4000
const MAX_ICON_ATTEMPTS = 3

export interface PageMeta {
  title: string | null
  siteName: string | null
  /** Icon URLs, best candidate first */
  icons: string[]
  /** URL after redirects, or null when the page couldn't be fetched */
  finalUrl: string | null
}

export interface IconData {
  contentType: string
  data: ArrayBuffer
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function clean(value: string | null | undefined, max = 80): string | null {
  if (!value) return null
  const decoded = value
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole
    })
    .replace(/\s+/g, ' ')
    .trim()
  // U+FFFD means the page wasn't UTF-8; a garbled title is worse than none
  if (!decoded || decoded.includes('�')) return null
  return decoded.slice(0, max)
}

const TITLE_SEPARATOR = /\s+[-–—·•_]\s+|\s*[|｜]\s*/
const GENERIC_TITLE = /^(home|homepage|index|welcome|首页|主页|官网)$/i

function titleParts(title: string): string[] {
  return title
    .split(TITLE_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Card title: the site name if the page declares one, else the first meaningful part of <title> */
export function siteTitleFrom(meta: PageMeta): string | null {
  if (meta.siteName) return meta.siteName
  if (!meta.title) return null
  const parts = titleParts(meta.title)
  return parts.find((part) => !GENERIC_TITLE.test(part)) ?? meta.title
}

/**
 * A page describing itself: the browser extension reports the tab title and address of the page it
 * is looking at, which is the only description available for pages this server can't fetch - ones
 * behind a login, or on a private network.
 */
export function reportedMeta(title: string, url: string): PageMeta {
  return { title, siteName: null, icons: [], finalUrl: url }
}

/** Link title: the page title without the site's own name, or null if the page redirected elsewhere (e.g. to a login page) */
export function linkTitleFrom(meta: PageMeta, requestedUrl: string, siteTitle: string): string | null {
  if (!meta.title || !meta.finalUrl) return null
  const requested = new URL(requestedUrl)
  const final = new URL(meta.finalUrl)
  if (final.host !== requested.host || !final.pathname.startsWith(requested.pathname.replace(/\/$/, ''))) return null

  const site = siteTitle.toLowerCase()
  const parts = titleParts(meta.title).filter((part) => !site.includes(part.toLowerCase()) && !requested.hostname.includes(part.toLowerCase()))
  return parts.length ? parts.join(' - ') : null
}

function iconRank(rel: string, sizes: string | null, href: string): number {
  if (rel.includes('apple-touch-icon')) return 1000
  if (/\.svg(\?|$)/i.test(href) || sizes === 'any') return 500
  const size = Math.max(0, ...(sizes ?? '').split(/\s+/).map((s) => parseInt(s, 10) || 0))
  return size || 16
}

export async function fetchPageMeta(pageUrl: string): Promise<PageMeta> {
  const meta: PageMeta = { title: null, siteName: null, icons: [], finalUrl: null }
  try {
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok || !(response.headers.get('Content-Type') ?? '').includes('html')) return meta
    meta.finalUrl = response.url

    let title = ''
    const icons: { href: string; rank: number }[] = []
    const rewriter = new HTMLRewriter()
      .on('head title', {
        text(chunk) {
          title += chunk.text
        },
      })
      .on('meta', {
        element(el) {
          const key = el.getAttribute('property') ?? el.getAttribute('name')
          if (key === 'og:site_name' || key === 'application-name') {
            meta.siteName ??= clean(el.getAttribute('content'), 40)
          }
        },
      })
      .on('link', {
        element(el) {
          const rel = (el.getAttribute('rel') ?? '').toLowerCase()
          const href = el.getAttribute('href')
          if (!href || !/\bicon\b/.test(rel) || rel.includes('mask-icon')) return
          try {
            const resolved = new URL(href, response.url)
            if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
              icons.push({ href: resolved.href, rank: iconRank(rel, el.getAttribute('sizes'), href) })
            }
          } catch {
            // ignore malformed href
          }
        },
      })
    await rewriter.transform(response).arrayBuffer()

    meta.title = clean(title)
    meta.icons = icons.sort((a, b) => b.rank - a.rank).map((icon) => icon.href)
  } catch {
    // unreachable or slow sites just get no metadata
  }
  return meta
}

export async function fetchIcon(iconUrl: string): Promise<IconData | null> {
  try {
    const response = await fetch(iconUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*;q=0.5' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok || Number(response.headers.get('Content-Length') ?? 0) > MAX_ICON_BYTES) return null
    const data = await response.arrayBuffer()
    if (data.byteLength === 0 || data.byteLength > MAX_ICON_BYTES) return null

    const contentType = (response.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
    if (contentType.startsWith('image/')) return { contentType, data }
    // Some servers send .ico files without an image content type
    const head = new Uint8Array(data, 0, Math.min(4, data.byteLength))
    if (head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0) return { contentType: 'image/x-icon', data }
    return null
  } catch {
    return null
  }
}

export async function fetchSiteIcon(origin: string, candidates: string[]): Promise<IconData | null> {
  const urls = [...new Set([...candidates.slice(0, MAX_ICON_ATTEMPTS - 1), `${origin}/favicon.ico`])]
  for (const url of urls) {
    const icon = await fetchIcon(url)
    if (icon) return icon
  }
  return null
}
