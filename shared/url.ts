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

const FRAGMENT_EXACT_MAX = 120
const FRAGMENT_EDGE_MAX = 40

function encodeFragmentText(text: string): string {
  // A dash separates the prefix and suffix of a text directive, so it has to be escaped too
  return encodeURIComponent(text).replace(/-/g, '%2D')
}

/** Leading (or trailing) whole words of a line, about FRAGMENT_EDGE_MAX characters of them */
function edgeWords(line: string, fromEnd: boolean): string {
  const words = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(line)].map((part) => part.segment)
  if (fromEnd) words.reverse()
  let edge = ''
  for (const word of words) {
    if (edge.trim() && edge.length + word.length > FRAGMENT_EDGE_MAX) break
    edge = fromEnd ? word + edge : edge + word
  }
  return edge
}

/**
 * Address that makes the browser scroll to the selected text and highlight it
 * (a `#:~:text=` text fragment). Long or multi-paragraph selections are stored as
 * their first and last words, since one quote cannot span paragraphs.
 */
export function textFragmentUrl(url: string, selection: string): string {
  const lines = selection.split(/[\r\n\t]+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!lines.length) return url
  const first = lines[0]
  const last = lines[lines.length - 1]
  let directive: string
  if (lines.length === 1 && first.length <= FRAGMENT_EXACT_MAX) {
    directive = encodeFragmentText(first)
  } else {
    const start = edgeWords(first, false)
    const end = edgeWords(lines.length === 1 ? first.slice(start.length) : last, true).trim()
    directive = encodeFragmentText(start.trim()) + (end ? `,${encodeFragmentText(end)}` : '')
  }
  const base = url.replace(/:~:.*$/, '')
  return `${base}${base.includes('#') ? '' : '#'}:~:text=${directive}`
}

const SELECTION_TITLE_MAX = 30

/** Link title for a bookmarked selection: its opening words */
export function selectionTitle(selection: string): string {
  const text = selection.replace(/\s+/g, ' ').trim()
  const chars = [...text]
  return chars.length > SELECTION_TITLE_MAX ? `${chars.slice(0, SELECTION_TITLE_MAX).join('').trimEnd()}…` : text
}
