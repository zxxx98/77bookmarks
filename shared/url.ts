const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|msclkid|mc_cid|mc_eid|igshid|spm)$/i
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

export interface ParsedBookmark {
  /** Card key, e.g. https://github.com */
  origin: string
  /** Host with port, e.g. github.com */
  host: string
  /** Path + query + hash, or null when the URL points at the site root */
  path: string | null
}

export function parseBookmarkUrl(input: string): ParsedBookmark | null {
  const raw = input.trim()
  if (!raw || /\s/.test(raw)) return null
  const typedScheme = HAS_SCHEME.test(raw)

  let url: URL
  try {
    url = new URL(typedScheme ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // Also catches scheme-only inputs like mailto:a@b.com, which parse as user:pass@host
  if (url.username || url.password) return null
  // Bare words like "foo" are almost always typos rather than hostnames
  if (!typedScheme && !url.hostname.includes('.') && url.hostname !== 'localhost') return null

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key)
  }
  const path = url.pathname + url.search + url.hash
  return { origin: url.origin, host: url.host, path: path === '/' ? null : path }
}

const MAX_ICON_URL = 2000
const MAX_INTRANET_URL = 2000

/** Normalized http(s) address of a custom icon image, or null */
export function parseIconUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw || raw.length > MAX_ICON_URL || /\s/.test(raw)) return null
  const typedScheme = HAS_SCHEME.test(raw)
  try {
    const url = new URL(typedScheme ? raw : `https://${raw}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!typedScheme && !url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.href
  } catch {
    return null
  }
}

/** Normalized http(s) address of an intranet URL, or null */
export function parseIntranetUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw || raw.length > MAX_INTRANET_URL || /\s/.test(raw)) return null
  const typedScheme = HAS_SCHEME.test(raw)
  try {
    const url = new URL(typedScheme ? raw : `http://${raw}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (!typedScheme && !url.hostname.includes('.') && url.hostname !== 'localhost' && !/^\d+(\.\d+){3}$/.test(url.hostname)) return null
    const path = url.pathname + url.search + url.hash
    return path === '/' ? url.origin : url.origin + path
  } catch {
    return null
  }
}

export function fullIntranetUrl(intranetUrl: string, path: string | null): string {
  if (!path) return intranetUrl
  return intranetUrl.replace(/\/+$/, '') + path
}

export function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//, '')
}

export function fullUrl(origin: string, path: string | null): string {
  return origin + (path ?? '')
}

/** Title used for a link when the page title can't be fetched */
export function fallbackLinkTitle(path: string): string {
  const pathname = path.split(/[?#]/)[0]
  const segment = pathname.split('/').filter(Boolean).pop()
  if (!segment) return path
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
