import { describe, expect, it, vi } from 'vitest'
import { loadBoard, loadBoardPage } from './db'

function database() {
  const desktops = [
    { id: 1, name: '生活', view: 'large', groupCount: 1, siteCount: 1 },
    { id: 2, name: '工作', view: 'list', groupCount: 1, siteCount: 1 },
  ]
  type Statement = { sql: string; bindings: unknown[] }
  const prepare = vi.fn((sql: string) => {
    const statement = {
      sql, bindings: [] as unknown[],
      bind(...bindings: unknown[]) { statement.bindings = bindings; return statement },
      all: async () => ({ results: desktops }),
    }
    return statement
  })
  const batch = vi.fn(async (statements: Statement[]) => {
    const id = statements[0].bindings[0]
    const selected = id === undefined ? desktops : desktops.filter((d) => d.id === id)
    return [
      { results: selected },
      { results: selected.map((d) => ({ id: d.id * 10, desktop_id: d.id, name: `${d.name}分组`, pinned: d.id === 2 ? 1 : 0 })) },
      { results: selected.map((d) => ({ id: d.id * 100, group_id: d.id * 10, title: `${d.name}卡片`, origin: `https://site${d.id}.example`, icon_version: 0, icon_url: null })) },
      { results: selected.map((d) => ({ id: d.id * 1000, site_id: d.id * 100, title: `${d.name}链接`, path: '/path' })) },
    ]
  })
  return { prepare, batch }
}

describe('desktop loading', () => {
  it('returns navigation summaries and only the requested desktop details', async () => {
    const db = database()
    const page = await loadBoardPage(db as unknown as D1Database, 2)
    expect(page.desktops.map((d) => d.id)).toEqual([1, 2])
    expect(page.desktops.some((d) => 'groups' in d)).toBe(false)
    expect(page.desktop.id).toBe(2)
    expect(page.desktop.groups[0].sites[0]).toMatchObject({ title: '工作卡片', links: [{ title: '工作链接' }] })
    // All four detail queries must filter in D1, rather than discard other
    // desktops after transferring the entire database to the worker.
    for (const statement of db.batch.mock.calls[0][0]) {
      expect(statement.sql).toContain('WHERE')
      expect(statement.bindings).toEqual([2])
    }
    expect(db.batch.mock.calls[0][0][3].sql).toContain('s.desktop_id = ?')
  })

  it('lists pinned groups first and reports the flag as a boolean', async () => {
    const db = database()
    const board = await loadBoard(db as unknown as D1Database)
    expect(board.desktops.map((d) => d.groups[0].pinned)).toEqual([false, true])
    for (const sql of [db.prepare.mock.calls[1][0], (await loadBoardPage(db as unknown as D1Database, 2), db.batch.mock.calls[1][0][1].sql)]) {
      expect(sql).toContain('ORDER BY pinned DESC, position, id')
    }
  })

  it.each([null, 999])('falls back to the first desktop for %s', async (id) => {
    const db = database()
    expect((await loadBoardPage(db as unknown as D1Database, id)).desktop.id).toBe(1)
    expect(db.batch.mock.calls[0][0][0].bindings).toEqual([1])
  })

  it('still loads every desktop and its links for a full export', async () => {
    const db = database()
    const board = await loadBoard(db as unknown as D1Database)
    expect(board.desktops.map((d) => d.groups[0].sites[0].links[0].title)).toEqual(['生活链接', '工作链接'])
    expect(db.batch.mock.calls[0][0].every((statement) => statement.bindings.length === 0)).toBe(true)
  })
})
