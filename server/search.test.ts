import { describe, expect, it, vi } from 'vitest'
import { searchDesktops } from './search'

function database() {
  return {
    prepare: vi.fn((sql: string) => sql),
    batch: vi.fn(async () => [
      { results: [
        { id: 1, desktop_id: 1, title: 'CAFÉ 中文', origin: 'https://example.com' },
        { id: 2, desktop_id: 2, title: 'Other', origin: 'https://café.example' },
        { id: 3, desktop_id: 2, title: '100%_done', origin: 'https://test.example' },
      ] },
      { results: [
        { site_id: 1, title: 'CAFÉ', path: '/café' },
        { site_id: 2, title: '中文', path: '/中文' },
        { site_id: 2, title: '中文 again', path: '/other' },
      ] },
    ]),
  }
}

describe('cross-desktop search', () => {
  it('matches Unicode titles and hosts and counts each site once', async () => {
    expect(await searchDesktops(database() as unknown as D1Database, ' café ')).toEqual([
      { desktopId: 1, count: 1 }, { desktopId: 2, count: 1 },
    ])
  })

  it('includes matching links without counting duplicate links', async () => {
    expect(await searchDesktops(database() as unknown as D1Database, '中文')).toEqual([
      { desktopId: 1, count: 1 }, { desktopId: 2, count: 1 },
    ])
  })

  it('treats SQL wildcard characters as literal text', async () => {
    expect(await searchDesktops(database() as unknown as D1Database, '%_')).toEqual([{ desktopId: 2, count: 1 }])
  })

  it('does not search the URL scheme or read data for an empty query', async () => {
    const db = database()
    expect(await searchDesktops(db as unknown as D1Database, '  ')).toEqual([])
    expect(db.batch).not.toHaveBeenCalled()
    expect(await searchDesktops(db as unknown as D1Database, 'https')).toEqual([])
  })
})
