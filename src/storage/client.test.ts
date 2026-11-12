import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { deleteDB } from 'idb'
import { openLocalDatabase } from './db'
import { LocalService } from './service'
import { api } from '../api'

// Reproduce Chrome's JSON message boundary, which differs from ordinary JS function calls.
afterEach(() => vi.unstubAllGlobals())
it('exports the full backup through Chrome messaging when the optional desktop is omitted', async () => {
  const name = `transport-test-${crypto.randomUUID()}`
  const db = await openLocalDatabase(name)
  const service = new LocalService(async () => db)
  vi.stubGlobal('localStorage', { getItem: () => null })
  vi.stubGlobal('chrome', { runtime: {
    id: 'test-extension',
    sendMessage: async (message: unknown) => {
      const { method, args } = JSON.parse(JSON.stringify(message))
      try {
        const run = service[method as keyof LocalService] as (...args: unknown[]) => Promise<unknown>
        return { ok: true, value: await run.apply(service, args) }
      } catch (error) { return { ok: false, error: (error as Error).message } }
    },
  } })
  try {
    const { blob, filename } = await api.exportBackup()
    const backup = JSON.parse(await blob.text())
    expect(backup.version).toBe(3)
    expect(backup.desktops).toHaveLength(1)
    expect(backup.local.todos).toEqual([])
    expect(filename).toContain('full-')
  } finally { db.close(); await deleteDB(name) }
})
