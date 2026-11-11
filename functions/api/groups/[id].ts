import { fail, idParam, json, readJson, text, type Fn } from '../../../server/http'

/** Renames a group and/or pins it. Pinned groups are listed first on their desktop. */
export const onRequestPatch: Fn = async ({ request, env, params }) => {
  const id = idParam(params.id)
  const body = await readJson(request)
  if (!id || !body) return fail(400, '无效的分组')

  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean') return fail(400, '无效的置顶状态')
    await env.DB.prepare('UPDATE groups SET pinned = ? WHERE id = ?').bind(body.pinned ? 1 : 0, id).run()
  }

  if (body.name !== undefined || body.pinned === undefined) {
    const name = text(body.name, 40)
    if (!name) return fail(400, '分组名称不能为空')
    await env.DB.prepare('UPDATE groups SET name = ? WHERE id = ?').bind(name, id).run()
  }
  return json({ ok: true })
}

export const onRequestDelete: Fn = async ({ env, params }) => {
  const id = idParam(params.id)
  if (!id) return fail(400, '无效的分组')
  await env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(id).run()
  return json({ ok: true })
}
