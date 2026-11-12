import { fail, idParam, json, readJson, text, type Fn } from '../../../server/http'
import { deleteTodo, updateTodo } from '../../../server/todos'
import { MAX_TODO_LENGTH } from '../../../shared/types'

/** Body: `text` to reword the to-do, `done` to tick it off or reopen it */
export const onRequestPatch: Fn = async ({ request, env, params }) => {
  const id = idParam(params.id)
  const body = await readJson(request)
  if (!id || !body) return fail(400, '无效的待办')

  const patch: { text?: string; done?: boolean } = {}
  if (body.text !== undefined) {
    const content = text(body.text, MAX_TODO_LENGTH)
    if (!content) return fail(400, '待办内容不能为空')
    patch.text = content
  }
  if (body.done !== undefined) {
    if (typeof body.done !== 'boolean') return fail(400, '无效的完成状态')
    patch.done = body.done
  }
  await updateTodo(env.DB, id, patch)
  return json({ ok: true })
}

export const onRequestDelete: Fn = async ({ env, params }) => {
  const id = idParam(params.id)
  if (!id) return fail(400, '无效的待办')
  await deleteTodo(env.DB, id)
  return json({ ok: true })
}
