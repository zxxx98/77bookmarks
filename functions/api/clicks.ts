import { fail, json, readJson, type Fn } from '../../server/http'
import { recordClick } from '../../server/usage'

/** Body: `{ siteId }` for a card's homepage, or `{ linkId }` for one of its links */
export const onRequestPost: Fn = async ({ request, env }) => {
  if (!(await recordClick(env.DB, await readJson(request)))) return fail(400, '无效的点击目标')
  return json({ ok: true })
}
