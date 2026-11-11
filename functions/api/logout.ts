import { json, type Fn } from '../../server/http'
import { clearSessionCookie } from '../../server/session'

export const onRequestPost: Fn = async ({ request }) => {
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(request) })
}
