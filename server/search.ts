import type { DesktopMatch } from '../shared/types'
import { hostOf } from '../shared/url'

export async function searchDesktops(db: D1Database, query: string): Promise<DesktopMatch[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  // Read only searchable text, on demand. JavaScript case folding keeps the
  // same Unicode behavior as local search (SQLite lower() only handles ASCII).
  const [sites, links] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT id, desktop_id, title, origin FROM sites'),
    db.prepare('SELECT site_id, title, path FROM links'),
  ])
  const hit = (value: unknown) => String(value).toLowerCase().includes(q)
  const matchedSites = new Set(links.results.filter((link) => hit(link.title) || hit(link.path)).map((link) => link.site_id))
  const counts = new Map<number, number>()
  for (const site of sites.results) {
    if (!hit(site.title) && !hit(hostOf(String(site.origin))) && !matchedSites.has(site.id)) continue
    const id = site.desktop_id as number
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts].map(([desktopId, count]) => ({ desktopId, count }))
}
