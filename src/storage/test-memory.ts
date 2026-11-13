import { vi } from 'vitest'

/**
 * Setup of the `memory` test project: the storage tests written for IndexedDB run once more
 * on the in-memory backend of the private spaces, so it is held to the same behaviour.
 */
const stores = vi.hoisted(() => new Map<string, Promise<import('./memory').MemoryStore>>())

vi.mock('./db', async (original) => ({
  ...(await original<typeof import('./db')>()),
  openLocalDatabase: async (name = 'default') => {
    const { openMemoryStore } = await import('./memory')
    let store = stores.get(name)
    if (!store) stores.set(name, store = openMemoryStore())
    return (await store).local
  },
}))

vi.mock('idb', async (original) => ({
  ...(await original<typeof import('idb')>()),
  deleteDB: async (name: string) => { stores.delete(name) },
}))
