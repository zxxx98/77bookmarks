import { platform } from './platform'

/** A synchronous UI cache; the platform may mirror it somewhere more durable. */
const KEYS = ['theme', 'style', 'search_engine', 'todo-panel'] as const
export const preferences = {
  setItem(key: string, value: string) {
    localStorage.setItem(key, value)
    platform.preferences.mirror(key, value)
  },
  removeItem(key: string) {
    localStorage.removeItem(key)
    platform.preferences.mirror(key, null)
  },
}
export const hydratePreferences = () => platform.preferences.hydrate()
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
