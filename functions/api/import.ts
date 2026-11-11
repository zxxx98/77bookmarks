import { fromBase64, MAX_DESKTOPS, MAX_ICON_BYTES, nextPosition } from '../../server/db'
import { fail, json, type Fn } from '../../server/http'
import { parseBackup } from '../../shared/backup'
import type { ImportResult } from '../../shared/types'

/**
 * Restores a backup produced by /api/export.
 * ?mode=append (default) adds the backup's desktops after the existing ones;
 * ?mode=replace deletes everything first.
 */
export const onRequestPost: Fn = async ({ request, env }) => {
  const db = env.DB
  const replace = new URL(request.url).searchParams.get('mode') === 'replace'
  const backup = parseBackup(await request.json().catch(() => null))
  if ('error' in backup) return fail(400, backup.error)

  const [desktopMax, groupMax, siteMax, linkMax] = await db.batch<{ max: number }>(
    ['desktops', 'groups', 'sites', 'links'].map((table) => db.prepare(`SELECT COALESCE(MAX(id), 0) AS max FROM ${table}`)),
  )
  const existing = replace ? 0 : ((await db.prepare('SELECT COUNT(*) AS count FROM desktops').first<{ count: number }>())?.count ?? 0)
  if (existing + backup.desktops.length > MAX_DESKTOPS) return fail(400, `导入后会超过 ${MAX_DESKTOPS} 个桌面的上限`)

  // Ids continue after the existing ones even when replacing, so that a new card never reuses
  // the id (and with it the cached icon address) of a deleted one
  let desktopId = desktopMax.results[0].max
  let groupId = groupMax.results[0].max
  let siteId = siteMax.results[0].max
  let linkId = linkMax.results[0].max
  const firstPosition = replace ? 0 : await nextPosition(db, 'desktops')
  const now = Date.now()
  const statements: D1PreparedStatement[] = replace ? [db.prepare('DELETE FROM desktops')] : []
  const result: ImportResult = { ok: true, desktopIds: [], sites: 0, links: 0 }

  for (const [desktopIndex, desktop] of backup.desktops.entries()) {
    desktopId += 1
    result.desktopIds.push(desktopId)
    statements.push(
      db
        .prepare('INSERT INTO desktops (id, name, view, position, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(desktopId, desktop.name, desktop.view, firstPosition + desktopIndex, now),
    )

    for (const [groupIndex, group] of desktop.groups.entries()) {
      groupId += 1
      statements.push(
        db.prepare('INSERT INTO groups (id, desktop_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)').bind(groupId, desktopId, group.name, groupIndex, now),
      )

      for (const [siteIndex, site] of group.sites.entries()) {
        siteId += 1
        result.sites += 1
        const iconBytes = site.icon ? fromBase64(site.icon.data) : null
        const hasIcon = !!iconBytes && iconBytes.byteLength > 0 && iconBytes.byteLength <= MAX_ICON_BYTES

        statements.push(
          db
            .prepare(
              'INSERT INTO sites (id, desktop_id, group_id, origin, title, icon_version, icon_url, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .bind(siteId, desktopId, groupId, site.origin, site.title, hasIcon ? now : 0, site.iconUrl ?? null, siteIndex, now),
        )
        if (hasIcon) {
          statements.push(
            db.prepare('INSERT INTO icons (site_id, content_type, data) VALUES (?, ?, ?)').bind(siteId, site.icon!.type, iconBytes.buffer as ArrayBuffer),
          )
        }
        for (const [linkIndex, link] of site.links.entries()) {
          linkId += 1
          result.links += 1
          statements.push(
            db
              .prepare('INSERT INTO links (id, site_id, path, title, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
              .bind(linkId, siteId, link.path, link.title, linkIndex, now),
          )
        }
      }
    }
  }

  // A batch is one transaction, so a failed import leaves the existing data untouched
  await db.batch(statements)
  return json(result)
}
