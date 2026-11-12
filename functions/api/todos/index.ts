import { fail, json, readJson, text, type Fn } from '../../../server/http'
import { addTodo, listTodos } from '../../../server/todos'
import { MAX_TODO_LENGTH } from '../../../shared/types'

export const onRequestGet: Fn = async ({ env }) => {
  return json(await listTodos(env.DB), 200, { 'Cache-Control': 'no-store' })
}

export const onRequestPost: Fn = async ({ request, env }) => {
  const content = text((await readJson(request))?.text, MAX_TODO_LENGTH)
  if (!content) return fail(400, '待办内容不能为空')
  return json(await addTodo(env.DB, content))
}
