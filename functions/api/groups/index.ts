import { nextPosition } from '../../../server/db'
import { fail, json, readJson, text, type Fn } from '../../../server/http'

export const onRequestPost: Fn = async ({ request, env }) => {
  const body = await readJson(request)
  const name = text(body?.name, 40)
  if (!name) return fail(400, '分组名称不能为空')
  const desktop = Number.isInteger(body?.desktopId)
    ? await env.DB.prepare('SELECT id FROM desktops WHERE id = ?').bind(body!.desktopId).first<{ id: number }>()
    : null
  if (!desktop) return fail(400, '桌面不存在')
  const created = await env.DB.prepare('INSERT INTO groups (desktop_id, name, position, created_at) VALUES (?, ?, ?, ?)')
    .bind(desktop.id, name, await nextPosition(env.DB, 'groups', desktop.id), Date.now())
    .run()
  return json({ id: created.meta.last_row_id, name })
}
