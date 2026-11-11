import { MAX_DESKTOPS, nextPosition } from '../../../server/db'
import { fail, json, readJson, text, type Fn } from '../../../server/http'

export const onRequestPost: Fn = async ({ request, env }) => {
  const name = text((await readJson(request))?.name, 20)
  if (!name) return fail(400, '桌面名称不能为空')
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM desktops').first<{ count: number }>()
  if ((count?.count ?? 0) >= MAX_DESKTOPS) return fail(400, `最多只能有 ${MAX_DESKTOPS} 个桌面`)
  const created = await env.DB.prepare('INSERT INTO desktops (name, position, created_at) VALUES (?, ?, ?)')
    .bind(name, await nextPosition(env.DB, 'desktops'), Date.now())
    .run()
  return json({ id: created.meta.last_row_id, name })
}
