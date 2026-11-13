import { fetchTitleHtml } from '../title-fetch'
import { DATA_CHANGED, DATA_MESSAGE, SYNC_MESSAGE, TITLE_MESSAGE } from '../storage/messages'
import type { LocalService } from '../storage/service'
import type { Platform } from './types'

/** False in the plain browser preview, where the same code runs without an extension around it */
export const isExtension = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id

let previewService: Promise<LocalService> | undefined
let channel: BroadcastChannel | undefined
function previewChannel() {
  if (typeof BroadcastChannel !== 'undefined') channel ??= new BroadcastChannel(DATA_CHANGED)
  return channel
}
function announce() {
  window.dispatchEvent(new Event(DATA_CHANGED))
  previewChannel()?.postMessage(DATA_CHANGED)
}

/**
 * The extension edition: data sits in the profile's IndexedDB and is owned by the background
 * worker. Opened as an ordinary page (the preview) it runs the same service in the page.
 */
export const extensionPlatform: Platform = {
  kind: 'extension',
  async call(method, ...args) {
    if (isExtension()) {
      // Chrome messages use JSON serialization: [undefined] becomes [null], bypassing defaults.
      const values: unknown[] = [...args]
      while (values.length && values.at(-1) === undefined) values.pop()
      const response = await chrome.runtime.sendMessage({ type: DATA_MESSAGE, method, args: values })
      if (!response?.ok) throw new Error(response?.error ?? '本地数据服务不可用，请重新加载扩展')
      return response.value
    }
    // Browser preview uses the exact same database implementation, in its own origin.
    const { LocalService, READ_METHODS } = await import('../storage/service')
    const service = await (previewService ??= Promise.resolve(new LocalService()))
    const run = service[method] as (...values: unknown[]) => Promise<unknown>
    const result = await run.apply(service, args)
    if (!READ_METHODS.has(method)) announce()
    return result as never
  },
  async syncCall(method, ...args) {
    if (isExtension()) {
      const response = await chrome.runtime.sendMessage({ type: SYNC_MESSAGE, method, args })
      if (!response?.ok) throw new Error(response?.error ?? '云同步不可用，请重新加载扩展')
      // The worker announces the data change; the page only needs its own copy refreshed
      if (response.changed) window.dispatchEvent(new Event(DATA_CHANGED))
      return response.value
    }
    const [{ LocalService }, { runSyncMethod }] = await Promise.all([import('../storage/service'), import('../sync/control')])
    const service = await (previewService ??= Promise.resolve(new LocalService()))
    const { value, changed } = await runSyncMethod(service, method, args)
    if (changed) announce()
    return value as never
  },
  onDataChanged(listener) {
    if (isExtension()) {
      const handler = (message: { type?: string }) => { if (message.type === DATA_CHANGED) listener() }
      chrome.runtime.onMessage.addListener(handler)
      return () => chrome.runtime.onMessage.removeListener(handler)
    }
    const broadcast = previewChannel()
    window.addEventListener(DATA_CHANGED, listener)
    broadcast?.addEventListener('message', listener)
    return () => { window.removeEventListener(DATA_CHANGED, listener); broadcast?.removeEventListener('message', listener) }
  },
  preferences: {
    async hydrate() {
      if (!isExtension()) return
      const values = await chrome.storage.local.get(null)
      for (const [key, value] of Object.entries(values)) if (key.startsWith('ui:') && typeof value === 'string') localStorage.setItem(key.slice(3), value)
    },
    mirror(key, value) {
      if (!isExtension()) return
      if (value === null) void chrome.storage.local.remove(`ui:${key}`).catch(() => undefined)
      else void chrome.storage.local.set({ [`ui:${key}`]: value }).catch(() => undefined)
    },
  },
  async pageHtml(url, origin, requestPermission) {
    if (!isExtension()) return { status: 'ok', html: await fetchTitleHtml(url) }
    const permissions = { origins: [`${origin}/*`] }
    const granted = await (requestPermission ? chrome.permissions.request(permissions) : chrome.permissions.contains(permissions))
    if (!granted) return requestPermission ? { status: 'ok', html: null } : { status: 'permission' }
    const response = await chrome.runtime.sendMessage({ type: TITLE_MESSAGE, url })
    return { status: 'ok', html: typeof response?.html === 'string' ? response.html : null }
  },
  // An extension may open incognito windows without being allowed to run inside them
  get incognito() {
    if (typeof chrome === 'undefined' || !chrome.windows?.create) return undefined
    return {
      async open(url: string) {
        try {
          // Incognito windows are only listed once the user let the extension into them;
          // until then every address gets a window of its own, in the same incognito session
          const windows = await chrome.windows.getAll({ windowTypes: ['normal'] }).catch(() => [])
          const existing = windows.find((window) => window.incognito && window.id !== undefined)
          if (existing?.id !== undefined) {
            await chrome.tabs.create({ windowId: existing.id, url })
            await chrome.windows.update(existing.id, { focused: true })
          } else {
            await chrome.windows.create({ url, incognito: true, focused: true })
          }
          return true
        } catch {
          return false // Incognito is switched off for this browser, or the address is not allowed there
        }
      },
    }
  },
  // Looked up on every use: the preview has no such API and says so in the sync settings
  get hostAccess() {
    if (typeof chrome === 'undefined' || !chrome.permissions) return undefined
    return {
      contains: (origin: string) => chrome.permissions.contains({ origins: [origin] }),
      request: (origin: string) => chrome.permissions.request({ origins: [origin] }),
    }
  },
}
