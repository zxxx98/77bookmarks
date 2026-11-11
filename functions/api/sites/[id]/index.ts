import { firstGroupId, nextPosition } from '../../../../server/db'
import { fail, idParam, json, readJson, text, type Fn } from '../../../../server/http'

export const onRequestPatch: Fn = async ({ request, env, params }) => {
  const db = env.DB
  const id = idParam(params.id)
  const body = await readJson(request)
  if (!id || !body) return fail(400, '无效的请求')

  if (body.title !== undefined) {
    const title = text(body.title, 80)
    if (!title) return fail(400, '标题不能为空')
    await db.prepare('UPDATE sites SET title = ? WHERE id = ?').bind(title, id).run()
  }

  if (body.groupId !== undefined || body.desktopId !== undefined) {
    const site = await db.prepare('SELECT desktop_id, group_id, origin FROM sites WHERE id = ?').bind(id).first<{ desktop_id: number; group_id: number; origin: string }>()
    if (!site) return fail(404, '卡片不存在')

    // Either an explicit group, or "the first group of that desktop"
    let target: { id: number | null; desktop_id: number } | null
    if (body.groupId !== undefined) {
      const groupId = idParam(String(body.groupId))
      target = groupId ? await db.prepare('SELECT id, desktop_id FROM groups WHERE id = ?').bind(groupId).first<{ id: number; desktop_id: number }>() : null
      if (!target) return fail(400, '分组不存在')
    } else {
      const desktopId = idParam(String(body.desktopId))
      const desktop = desktopId ? await db.prepare('SELECT id FROM desktops WHERE id = ?').bind(desktopId).first<{ id: number }>() : null
      if (!desktop) return fail(400, '桌面不存在')
      target = { id: desktop.id === site.desktop_id ? site.group_id : null, desktop_id: desktop.id }
    }

    if (target.desktop_id !== site.desktop_id) {
      const clash = await db.prepare('SELECT 1 FROM sites WHERE desktop_id = ? AND origin = ?').bind(target.desktop_id, site.origin).first()
      if (clash) return fail(409, '目标桌面已有这个网站的卡片')
    }
    const groupId = target.id ?? (await firstGroupId(db, target.desktop_id))
    // Moving appends the card at the end of the group it lands in
    await db
      .prepare('UPDATE sites SET group_id = ?1, desktop_id = ?2, position = ?3 WHERE id = ?4 AND group_id != ?1')
      .bind(groupId, target.desktop_id, await nextPosition(db, 'sites', groupId), id)
      .run()
  }
  return json({ ok: true })
}

export const onRequestDelete: Fn = async ({ env, params }) => {
  const id = idParam(params.id)
  if (!id) return fail(400, '无效的卡片')
  await env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(id).run()
  return json({ ok: true })
}
