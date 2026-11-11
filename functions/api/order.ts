import { fail, isIdList, json, readJson, type Fn } from '../../server/http'

export const onRequestPut: Fn = async ({ request, env }) => {
  const db = env.DB
  const body = await readJson(request)
  if (!body) return fail(400, '无效的请求')
  const statements: D1PreparedStatement[] = []

  if (body.desktops !== undefined) {
    if (!isIdList(body.desktops)) return fail(400, '无效的桌面排序')
    body.desktops.forEach((id, position) => {
      statements.push(db.prepare('UPDATE desktops SET position = ? WHERE id = ?').bind(position, id))
    })
  }

  if (body.groups !== undefined) {
    if (!isIdList(body.groups)) return fail(400, '无效的分组排序')
    body.groups.forEach((id, position) => {
      statements.push(db.prepare('UPDATE groups SET position = ? WHERE id = ?').bind(position, id))
    })
  }

  if (body.sites !== undefined) {
    if (!Array.isArray(body.sites)) return fail(400, '无效的卡片排序')
    for (const entry of body.sites as { groupId?: unknown; ids?: unknown }[]) {
      if (!Number.isInteger(entry?.groupId) || !isIdList(entry.ids)) return fail(400, '无效的卡片排序')
      entry.ids.forEach((id, position) => {
        // Dragging only moves cards within a desktop. The subquery also keeps a stale group id
        // from tripping the foreign key and aborting the whole batch.
        statements.push(
          db
            .prepare('UPDATE sites SET group_id = ?1, position = ?2 WHERE id = ?3 AND desktop_id = (SELECT desktop_id FROM groups WHERE id = ?1)')
            .bind(entry.groupId, position, id),
        )
      })
    }
  }

  if (statements.length) await db.batch(statements)
  return json({ ok: true })
}
