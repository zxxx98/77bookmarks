import { fail, json, readJson, type Fn } from '../../server/http'
import { createSessionCookie, passwordMatches } from '../../server/session'

export const onRequestPost: Fn = async ({ request, env }) => {
  const body = await readJson(request)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!(await passwordMatches(password, env.ADMIN_PASSWORD))) return fail(401, '密码错误')
  return json({ ok: true }, 200, { 'Set-Cookie': await createSessionCookie(request, env.SESSION_SECRET) })
}
