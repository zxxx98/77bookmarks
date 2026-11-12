/** Monotonic per-device counts make replayed uploads and retries idempotent. */
export type ClickCounts = Record<string, number>
export function parseClickCounts(value: unknown): ClickCounts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (entries.length > 1024 || entries.some(([key, count]) => !/^[a-z0-9-]{1,100}$/i.test(key) || !Number.isSafeInteger(count) || count < 0)) return null
  return Object.fromEntries(entries)
}
export function clickCountsOf(row: { clicks: number; clickCounts?: ClickCounts }): ClickCounts {
  return row.clickCounts ?? (row.clicks ? { history: row.clicks } : {})
}
export function mergeClickCounts(...maps: ClickCounts[]): ClickCounts {
  const result: ClickCounts = Object.create(null)
  for (const map of maps) for (const [device, count] of Object.entries(map)) result[device] = Math.max(result[device] ?? 0, count)
  return result
}
export function totalClicks(counts: ClickCounts): number {
  return Math.min(Number.MAX_SAFE_INTEGER, Object.values(counts).reduce((sum, value) => sum + value, 0))
}
