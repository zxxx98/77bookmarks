import { fullUrl, parseBookmarkUrl } from '../shared/url'

export const TITLE_MESSAGE = '77bookmarks:page-title'
export const TITLE_TIMEOUT_MS = 3000
const MAX_HTML_BYTES = 256 * 1024

/** Runs in either the extension worker or the browser preview. Never prevents saving. */
export async function fetchTitleHtml(input: string): Promise<string | null> {
  const parsed = parseBookmarkUrl(input)
  if (!parsed?.path) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(fullUrl(parsed.origin, parsed.path), {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !/^(text\/html|application\/xhtml\+xml)\b/i.test(contentType) || !response.body) return null
    // Bound both download time and size; title fetching must not download a whole large page.
    reader = response.body.getReader()
    const charset = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] ?? 'utf-8'
    const decoder = new TextDecoder(charset)
    let html = ''
    let size = 0
    while (size < MAX_HTML_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value.subarray(0, MAX_HTML_BYTES - size)
      size += chunk.byteLength
      html += decoder.decode(chunk, { stream: true })
      if (/<\/head\s*>/i.test(html)) break
    }
    return html + decoder.decode()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    void reader?.cancel().catch(() => undefined)
    controller.abort()
  }
}

/** A template parses entities and markup without executing scripts or loading page resources. */
export function titleFromHtml(html: string): string | undefined {
  const template = document.createElement('template')
  template.innerHTML = html
  // A truncated download must not turn an unfinished title into a misleading name.
  if (!/<\/title\s*>/i.test(html)) return undefined
  return template.content.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined
}

export type PageTitleResult = { status: 'success'; title: string } | { status: 'permission' | 'fallback' }

/** Automatic lookups only use existing access. Request new access directly from a button gesture. */
export async function requestPageTitle(input: string, { requestPermission = false } = {}): Promise<PageTitleResult> {
  const parsed = parseBookmarkUrl(input)
  if (!parsed?.path) return { status: 'fallback' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'fallback' }
  try {
    let html: string | null
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      const permissions = { origins: [`${parsed.origin}/*`] }
      const granted = await (requestPermission ? chrome.permissions.request(permissions) : chrome.permissions.contains(permissions))
      if (!granted) return { status: requestPermission ? 'fallback' : 'permission' }
      const response = await chrome.runtime.sendMessage({ type: TITLE_MESSAGE, url: fullUrl(parsed.origin, parsed.path) })
      html = typeof response?.html === 'string' ? response.html : null
    } else {
      html = await fetchTitleHtml(input)
    }
    const title = html ? titleFromHtml(html) : undefined
    return title ? { status: 'success', title } : { status: 'fallback' }
  } catch {
    return { status: 'fallback' }
  }
}
