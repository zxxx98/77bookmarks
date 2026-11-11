import { fail, type Fn } from '../../server/http'
import { hasValidSession } from '../../server/session'
import { bearerToken, useToken } from '../../server/token'

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

/**
 * What an access token may do: read the board (the extension lists desktops and groups) and add
 * bookmarks. Everything else - changing, deleting, exporting, saving settings - needs the signed-in
 * session. The public display settings stay readable so the extension can show the site name.
 */
const TOKEN_ROUTES: [string, string][] = [
  ['GET', '/api/settings'],
  ['GET', '/api/board'],
  ['POST', '/api/bookmarks'],
]

function tokenMayUse(method: string, path: string): boolean {
  return TOKEN_ROUTES.some(([allowedMethod, allowedPath]) => allowedMethod === method && allowedPath === path)
}

export const onRequest: Fn = async (context) => {
  const { request, env, next } = context
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return fail(500, '服务端未配置 ADMIN_PASSWORD 或 SESSION_SECRET')
  }
  const path = new URL(request.url).pathname

  const bearer = bearerToken(request)
  if (bearer !== null) {
    const { ok, touch } = await useToken(env.DB, bearer)
    if (!ok) return fail(401, '访问令牌无效')
    // A browser never attaches this header on its own, so a cross-site request can't ride on it
    if (!tokenMayUse(request.method, path)) return fail(403, '访问令牌无权执行此操作')
    if (touch) context.waitUntil(touch)
    return next()
  }

  if (request.method !== 'GET' && request.method !== 'HEAD' && !sameOrigin(request)) {
    return fail(403, '跨站请求被拒绝')
  }
  if (path === '/api/login' || (path === '/api/settings' && request.method === 'GET')) return next()
  if (!(await hasValidSession(request, env.SESSION_SECRET))) return fail(401, '未登录')
  return next()
}
