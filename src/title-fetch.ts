import { fullUrl, parseBookmarkUrl } from '../shared/url'

export const TITLE_TIMEOUT_MS = 3000
const MAX_HTML_BYTES = 256 * 1024

/** Runs in the extension worker, the browser preview or the self-hosted server. Never prevents saving. */
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
