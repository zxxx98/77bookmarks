import { fail, type Fn } from '../../server/http'
import { hasValidSession } from '../../server/session'

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

export const onRequest: Fn = async ({ request, env, next }) => {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return fail(500, '服务端未配置 ADMIN_PASSWORD 或 SESSION_SECRET')
  }
  if (request.method !== 'GET' && request.method !== 'HEAD' && !sameOrigin(request)) {
    return fail(403, '跨站请求被拒绝')
  }
  const path = new URL(request.url).pathname
  if (path === '/api/login' || (path === '/api/settings' && request.method === 'GET')) return next()
  if (!(await hasValidSession(request, env.SESSION_SECRET))) return fail(401, '未登录')
  return next()
}
