/** Keep network stalls shorter than the extension service worker's fetch deadline. */
export function syncFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) })
}
