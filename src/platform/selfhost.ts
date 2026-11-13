import type { AccessTokenStatus, UpdateStatus, UpdateTriggerResult } from '../../shared/types'
import type { Platform } from './types'

const EXPIRED = '77bookmarks:session-expired'
const CHANGED = '77bookmarks:changed'

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('无法连接服务器，请检查网络后重试')
  }
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null
  if (!response.ok) {
    // Signing in answers 401 for a wrong password, which is not an expired session
    if (response.status === 401 && path !== '/login') window.dispatchEvent(new Event(EXPIRED))
    throw new Error(data?.error ?? `请求失败（HTTP ${response.status}）`)
  }
  return data as T
}

let source: EventSource | undefined
let listeners = 0
const announce = () => window.dispatchEvent(new Event(CHANGED))
/** One event stream per page, open only while something is listening */
function watch() {
  if (source || typeof EventSource === 'undefined') return
  source = new EventSource('/api/events')
  source.addEventListener('changed', announce)
  // Changes made while the stream was down are caught up on once it is back
  let dropped = false
  source.addEventListener('error', () => { dropped = true })
  source.addEventListener('open', () => { if (dropped) { dropped = false; announce() } })
}
// A proxy that buffers the stream would otherwise leave a tab stale until it is reloaded
const onVisible = () => { if (document.visibilityState === 'visible') announce() }

/**
 * The self-hosted edition: the data service runs on the server, and every browser that
 * signs in sees the same data. The page keeps nothing but appearance preferences.
 */
export const selfhostPlatform: Platform = {
  kind: 'selfhost',
  async call(method, ...args) {
    return (await request<{ value: never }>('/rpc', 'POST', { method, args })).value
  },
  async syncCall(method, ...args) {
    return (await request<{ value: never }>('/sync', 'POST', { method, args })).value
  },
  onDataChanged(listener) {
    window.addEventListener(CHANGED, listener)
    if (listeners++ === 0) {
      watch()
      document.addEventListener('visibilitychange', onVisible)
    }
    return () => {
      window.removeEventListener(CHANGED, listener)
      if (--listeners === 0) {
        source?.close()
        source = undefined
        document.removeEventListener('visibilitychange', onVisible)
      }
    }
  },
  // Theme and layout choices belong to the browser showing them, so localStorage is enough
  preferences: { hydrate: async () => {}, mirror: () => {} },
  async pageHtml(url) {
    // The server reads the page: no browser permission is involved and no CORS applies
    return { status: 'ok', html: (await request<{ html: string | null }>('/page-title', 'POST', { url })).html }
  },
  incognito: {
    // A page has no way to open an incognito window; the right-click extension does, and
    // announces itself on the pages of the server it is connected to
    open(url) {
      if (document.documentElement.dataset.bookmarks77Clipper !== '1') return Promise.resolve(false)
      return new Promise<boolean>((resolve) => {
        const id = crypto.getRandomValues(new Uint32Array(2)).join('-')
        const finish = (ok: boolean) => { clearTimeout(timer); window.removeEventListener('message', onMessage); resolve(ok) }
        const onMessage = (event: MessageEvent) => {
          if (event.source !== window || event.data?.source !== '77bookmarks-clipper' || event.data.id !== id) return
          finish(event.data.ok === true)
        }
        const timer = setTimeout(() => finish(false), 2500)
        window.addEventListener('message', onMessage)
        window.postMessage({ source: '77bookmarks-page', type: 'open-incognito', id, url }, window.location.origin)
      })
    },
  },
  session: {
    status: () => request<{ authenticated: boolean; siteName: string }>('/session'),
    login: async (password) => { await request('/login', 'POST', { password }) },
    logout: async () => {
      await request('/logout', 'POST')
      source?.close()
      source = undefined
    },
    onExpired(listener) {
      window.addEventListener(EXPIRED, listener)
      return () => window.removeEventListener(EXPIRED, listener)
    },
  },
  clipper: {
    status: async () => (await request<{ status: AccessTokenStatus | null }>('/token')).status,
    async create() {
      const { token, createdAt } = await request<{ token: string; createdAt: number }>('/token', 'POST')
      // The extension splits this into the address of this page and the token; a fragment
      // is never sent to a server, so opening the code by accident reveals nothing
      return { code: `${window.location.origin}/#${token}`, createdAt }
    },
    revoke: async () => { await request('/token', 'DELETE') },
  },
  update: {
    status: () => request<UpdateStatus>('/update'),
    check: () => request<UpdateStatus>('/update/check', 'POST'),
    apply: () => request<UpdateTriggerResult>('/update/apply', 'POST'),
  },
}
