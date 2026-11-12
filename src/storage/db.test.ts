import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { deleteDB } from 'idb'
import { openLocalDatabase } from './db'
import { LocalService } from './service'

afterEach(() => vi.unstubAllGlobals())

it('initializes and persists local data without crypto.randomUUID in HTTP previews', async () => {
  const name = `http-preview-${crypto.randomUUID()}`
  const getRandomValues = crypto.getRandomValues.bind(crypto)
  vi.stubGlobal('crypto', { getRandomValues })

  const db = await openLocalDatabase(name)
  try {
    const service = new LocalService(async () => db)
    await service.addBookmark('https://example.com/docs')
    await service.addTodo('HTTP 预览待办')
    const stores = ['desktops', 'groups', 'sites', 'links', 'todos'] as const
    const records = (await Promise.all(stores.map((store) => db.getAll(store)))).flat()
    expect(records).toHaveLength(5)
    expect(new Set(records.map((row) => row.syncId)).size).toBe(records.length)
    for (const row of records) expect(row.syncId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

    db.close()
    const reopened = await openLocalDatabase(name)
    try {
      expect(await reopened.getAll('sites')).toEqual(records.filter((row) => 'origin' in row))
      expect(await reopened.count('desktops')).toBe(1)
      expect((await reopened.getAll('todos'))[0].text).toBe('HTTP 预览待办')
    } finally { reopened.close() }
  } finally { db.close(); await deleteDB(name) }
})
