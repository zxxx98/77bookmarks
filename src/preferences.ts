/** A synchronous UI cache, mirrored to Chrome's persistent local extension storage. */
const KEYS = ['theme', 'style', 'search_engine', 'todo-panel'] as const
const extension = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id
export const preferences = {
  setItem(key: string, value: string) {
    localStorage.setItem(key, value)
    if (extension()) void chrome.storage.local.set({ [`ui:${key}`]: value }).catch(() => undefined)
  },
  removeItem(key: string) {
    localStorage.removeItem(key)
    if (extension()) void chrome.storage.local.remove(`ui:${key}`).catch(() => undefined)
  },
}
export async function hydratePreferences() {
  if (!extension()) return
  const values = await chrome.storage.local.get(null)
  for (const [key, value] of Object.entries(values)) if (key.startsWith('ui:') && typeof value === 'string') localStorage.setItem(key.slice(3), value)
}
export function exportPreferences(): Record<string, string> {
  return Object.fromEntries(KEYS.flatMap((key) => { const value = localStorage.getItem(key); return value === null ? [] : [[key, value]] }))
}
export function restorePreferences(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return
  for (const key of KEYS) {
    const value = (input as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.length <= 100) preferences.setItem(key, value)
    else preferences.removeItem(key)
  }
  window.dispatchEvent(new Event('77bookmarks:preferences-restored'))
}
