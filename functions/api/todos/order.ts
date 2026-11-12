import { fail, isIdList, json, readJson, type Fn } from '../../../server/http'
import { orderTodos } from '../../../server/todos'

/** Body: `ids`, the open to-dos from top to bottom */
export const onRequestPut: Fn = async ({ request, env }) => {
  const ids = (await readJson(request))?.ids
  if (!isIdList(ids)) return fail(400, '无效的待办排序')
  await orderTodos(env.DB, ids)
  return json({ ok: true })
}
