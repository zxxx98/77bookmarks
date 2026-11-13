import { DEFAULT_SETTINGS } from '../shared/settings'
import { LocalService, READ_METHODS, SERVICE_METHODS, type ServiceMethod } from '../src/storage/service'
import { SYNC_METHODS, runSyncMethod } from '../src/sync/control'
import { fetchTitleHtml } from '../src/title-fetch'
import { Auth } from './auth'
import { fetchSiteIcon, rememberMisses } from './icons'
import type { SqliteStore } from './sqlite'
import { UpdateService, type UpdateServiceOptions } from './update'

/** What the right-click extension may do: look up where to add, and add. Nothing else. */
const TOKEN_METHODS: ServiceMethod[] = ['board', 'settings', 'addBookmark']
const SYNC_SOON_MS = 30 * 1000
const SYNC_TICK_MS = 15 * 60 * 1000
const HEARTBEAT_MS = 25 * 1000

export interface AppOptions {
  store: SqliteStore
  password: string
  fetchIcon?: (origin: string) => Promise<string | null>
  update?: UpdateServiceOptions
}
export interface RequestInfo {
  /** Address the login throttle counts wrong guesses against */
  client?: string
  secure?: boolean
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store', ...headers } })
const fail = (status: number, error: string, headers?: Record<string, string>) => json({ error }, status, headers)
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return null
  try {
    const value = await request.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** A browser attaches Origin to every cross-site write; a reverse proxy may rename the host */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    const host = new URL(origin).host
    return host === request.headers.get('host') || host === request.headers.get('x-forwarded-host') || host === new URL(request.url).host
  } catch {
    return false
  }
}

/**
 * The self-hosted server: the same data service as the extension, on a SQLite file, behind
 * a password. It answers with web-standard requests and responses so it can be tested
 * without opening a port; `main.ts` connects it to Node's HTTP server.
 */
export async function createApp({ store, password, fetchIcon = fetchSiteIcon, update }: AppOptions) {
  const auth = new Auth(store, password)
  await auth.init()
  const service = new LocalService(async () => store.local, { fetchIcon: rememberMisses(fetchIcon) })
  const updater = new UpdateService(update)

  const listeners = new Set<() => void>()
  const changed = () => { for (const listener of listeners) listener() }

  // Cloud sync is driven from here, as the extension drives it from its background worker
  let soonTimer: ReturnType<typeof setTimeout> | undefined
  const syncNow = async () => {
    try {
      if (!(await service.syncStatus()).config.enabled) return
      const { changed: merged } = await runSyncMethod(service, 'now', [true])
      if (merged) changed()
    } catch {
      // The reason is kept in the sync state and shown in the settings page.
      changed()
    }
  }
  const syncSoon = () => {
    if (soonTimer) return
    // Uploading straight away would fight with the next edit, so it waits a moment
    soonTimer = setTimeout(() => { soonTimer = undefined; void syncNow() }, SYNC_SOON_MS)
    soonTimer.unref()
  }
  const tick = setInterval(() => void syncNow(), SYNC_TICK_MS)
  tick.unref()
  void syncNow()

  async function rpc(request: Request, viaToken: boolean): Promise<Response> {
    const input = await body(request)
    const method = input?.method as ServiceMethod
    if (!input || !SERVICE_METHODS.includes(method) || !Array.isArray(input.args)) return fail(400, '无效的数据请求')
    if (viaToken && !TOKEN_METHODS.includes(method)) return fail(403, '连接码无权执行此操作')
    try {
      const run = service[method] as (...values: unknown[]) => Promise<unknown>
      const value = await run.apply(service, input.args)
      if (!READ_METHODS.has(method)) {
        changed()
        if (method !== 'setIcon' || (input.args[1] as { url?: string } | undefined)?.url !== undefined) syncSoon()
        // The extension has no page open here to ask for the icon afterwards
        const added = value as { result?: string; siteId?: number }
        if (viaToken && method === 'addBookmark' && added.result === 'site_created') {
          void service.setIcon(added.siteId!).then(changed, () => undefined)
        }
      }
      return json({ value })
    } catch (error) {
      return fail(400, messageOf(error, '保存失败，请重试'))
    }
  }

  async function sync(request: Request): Promise<Response> {
    const input = await body(request)
    const method = String(input?.method ?? '')
    if (!SYNC_METHODS.includes(method as typeof SYNC_METHODS[number])) return fail(400, '无效的同步请求')
    try {
      const { value, changed: merged } = await runSyncMethod(service, method, Array.isArray(input?.args) ? input.args : [])
      if (merged) changed()
      if (method === 'configure' && (await service.syncStatus()).dirty) syncSoon()
      return json({ value, changed: merged })
    } catch (error) {
      changed()
      return fail(400, messageOf(error, '同步失败，请重试'))
    }
  }

  /** Tells open pages that the data changed; a comment line keeps idle connections alive */
  function events(): Response {
    const encoder = new TextEncoder()
    let stop = () => {}
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (text: string) => { try { controller.enqueue(encoder.encode(text)) } catch { stop() } }
        const listener = () => send('event: changed\ndata: 1\n\n')
        const heartbeat = setInterval(() => send(': keep-alive\n\n'), HEARTBEAT_MS)
        heartbeat.unref()
        stop = () => { clearInterval(heartbeat); listeners.delete(listener) }
        listeners.add(listener)
        send('retry: 3000\n\n')
      },
      cancel() { stop() },
    })
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } })
  }

  async function handle(request: Request, info: RequestInfo = {}): Promise<Response> {
    const { pathname } = new URL(request.url)
    const route = `${request.method} ${pathname}`
    const secure = info.secure ?? new URL(request.url).protocol === 'https:'
    if (route === 'GET /api/health') return json({ ok: true })

    const authorization = request.headers.get('authorization') ?? ''
    if (authorization.startsWith('Bearer ')) {
      // A browser never attaches this header on its own, so a cross-site request can't ride on it
      if (!(await auth.useToken(authorization.slice(7).trim()))) return fail(401, '连接码已失效')
      return route === 'POST /api/rpc' ? rpc(request, true) : fail(403, '连接码无权执行此操作')
    }

    if (request.method !== 'GET' && request.method !== 'HEAD' && !sameOrigin(request)) return fail(403, '跨站请求被拒绝')
    const signedIn = auth.hasSession(request.headers.get('cookie'))

    if (route === 'GET /api/session') {
      // The name on the sign-in page is public, like the title of any page
      const siteName = await service.settings().then((settings) => settings.siteName, () => DEFAULT_SETTINGS.siteName)
      return json({ authenticated: signedIn, siteName })
    }
    if (route === 'POST /api/login') {
      const input = await body(request)
      const result = auth.login(typeof input?.password === 'string' ? input.password : '', info.client ?? 'unknown')
      if (result.retryAfter) return fail(429, '尝试次数过多，请稍后再试', { 'retry-after': String(result.retryAfter) })
      if (!result.ok) return fail(401, '密码错误')
      return json({ ok: true }, 200, { 'set-cookie': auth.sessionCookie(secure) })
    }
    if (route === 'POST /api/logout') return json({ ok: true }, 200, { 'set-cookie': auth.clearCookie(secure) })

    if (!signedIn) return fail(401, '未登录')
    switch (route) {
      case 'POST /api/rpc': return rpc(request, false)
      case 'POST /api/sync': return sync(request)
      case 'GET /api/events': return events()
      case 'POST /api/page-title': {
        const input = await body(request)
        return json({ html: typeof input?.url === 'string' ? await fetchTitleHtml(input.url) : null })
      }
      case 'GET /api/token': return json({ status: await auth.tokenStatus() })
      case 'POST /api/token': return json(await auth.createToken())
      case 'DELETE /api/token': await auth.revokeToken(); return json({ ok: true })
      case 'GET /api/update': return json(updater.status())
      case 'POST /api/update/check': return json(await updater.check(true))
      case 'POST /api/update/apply': {
        try {
          return json(await updater.apply())
        } catch (error) {
          return fail(400, messageOf(error, '触发更新失败'))
        }
      }
      default: return fail(404, '接口不存在')
    }
  }

  return {
    handle,
    service,
    close() {
      clearInterval(tick)
      clearTimeout(soonTimer)
      listeners.clear()
    },
  }
}
