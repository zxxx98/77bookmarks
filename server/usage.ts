import type { SiteUsage, UsageStats } from '../shared/types'

const SINCE_KEY = 'click_stats_since'

/** Counts one opening of a card's homepage (`siteId`) or of one of its links (`linkId`) */
export async function recordClick(db: D1Database, target: Record<string, unknown> | null, now = Date.now()): Promise<boolean> {
  const isId = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0
  const table = isId(target?.linkId) ? 'links' : isId(target?.siteId) ? 'sites' : null
  if (!table) return false
  const id = table === 'links' ? target!.linkId : target!.siteId
  await db.prepare(`UPDATE ${table} SET click_count = click_count + 1, last_clicked_at = ? WHERE id = ?`).bind(now, id).run()
  return true
}

/** Click counters of every card and link, across all desktops */
export async function loadUsage(db: D1Database): Promise<UsageStats> {
  const [siteRows, linkRows, sinceRows] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT s.id, s.desktop_id, g.name AS group_name, s.origin, s.title, s.icon_version, s.icon_url,
      s.click_count, s.last_clicked_at, s.created_at
      FROM sites s JOIN groups g ON g.id = s.group_id ORDER BY s.id`),
    db.prepare('SELECT id, site_id, path, title, click_count, last_clicked_at, created_at FROM links ORDER BY position, id'),
    db.prepare('SELECT value FROM settings WHERE key = ?').bind(SINCE_KEY),
  ])

  const sites = new Map<number, SiteUsage>()
  for (const row of siteRows.results) {
    sites.set(row.id as number, {
      id: row.id as number,
      desktopId: row.desktop_id as number,
      groupName: row.group_name as string,
      origin: row.origin as string,
      title: row.title as string,
      iconVersion: row.icon_version as number,
      iconUrl: (row.icon_url as string | null) ?? null,
      clicks: row.click_count as number,
      lastClickedAt: (row.last_clicked_at as number | null) ?? null,
      createdAt: row.created_at as number,
      links: [],
    })
  }
  for (const row of linkRows.results) {
    sites.get(row.site_id as number)?.links.push({
      id: row.id as number,
      path: row.path as string,
      title: row.title as string,
      clicks: row.click_count as number,
      lastClickedAt: (row.last_clicked_at as number | null) ?? null,
      createdAt: row.created_at as number,
    })
  }
  const since = Number(sinceRows.results[0]?.value)
  return { since: Number.isFinite(since) && since > 0 ? since : null, sites: [...sites.values()] }
}
