import { describe, expect, it, vi } from 'vitest'
import { loadUsage, recordClick } from './usage'

function database(since: unknown[] = [{ value: '1700000000000' }]) {
  const runs: { sql: string; bindings: unknown[] }[] = []
  const prepare = vi.fn((sql: string) => {
    const statement = {
      sql,
      bindings: [] as unknown[],
      bind(...bindings: unknown[]) { statement.bindings = bindings; return statement },
      run: async () => { runs.push({ sql, bindings: statement.bindings }) },
    }
    return statement
  })
  const batch = vi.fn(async () => [
    { results: [
      { id: 1, desktop_id: 1, group_name: '常用', origin: 'https://a.example', title: 'A', icon_version: 5, icon_url: null, click_count: 3, last_clicked_at: 1700000500000, created_at: 1690000000000 },
      { id: 2, desktop_id: 2, group_name: '工作', origin: 'https://b.example', title: 'B', icon_version: 0, icon_url: 'https://b.example/i.png', click_count: 0, last_clicked_at: null, created_at: 1690000000001 },
    ] },
    { results: [
      { id: 10, site_id: 1, path: '/x', title: 'X', click_count: 7, last_clicked_at: 1700000900000, created_at: 1690000000002 },
      { id: 11, site_id: 999, path: '/orphan', title: 'Orphan', click_count: 1, last_clicked_at: null, created_at: 1 },
    ] },
    { results: since },
  ])
  return { prepare, batch, runs }
}

describe('click recording', () => {
  it('counts a card homepage click on the site row', async () => {
    const db = database()
    expect(await recordClick(db as unknown as D1Database, { siteId: 4 }, 123)).toBe(true)
    expect(db.runs).toEqual([{ sql: 'UPDATE sites SET click_count = click_count + 1, last_clicked_at = ? WHERE id = ?', bindings: [123, 4] }])
  })

  it('counts a link click on the link row', async () => {
    const db = database()
    expect(await recordClick(db as unknown as D1Database, { linkId: 9 }, 456)).toBe(true)
    expect(db.runs).toEqual([{ sql: 'UPDATE links SET click_count = click_count + 1, last_clicked_at = ? WHERE id = ?', bindings: [456, 9] }])
  })

  it.each([null, {}, { siteId: '4' }, { siteId: 0 }, { linkId: 1.5 }, { siteId: -2 }])('rejects %j without touching the database', async (target) => {
    const db = database()
    expect(await recordClick(db as unknown as D1Database, target as Record<string, unknown> | null)).toBe(false)
    expect(db.prepare).not.toHaveBeenCalled()
  })
})

describe('usage statistics', () => {
  it('returns every card with its links and counters', async () => {
    const usage = await loadUsage(database() as unknown as D1Database)
    expect(usage.since).toBe(1700000000000)
    expect(usage.sites).toEqual([
      {
        id: 1, desktopId: 1, groupName: '常用', origin: 'https://a.example', title: 'A', iconVersion: 5, iconUrl: null,
        clicks: 3, lastClickedAt: 1700000500000, createdAt: 1690000000000,
        links: [{ id: 10, path: '/x', title: 'X', clicks: 7, lastClickedAt: 1700000900000, createdAt: 1690000000002 }],
      },
      {
        id: 2, desktopId: 2, groupName: '工作', origin: 'https://b.example', title: 'B', iconVersion: 0, iconUrl: 'https://b.example/i.png',
        clicks: 0, lastClickedAt: null, createdAt: 1690000000001, links: [],
      },
    ])
  })

  it.each([[[]], [[{ value: 'soon' }]], [[{ value: '0' }]]])('reports an unknown start of counting for %j', async (since) => {
    expect((await loadUsage(database(since) as unknown as D1Database)).since).toBeNull()
  })
})
