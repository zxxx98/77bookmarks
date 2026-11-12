import { vi } from 'vitest'

/**
 * Setup of the `sqlite` test project: the storage tests written for IndexedDB run a second
 * time on the server's SQLite backend, so both editions are held to the same behaviour.
 */
const stores = vi.hoisted(() => new Map<string, Promise<import('./sqlite').SqliteStore>>())

vi.mock('../src/storage/db', async (original) => ({
  ...(await original<typeof import('../src/storage/db')>()),
  openLocalDatabase: async (name = 'default') => {
    const { openSqliteStore } = await import('./sqlite')
    let store = stores.get(name)
    if (!store) stores.set(name, store = openSqliteStore(':memory:'))
    return (await store).local
  },
}))

vi.mock('idb', async (original) => ({
  ...(await original<typeof import('idb')>()),
  deleteDB: async (name: string) => {
    const store = stores.get(name)
    stores.delete(name)
    ;(await store)?.destroy()
  },
}))
