import { fail, idParam, json, readJson, text, type Fn } from '../../../server/http'

export const onRequestPatch: Fn = async ({ request, env, params }) => {
  const id = idParam(params.id)
  const title = text((await readJson(request))?.title, 80)
  if (!id || !title) return fail(400, '标题不能为空')
  await env.DB.prepare('UPDATE links SET title = ? WHERE id = ?').bind(title, id).run()
  return json({ ok: true })
}

export const onRequestDelete: Fn = async ({ env, params }) => {
  const id = idParam(params.id)
  if (!id) return fail(400, '无效的链接')
  await env.DB.prepare('DELETE FROM links WHERE id = ?').bind(id).run()
  return json({ ok: true })
}
