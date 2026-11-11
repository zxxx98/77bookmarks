import { describe, expect, it } from 'vitest'
import type { SiteUsage, UsageStats } from '../shared/types'
import { filterRows, formatAgo, sortRows, usageRows } from './usage'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_000 * DAY
const SINCE = NOW - 100 * DAY

function site(id: number, patch: Partial<SiteUsage> = {}): SiteUsage {
  return {
    id, desktopId: 1, groupName: '默认', origin: `https://site${id}.example`, title: `Site ${id}`, iconVersion: 0, iconUrl: null,
    clicks: 0, lastClickedAt: null, createdAt: NOW - 400 * DAY, links: [], ...patch,
  }
}
const link = (id: number, clicks: number, lastClickedAt: number | null) => ({ id, path: `/p${id}`, title: `Link ${id}`, clicks, lastClickedAt, createdAt: NOW - 400 * DAY })
const stats = (sites: SiteUsage[], since: number | null = SINCE): UsageStats => ({ since, sites })

describe('usage rows', () => {
  it('counts a card as used when any of its links was opened', () => {
    const [row] = usageRows(stats([site(1, { clicks: 2, lastClickedAt: NOW - 50 * DAY, links: [link(1, 3, NOW - 5 * DAY), link(2, 0, null)] })]))
    expect(row).toMatchObject({ clicks: 5, lastUsedAt: NOW - 5 * DAY, idleSince: NOW - 5 * DAY })
  })

  it('measures a never-opened card from the start of counting, not from when it was added', () => {
    const [old, recent] = usageRows(stats([site(1), site(2, { createdAt: NOW - 3 * DAY })]))
    expect(old).toMatchObject({ lastUsedAt: null, idleSince: SINCE })
    expect(recent.idleSince).toBe(NOW - 3 * DAY)
  })

  it('falls back to the creation time when the start of counting is unknown', () => {
    expect(usageRows(stats([site(1)], null))[0].idleSince).toBe(NOW - 400 * DAY)
  })
})

describe('usage filters', () => {
  const rows = usageRows(stats([
    site(1, { clicks: 9, lastClickedAt: NOW - 1 * DAY }),
    site(2, { clicks: 1, lastClickedAt: NOW - 45 * DAY }),
    site(3),
    site(4, { createdAt: NOW - 10 * DAY }),
  ]))
  const ids = (filter: Parameters<typeof filterRows>[1]) => filterRows(rows, filter, NOW).map((row) => row.site.id)

  it('lists cards idle for at least the given number of days', () => {
    expect(ids('all')).toEqual([1, 2, 3, 4])
    expect(ids('idle30')).toEqual([2, 3])
    expect(ids('idle90')).toEqual([3])
  })

  it('lists never-opened cards however new they are', () => {
    expect(ids('never')).toEqual([3, 4])
  })

  it('cannot call anything idle for longer than clicks have been counted', () => {
    const fresh = usageRows(stats([site(1)], NOW - 2 * DAY))
    expect(filterRows(fresh, 'idle30', NOW)).toEqual([])
    expect(filterRows(fresh, 'never', NOW)).toHaveLength(1)
  })
})

describe('usage sorting', () => {
  const rows = usageRows(stats([
    site(1, { clicks: 9, lastClickedAt: NOW - 1 * DAY }),
    site(2, { clicks: 1, lastClickedAt: NOW - 45 * DAY }),
    site(3),
    site(4, { clicks: 1, lastClickedAt: NOW - 2 * DAY }),
  ]))
  const ids = (sort: Parameters<typeof sortRows>[1]) => sortRows(rows, sort).map((row) => row.site.id)

  it('puts the longest-unused cards first', () => {
    expect(ids('idle')).toEqual([3, 2, 4, 1])
  })

  it('orders by clicks, breaking ties by idle time', () => {
    expect(ids('least')).toEqual([3, 2, 4, 1])
    expect(ids('most')).toEqual([1, 4, 2, 3])
  })

  it('does not reorder the input', () => {
    sortRows(rows, 'most')
    expect(rows.map((row) => row.site.id)).toEqual([1, 2, 3, 4])
  })
})

describe('relative time', () => {
  it.each([
    [30 * 1000, '刚刚'],
    [5 * 60 * 1000, '5 分钟前'],
    [3 * 60 * 60 * 1000, '3 小时前'],
    [29 * DAY, '29 天前'],
    [45 * DAY, '1 个月前'],
    [800 * DAY, '2 年前'],
  ])('formats %d ms as %s', (elapsed, text) => {
    expect(formatAgo(NOW - elapsed, NOW)).toBe(text)
  })

  it('treats a clock that is slightly behind as just now', () => {
    expect(formatAgo(NOW + 5000, NOW)).toBe('刚刚')
  })
})
