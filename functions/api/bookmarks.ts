import { firstGroupId, nextPosition, resolveDesktopId, saveIcon } from '../../server/db'
import { fail, json, readJson, type Fn } from '../../server/http'
import { fetchPageMeta, fetchSiteIcon, linkTitleFrom, siteTitleFrom } from '../../server/meta'
import type { AddResult } from '../../shared/types'
import { fallbackLinkTitle, fullUrl, hostOf, parseBookmarkUrl } from '../../shared/url'

/** The requested group if it belongs to the desktop, otherwise the desktop's first group */
async function resolveGroupId(db: D1Database, desktopId: number, requested: unknown): Promise<number> {
  if (Number.isInteger(requested)) {
    const group = await db.prepare('SELECT id FROM groups WHERE id = ? AND desktop_id = ?').bind(requested, desktopId).first<{ id: number }>()
    if (group) return group.id
  }
  return firstGroupId(db, desktopId)
}

export const onRequestPost: Fn = async ({ request, env }) => {
  const db = env.DB
  const body = await readJson(request)
  const parsed = parseBookmarkUrl(typeof body?.url === 'string' ? body.url : '')
  if (!parsed) return fail(400, '无效的网址')
  const { origin, path } = parsed
  const desktopId = await resolveDesktopId(db, body?.desktopId)
  if (!desktopId) return fail(409, '还没有桌面，请刷新页面后重试')

  // The same site can have a card on every desktop
  let site = await db
    .prepare('SELECT id, title FROM sites WHERE desktop_id = ? AND origin = ?')
    .bind(desktopId, origin)
    .first<{ id: number; title: string }>()
  const siteExisted = !!site

  if (site && path) {
    const duplicate = await db.prepare('SELECT 1 FROM links WHERE site_id = ? AND path = ?').bind(site.id, path).first()
    if (duplicate) return json({ result: 'link_exists', siteId: site.id, siteTitle: site.title } satisfies AddResult)
  }

  // Fetch the homepage (new cards) and the linked page (new links) at the same time
  const [homeMeta, pageMeta] = await Promise.all([
    site ? null : fetchPageMeta(origin),
    path ? fetchPageMeta(fullUrl(origin, path)) : null,
  ])

  if (!site) {
    const groupId = await resolveGroupId(db, desktopId, body?.groupId)
    const title = (homeMeta && siteTitleFrom(homeMeta)) ?? hostOf(origin)
    const created = await db
      .prepare('INSERT INTO sites (desktop_id, group_id, origin, title, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(desktopId, groupId, origin, title, await nextPosition(db, 'sites', groupId), Date.now())
      .run()
    site = { id: created.meta.last_row_id, title }

    const icon = await fetchSiteIcon(origin, [...(homeMeta?.icons ?? []), ...(pageMeta?.icons ?? [])])
    if (icon) await saveIcon(db, site.id, icon.contentType, icon.data)
  }

  if (path) {
    const linkTitle = (pageMeta && linkTitleFrom(pageMeta, fullUrl(origin, path), site.title)) ?? fallbackLinkTitle(path)
    await db
      .prepare('INSERT INTO links (site_id, path, title, position, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(site.id, path, linkTitle, await nextPosition(db, 'links', site.id), Date.now())
      .run()
  }

  const result: AddResult['result'] = path ? (siteExisted ? 'link_added' : 'site_created') : siteExisted ? 'site_exists' : 'site_created'
  return json({ result, siteId: site.id, siteTitle: site.title } satisfies AddResult)
}
