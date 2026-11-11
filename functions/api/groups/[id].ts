import { fail, idParam, json, readJson, text, type Fn } from '../../../server/http'

export const onRequestPatch: Fn = async ({ request, env, params }) => {
  const id = idParam(params.id)
  const name = text((await readJson(request))?.name, 40)
  if (!id || !name) return fail(400, '分组名称不能为空')
  await env.DB.prepare('UPDATE groups SET name = ? WHERE id = ?').bind(name, id).run()
  return json({ ok: true })
}

export const onRequestDelete: Fn = async ({ env, params }) => {
  const id = idParam(params.id)
  if (!id) return fail(400, '无效的分组')
  await env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(id).run()
  return json({ ok: true })
}
