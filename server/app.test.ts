// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { iconLinks, rememberMisses } from './icons'
import { openSqliteStore, type SqliteStore } from './sqlite'
import { compareVersions } from './update'

const PASSWORD = 'correct horse battery'
const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
let store: SqliteStore
let app: Awaited<ReturnType<typeof createApp>>
let fetchIcon: ReturnType<typeof vi.fn<(origin: string) => Promise<string | null>>>

beforeEach(async () => {
  store = await openSqliteStore(':memory:')
  fetchIcon = vi.fn(async () => ICON)
  app = await createApp({ store, password: PASSWORD, fetchIcon })
})
afterEach(() => { app.close(); store.destroy() })

const send = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}, client = 'tester') =>
  app.handle(new Request(`http://bookmarks.test${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }), { client })
async function login() {
  const response = await send('/api/login', { body: { password: PASSWORD } })
  return { cookie: response.headers.get('set-cookie')!.split(';')[0] }
}
const rpc = async (headers: Record<string, string>, method: string, ...args: unknown[]) => {
  const response = await send('/api/rpc', { body: { method, args }, headers })
  return { status: response.status, ...(await response.json() as { value?: any; error?: string }) }
}

describe('signing in', () => {
  it('refuses everything but the public endpoints without a session', async () => {
    expect((await send('/api/health')).status).toBe(200)
    expect(await (await send('/api/session')).json()).toEqual({ authenticated: false, siteName: '77 Bookmarks' })
    expect((await rpc({}, 'board')).status).toBe(401)
    expect((await send('/api/events')).status).toBe(401)
    expect((await send('/api/token')).status).toBe(401)
    expect((await send('/api/sync', { body: { method: 'status', args: [] } })).status).toBe(401)
  })
  it('signs in with the password and keeps the session in an HttpOnly cookie', async () => {
    expect((await send('/api/login', { body: { password: 'wrong' } })).status).toBe(401)
    const response = await send('/api/login', { body: { password: PASSWORD } })
    expect(response.headers.get('set-cookie')).toMatch(/^bm_session=\d+\.[0-9a-f]{64}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/)
    const { cookie } = await login()
    expect(await (await send('/api/session', { headers: { cookie } })).json()).toMatchObject({ authenticated: true })
    expect((await rpc({ cookie }, 'board')).value.desktop.name).toBe('主桌面')
  })
  it('rejects a forged or expired cookie, and every cookie once the password changes', async () => {
    const { cookie } = await login()
    const [expires, signature] = cookie.split('=')[1].split('.')
    expect((await rpc({ cookie: `bm_session=${Number(expires) + 1}.${signature}` }, 'board')).status).toBe(401)
    expect((await rpc({ cookie: `bm_session=1.${signature}` }, 'board')).status).toBe(401)
    const changed = await createApp({ store, password: 'another password', fetchIcon })
    const response = await changed.handle(new Request('http://bookmarks.test/api/session', { headers: { cookie } }))
    expect(await response.json()).toMatchObject({ authenticated: false })
    changed.close()
  })
  it('slows down password guessing per address', async () => {
    for (let i = 0; i < 10; i++) expect((await send('/api/login', { body: { password: `guess-${i}` } }, 'attacker')).status).toBe(401)
    const blocked = await send('/api/login', { body: { password: PASSWORD } }, 'attacker')
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await send('/api/login', { body: { password: PASSWORD } }, 'owner')).status).toBe(200)
  })
  it('refuses writes from another site even with a valid session', async () => {
    const { cookie } = await login()
    expect((await rpc({ cookie, origin: 'https://evil.example' }, 'createDesktop', '恶意')).status).toBe(403)
    expect((await rpc({ cookie, origin: 'http://bookmarks.test' }, 'createDesktop', '工作')).status).toBe(200)
    // Behind a reverse proxy the public name arrives in X-Forwarded-Host
    expect((await rpc({ cookie, origin: 'https://public.example', 'x-forwarded-host': 'public.example' }, 'createDesktop', '代理')).status).toBe(200)
  })
})

describe('data requests', () => {
  it('runs the shared data service and reports its validation errors', async () => {
    const { cookie } = await login()
    const added = await rpc({ cookie }, 'addBookmark', 'https://example.com/docs', 0, null, '文档')
    expect(added.value).toMatchObject({ result: 'site_created', siteTitle: 'example.com' })
    expect((await rpc({ cookie }, 'addBookmark', 'https://example.com/docs', 0)).value.result).toBe('link_exists')
    const board = (await rpc({ cookie }, 'board')).value
    expect(board.desktop.groups[0].sites[0].links).toEqual([{ id: 1, path: '/docs', title: '文档' }])
    expect(await rpc({ cookie }, 'addBookmark', 'not a url', 0)).toMatchObject({ status: 400, error: '无效的网址' })
    expect((await rpc({ cookie }, 'mergeRemote', null)).status).toBe(400)
    expect((await rpc({ cookie }, 'updateSyncConfig', {})).status).toBe(400)
  })
  it('fetches a missing icon on the server and remembers sites that have none', async () => {
    const { cookie } = await login()
    const { value } = await rpc({ cookie }, 'addBookmark', 'https://example.com', 0)
    expect((await rpc({ cookie }, 'setIcon', value.siteId)).status).toBe(200)
    expect((await rpc({ cookie }, 'icon', value.siteId)).value).toBe(ICON)
    fetchIcon.mockResolvedValue(null)
    const other = (await rpc({ cookie }, 'addBookmark', 'https://no-icon.example', 0)).value
    expect((await rpc({ cookie }, 'setIcon', other.siteId)).status).toBe(400)
    expect((await rpc({ cookie }, 'setIcon', other.siteId)).status).toBe(400)
    expect(fetchIcon.mock.calls.filter(([origin]) => origin === 'https://no-icon.example')).toHaveLength(1)
  })
  it('round-trips a full backup made by the extension edition', async () => {
    const { cookie } = await login()
    await rpc({ cookie }, 'addBookmark', 'https://example.com/a', 0)
    await rpc({ cookie }, 'addTodo', '买牛奶')
    const { json } = (await rpc({ cookie }, 'exportBackup')).value
    await rpc({ cookie }, 'deleteSite', 1)
    await rpc({ cookie }, 'clearDoneTodos')
    expect((await rpc({ cookie }, 'importBackup', JSON.parse(json), 'replace')).value).toMatchObject({ ok: true, sites: 1, links: 1 })
    expect((await rpc({ cookie }, 'todos')).value.map((todo: { text: string }) => todo.text)).toEqual(['买牛奶'])
  })
  it('answers cloud-sync requests from the server itself', async () => {
    const { cookie } = await login()
    const response = await send('/api/sync', { body: { method: 'status', args: [] }, headers: { cookie } })
    expect((await response.json() as { value: { config: { enabled: boolean } } }).value.config.enabled).toBe(false)
    expect((await send('/api/sync', { body: { method: 'drop', args: [] }, headers: { cookie } })).status).toBe(400)
  })
  it('pushes a change event to open pages after a write, not after a read', async () => {
    const { cookie } = await login()
    const response = await send('/api/events', { headers: { cookie } })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toContain('retry:')
    await rpc({ cookie }, 'board')
    await rpc({ cookie }, 'addTodo', '提醒')
    expect(decoder.decode((await reader.read()).value)).toBe('event: changed\ndata: 1\n\n')
    await reader.cancel()
  })
})

describe('the right-click extension', () => {
  async function connect() {
    const { cookie } = await login()
    const { token } = await (await send('/api/token', { method: 'POST', headers: { cookie } })).json() as { token: string }
    return { cookie, token, bearer: { authorization: `Bearer ${token}` } }
  }
  it('adds bookmarks with a token that can do nothing else', async () => {
    const { cookie, token, bearer } = await connect()
    expect(token).toMatch(/^bm_[A-Za-z0-9_-]{43}$/)
    expect((await rpc(bearer, 'board')).value.desktops).toHaveLength(1)
    expect((await rpc(bearer, 'settings')).value.siteName).toBe('77 Bookmarks')
    const added = await rpc(bearer, 'addBookmark', 'https://example.com', 0, null, 'Example')
    expect(added.value.result).toBe('site_created')
    // No page is open to ask for the icon, so the server fetches it by itself
    await vi.waitFor(async () => expect((await rpc({ cookie }, 'icon', added.value.siteId)).value).toBe(ICON))
    for (const method of ['deleteSite', 'exportBackup', 'importBackup', 'updateSettings', 'usage', 'todos', 'vaultRead', 'vaultWrite']) {
      expect((await rpc(bearer, method, 1)).status).toBe(403)
    }
    expect((await send('/api/token', { method: 'POST', headers: bearer })).status).toBe(403)
    expect((await send('/api/sync', { body: { method: 'status', args: [] }, headers: bearer })).status).toBe(403)
    expect((await send('/api/events', { headers: bearer })).status).toBe(403)
  })
  it('stores the vault of private spaces for a signed-in page, as ciphertext it cannot read', async () => {
    const { cookie } = await login()
    expect((await rpc({}, 'vaultRead')).status).toBe(401)
    const vault = (await rpc({ cookie }, 'vaultRead')).value
    const [[id, chunk], [, other]] = Object.entries(vault.chunks) as [string, string][]
    expect((await rpc({ cookie }, 'vaultWrite', { [id]: other }, { id, value: other })).status).toBe(400)
    expect((await rpc({ cookie }, 'vaultWrite', { [id]: other }, { id, value: chunk })).status).toBe(200)
    expect((await rpc({ cookie }, 'vaultRead')).value.chunks[id]).toBe(other)
    // The board's own snapshot is not something a page may ask for by name
    expect((await rpc({ cookie }, 'snapshot')).status).toBe(400)
  })
  it('accepts a token from any origin, since the extension is not the page', async () => {
    const { bearer } = await connect()
    expect((await rpc({ ...bearer, origin: 'chrome-extension://abcdefgh' }, 'addBookmark', 'https://example.com', 0)).status).toBe(200)
  })
  it('stores only a hash, shows the status, and stops working once replaced or revoked', async () => {
    const { cookie, token, bearer } = await connect()
    expect(JSON.stringify(await store.exclusive((sqlite) => sqlite.prepare('SELECT * FROM server_meta').all()))).not.toContain(token)
    await rpc(bearer, 'board')
    const { status } = await (await send('/api/token', { headers: { cookie } })).json() as { status: { createdAt: number; lastUsedAt: number } }
    expect(status.lastUsedAt).toBeGreaterThanOrEqual(status.createdAt)
    const replaced = await (await send('/api/token', { method: 'POST', headers: { cookie } })).json() as { token: string }
    expect((await rpc(bearer, 'board')).status).toBe(401)
    expect((await rpc({ authorization: `Bearer ${replaced.token}` }, 'board')).status).toBe(200)
    await send('/api/token', { method: 'DELETE', headers: { cookie } })
    expect((await rpc({ authorization: `Bearer ${replaced.token}` }, 'board')).status).toBe(401)
    expect((await rpc({ authorization: 'Bearer nonsense' }, 'board')).status).toBe(401)
    expect(await (await send('/api/token', { headers: { cookie } })).json()).toEqual({ status: null })
  })
})

describe('icon discovery', () => {
  it('reads declared icons in order of usefulness and ignores other links', () => {
    const html = `<head><link rel="stylesheet" href="/a.css"><link rel="apple-touch-icon" href="/touch.png">
      <link href='/icon.svg?v=1&amp;x=2' rel='icon' type="image/svg+xml"><link rel="shortcut icon" href=//cdn.example/fav.ico>
      <link rel="icon" href="data:image/png;base64,AAAA"></head>`
    expect(iconLinks(html, 'https://example.com/app/')).toEqual(['https://example.com/icon.svg?v=1&x=2', 'https://cdn.example/fav.ico', 'https://example.com/touch.png'])
  })
  it('asks a site without an icon again only after a while', async () => {
    let now = 0
    const fetcher = vi.fn(async () => null as string | null)
    const cached = rememberMisses(fetcher, () => now)
    await cached('https://a.example'); await cached('https://a.example')
    expect(fetcher).toHaveBeenCalledTimes(1)
    now = 7 * 60 * 60 * 1000
    fetcher.mockResolvedValue(ICON)
    expect(await cached('https://a.example')).toBe(ICON)
  })
})

describe('self-hosted updates', () => {
  it('compares semantic versions accurately', () => {
    expect(compareVersions('2.1.2', '2.1.1')).toBe(1)
    expect(compareVersions('v2.1.1', '2.1.1')).toBe(0)
    expect(compareVersions('2.1.1', '2.2.0')).toBe(-1)
    expect(compareVersions('2.2.0-beta.1', '2.2.0')).toBe(-1)
    expect(compareVersions('2.2.0-beta.2', '2.2.0-beta.1')).toBe(1)
  })

  it('requires authentication and checks GitHub Releases for updates', async () => {
    expect((await send('/api/update')).status).toBe(401)
    expect((await send('/api/update/check', { method: 'POST' })).status).toBe(401)
    expect((await send('/api/update/apply', { method: 'POST' })).status).toBe(401)

    const fetchFn = vi.fn(async () => Response.json({
      tag_name: 'v2.2.0',
      html_url: 'https://github.com/zxxx98/77bookmarks/releases/tag/v2.2.0',
      body: '新增版本更新检查',
      published_at: '2026-11-13T00:00:00Z',
    }))
    const customApp = await createApp({
      store,
      password: PASSWORD,
      fetchIcon,
      update: { currentVersion: '2.1.1', fetchFn: fetchFn as unknown as typeof fetch },
    })
    const loginRes = await customApp.handle(new Request('http://bookmarks.test/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    }))
    const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]

    const initial = await (await customApp.handle(new Request('http://bookmarks.test/api/update', { headers: { cookie } }))).json()
    expect(initial).toMatchObject({ currentVersion: '2.1.1', latestVersion: null, hasUpdate: false, canTriggerUpdate: false })

    const checked = await (await customApp.handle(new Request('http://bookmarks.test/api/update/check', {
      method: 'POST',
      headers: { cookie },
    }))).json()
    expect(checked).toMatchObject({
      currentVersion: '2.1.1',
      latestVersion: '2.2.0',
      hasUpdate: true,
      releaseUrl: 'https://github.com/zxxx98/77bookmarks/releases/tag/v2.2.0',
      releaseNotes: '新增版本更新检查',
      error: null,
    })

    const applyWithoutWebhook = await customApp.handle(new Request('http://bookmarks.test/api/update/apply', {
      method: 'POST',
      headers: { cookie },
    }))
    expect(applyWithoutWebhook.status).toBe(400)
    await customApp.service.syncStatus()
    customApp.close()
  })

  it('downloads and applies the selfhost release archive and schedules restart', async () => {
    const appDir = await mkdtemp(join(tmpdir(), '77bookmarks-app-'))
    try {
      await mkdir(join(appDir, 'public'), { recursive: true })
      await writeFile(join(appDir, 'server.mjs'), 'old-server')
      await writeFile(join(appDir, 'public', 'index.html'), 'old-html')

      const fetchFn = vi.fn(async (url: string) => {
        if (url.includes('api.github.com')) {
          return Response.json({
            tag_name: 'v2.2.0',
            html_url: 'https://github.com/zxxx98/77bookmarks/releases/tag/v2.2.0',
            assets: [
              { name: '77bookmarks-selfhost-v2.2.0.tar.gz', browser_download_url: 'https://downloads.example/selfhost.tar.gz' },
            ],
          })
        }
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      })
      const extractFn = vi.fn(async (_archive: string, destDir: string) => {
        await mkdir(join(destDir, 'public'), { recursive: true })
        await writeFile(join(destDir, 'server.mjs'), 'new-server')
        await writeFile(join(destDir, 'public', 'index.html'), 'new-html')
      })
      const onRestart = vi.fn()

      const customApp = await createApp({
        store,
        password: PASSWORD,
        fetchIcon,
        update: {
          currentVersion: '2.1.1',
          appDir,
          onRestart,
          fetchFn: fetchFn as unknown as typeof fetch,
          extractFn,
        },
      })
      const loginRes = await customApp.handle(new Request('http://bookmarks.test/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD }),
      }))
      const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]

      const checked = await (await customApp.handle(new Request('http://bookmarks.test/api/update/check', {
        method: 'POST',
        headers: { cookie },
      }))).json()
      expect(checked).toMatchObject({ hasUpdate: true, canTriggerUpdate: true })

      const applyRes = await customApp.handle(new Request('http://bookmarks.test/api/update/apply', {
        method: 'POST',
        headers: { cookie },
      }))
      expect(applyRes.status).toBe(200)
      expect(await applyRes.json()).toMatchObject({ triggered: true })
      expect(await readFile(join(appDir, 'server.mjs'), 'utf8')).toBe('new-server')
      expect(await readFile(join(appDir, 'public', 'index.html'), 'utf8')).toBe('new-html')
      await vi.waitFor(() => expect(onRestart).toHaveBeenCalledTimes(1))

      await customApp.service.syncStatus()
      customApp.close()
    } finally {
      await rm(appDir, { recursive: true, force: true })
    }
  })
})
