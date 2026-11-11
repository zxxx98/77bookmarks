import { fail, idParam, json, readJson, text, type Fn } from '../../../server/http'
import { isView } from '../../../shared/types'

export const onRequestPatch: Fn = async ({ request, env, params }) => {
  const id = idParam(params.id)
  const body = await readJson(request)
  if (!id || !body) return fail(400, '无效的请求')

  if (body.name !== undefined) {
    const name = text(body.name, 20)
    if (!name) return fail(400, '桌面名称不能为空')
    await env.DB.prepare('UPDATE desktops SET name = ? WHERE id = ?').bind(name, id).run()
  }
  if (body.view !== undefined) {
    if (!isView(body.view)) return fail(400, '无效的显示方式')
    await env.DB.prepare('UPDATE desktops SET view = ? WHERE id = ?').bind(body.view, id).run()
  }
  return json({ ok: true })
}

export const onRequestDelete: Fn = async ({ env, params }) => {
  const id = idParam(params.id)
  if (!id) return fail(400, '无效的桌面')
  // Groups, cards, links and icons go with it through the cascading foreign keys
  const deleted = await env.DB.prepare('DELETE FROM desktops WHERE id = ? AND (SELECT COUNT(*) FROM desktops) > 1').bind(id).run()
  if (deleted.meta.changes === 0) {
    const exists = await env.DB.prepare('SELECT 1 FROM desktops WHERE id = ?').bind(id).first()
    if (exists) return fail(400, '至少要保留一个桌面')
  }
  return json({ ok: true })
}
