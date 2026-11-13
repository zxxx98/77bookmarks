import { fullUrl, parseBookmarkUrl } from '../shared/url'
import { platform } from './platform'
import { privateSpace } from './private/session'

export { TITLE_MESSAGE } from './storage/messages'
export { fetchTitleHtml, TITLE_TIMEOUT_MS } from './title-fetch'

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
  // Reading the page would send its address through the server or the extension's worker
  if (privateSpace.active()) return { status: 'fallback' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'fallback' }
  try {
    const found = await platform.pageHtml(fullUrl(parsed.origin, parsed.path), parsed.origin, requestPermission)
    if (found.status === 'permission') return { status: 'permission' }
    const html = found.html
    const title = html ? titleFromHtml(html) : undefined
    return title ? { status: 'success', title } : { status: 'fallback' }
  } catch {
    return { status: 'fallback' }
  }
}
