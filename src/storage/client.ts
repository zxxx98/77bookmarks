import type { LocalService, ServiceMethod } from './service'
import { runSyncMethod, type SyncMethod, type SyncResults } from '../sync/control'

export const DATA_MESSAGE = '77bookmarks:data'
export const DATA_CHANGED = '77bookmarks:changed'
export const SYNC_MESSAGE = '77bookmarks:sync'
export const isExtension = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id
let previewService: Promise<LocalService> | undefined
let channel: BroadcastChannel | undefined
function previewChannel() {
  if (typeof BroadcastChannel !== 'undefined') channel ??= new BroadcastChannel(DATA_CHANGED)
  return channel
}

export async function call<K extends ServiceMethod>(method: K, ...args: Parameters<LocalService[K]>): Promise<Awaited<ReturnType<LocalService[K]>>> {
  if (isExtension()) {
    // Chrome messages use JSON serialization: [undefined] becomes [null], bypassing defaults.
    const values = [...args]
    while (values.length && values.at(-1) === undefined) values.pop()
    const response = await chrome.runtime.sendMessage({ type: DATA_MESSAGE, method, args: values })
    if (!response?.ok) throw new Error(response?.error ?? '本地数据服务不可用，请重新加载扩展')
    return response.value
  }
  // Browser preview uses the exact same database implementation, in its own origin.
  const { LocalService, READ_METHODS } = await import('./service')
  const service = await (previewService ??= Promise.resolve(new LocalService()))
  const run = service[method] as (...values: unknown[]) => Promise<unknown>
  const result = await run.apply(service, args)
  if (!READ_METHODS.has(method)) {
    window.dispatchEvent(new Event(DATA_CHANGED))
    previewChannel()?.postMessage(DATA_CHANGED)
  }
  return result as Awaited<ReturnType<LocalService[K]>>
}

/**
 * Cloud-sync requests are separate from data requests because they do network work:
 * in the extension they are answered by the background worker, and in the preview by
 * an engine running in the page itself.
 */
export async function syncCall<K extends SyncMethod>(method: K, ...args: unknown[]): Promise<SyncResults[K]> {
  if (isExtension()) {
    const response = await chrome.runtime.sendMessage({ type: SYNC_MESSAGE, method, args })
    if (!response?.ok) throw new Error(response?.error ?? '云同步不可用，请重新加载扩展')
    // The worker announces the data change; the page only needs its own copy refreshed
    if (response.changed) window.dispatchEvent(new Event(DATA_CHANGED))
    return response.value
  }
  const { LocalService } = await import('./service')
  const service = await (previewService ??= Promise.resolve(new LocalService()))
  const { value, changed } = await runSyncMethod(service, method, args)
  if (changed) {
    window.dispatchEvent(new Event(DATA_CHANGED))
    previewChannel()?.postMessage(DATA_CHANGED)
  }
  return value as SyncResults[K]
}

export function onDataChanged(listener: () => void): () => void {
  if (isExtension()) {
    const handler = (message: { type?: string }) => { if (message.type === DATA_CHANGED) listener() }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }
  const broadcast = previewChannel()
  window.addEventListener(DATA_CHANGED, listener)
  broadcast?.addEventListener('message', listener)
  return () => { window.removeEventListener(DATA_CHANGED, listener); broadcast?.removeEventListener('message', listener) }
}
