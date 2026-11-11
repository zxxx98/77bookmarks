import type { SiteUsage, UsageStats } from '../shared/types'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export interface UsageRow {
  site: SiteUsage
  /** Homepage and link clicks together */
  clicks: number
  /** Latest click on the card or on any of its links */
  lastUsedAt: number | null
  /** Start of the time the card is known to have gone unused */
  idleSince: number
}

/** Unused time only counts from when the item existed and clicks were being recorded */
export function idleStart(item: { lastClickedAt: number | null; createdAt: number }, since: number | null): number {
  return item.lastClickedAt ?? Math.max(item.createdAt, since ?? 0)
}

/** One row per card. A card counts as used whenever its homepage or any of its links was opened */
export function usageRows(stats: UsageStats): UsageRow[] {
  return stats.sites.map((site) => {
    const items = [site, ...site.links]
    const lastUsedAt = items.reduce<number | null>(
      (latest, item) => (item.lastClickedAt !== null && (latest === null || item.lastClickedAt > latest) ? item.lastClickedAt : latest),
      null,
    )
    return {
      site,
      clicks: items.reduce((total, item) => total + item.clicks, 0),
      lastUsedAt,
      idleSince: idleStart({ lastClickedAt: lastUsedAt, createdAt: site.createdAt }, stats.since),
    }
  })
}

export const USAGE_FILTERS = [
  { id: 'all', label: '全部', days: 0 },
  { id: 'idle30', label: '30 天未用', days: 30 },
  { id: 'idle90', label: '90 天未用', days: 90 },
  { id: 'never', label: '从未点击', days: 0 },
] as const
export type UsageFilter = (typeof USAGE_FILTERS)[number]['id']

export function filterRows(rows: UsageRow[], filter: UsageFilter, now: number): UsageRow[] {
  if (filter === 'all') return rows
  if (filter === 'never') return rows.filter((row) => row.lastUsedAt === null)
  const days = USAGE_FILTERS.find((item) => item.id === filter)!.days
  return rows.filter((row) => now - row.idleSince >= days * DAY)
}

export const USAGE_SORTS = [
  { id: 'idle', label: '最久未用' },
  { id: 'least', label: '点击最少' },
  { id: 'most', label: '点击最多' },
] as const
export type UsageSort = (typeof USAGE_SORTS)[number]['id']

export function sortRows(rows: UsageRow[], sort: UsageSort): UsageRow[] {
  const byIdle = (a: UsageRow, b: UsageRow) => a.idleSince - b.idleSince
  const byClicks = (a: UsageRow, b: UsageRow) => a.clicks - b.clicks
  const byId = (a: UsageRow, b: UsageRow) => a.site.id - b.site.id
  const order: ((a: UsageRow, b: UsageRow) => number)[] =
    sort === 'idle' ? [byIdle, byClicks, byId] : sort === 'least' ? [byClicks, byIdle, byId] : [(a, b) => byClicks(b, a), (a, b) => byIdle(b, a), byId]
  return [...rows].sort((a, b) => {
    for (const compare of order) {
      const result = compare(a, b)
      if (result !== 0) return result
    }
    return 0
  })
}

/** "3 天前"-style distance between a past moment and now */
export function formatAgo(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < MINUTE) return '刚刚'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} 小时前`
  const days = Math.floor(elapsed / DAY)
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
