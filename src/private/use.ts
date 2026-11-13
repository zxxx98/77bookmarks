import { useSyncExternalStore } from 'react'
import { privateSpace } from './session'

/** Whether a private space is open in this tab */
export const usePrivateActive = () => useSyncExternalStore(privateSpace.subscribe, privateSpace.active)
/** Changes whenever a space is opened or closed */
export const usePrivateGeneration = () => useSyncExternalStore(privateSpace.subscribe, privateSpace.generation)

const ENTRY_KEY = 'private-entry'
const ENTRY_EVENT = '77bookmarks:private-entry'
const subscribeEntry = (listener: () => void) => {
  window.addEventListener(ENTRY_EVENT, listener)
  window.addEventListener('storage', listener)
  return () => { window.removeEventListener(ENTRY_EVENT, listener); window.removeEventListener('storage', listener) }
}
/** Whether the top bar shows the way in; hidden, only the shortcut leads to the private spaces */
export const usePrivateEntryShown = () => useSyncExternalStore(subscribeEntry, () => localStorage.getItem(ENTRY_KEY) !== 'hidden')
export function showPrivateEntry(shown: boolean, store: { setItem(key: string, value: string): void; removeItem(key: string): void }) {
  if (shown) store.removeItem(ENTRY_KEY)
  else store.setItem(ENTRY_KEY, 'hidden')
  window.dispatchEvent(new Event(ENTRY_EVENT))
}
