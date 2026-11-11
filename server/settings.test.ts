import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../functions/api/_middleware'
import { onRequestGet, onRequestPut } from '../functions/api/settings'
import { DEFAULT_SITE_NAME } from '../shared/settings'
import type { Fn } from './http'
import { hasValidSession } from './session'

vi.mock('./session', () => ({ hasValidSession: vi.fn() }))

function context(request: Request, db: unknown = {}, next: unknown = vi.fn()) {
  return { request, env: { DB: db, ADMIN_PASSWORD: 'password', SESSION_SECRET: 'secret' }, next } as Parameters<Fn>[0]
}

function request(method = 'GET', body?: unknown) {
  return new Request('https://bookmarks.example/api/settings', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasValidSession).mockResolvedValue(false)
})

describe('settings access', () => {
  it('allows the login screen to read the public site name', async () => {
    const next = vi.fn(async () => new Response('settings'))
    expect((await onRequest(context(request(), {}, next))).status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
    expect(hasValidSession).not.toHaveBeenCalled()
  })

  it.each(['PUT', 'POST', 'DELETE'])('requires authentication for %s', async (method) => {
    const next = vi.fn()
    expect((await onRequest(context(request(method), {}, next))).status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('allows an authenticated settings update', async () => {
    vi.mocked(hasValidSession).mockResolvedValue(true)
    const next = vi.fn(async () => new Response('updated'))
    expect((await onRequest(context(request('PUT', { siteName: '工作台' }), {}, next))).status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
  })

  it('rejects cross-origin changes even with a valid session', async () => {
    vi.mocked(hasValidSession).mockResolvedValue(true)
    const req = request('PUT', { siteName: '工作台' })
    req.headers.set('Origin', 'https://other.example')
    const next = vi.fn()
    expect((await onRequest(context(req, {}, next))).status).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('keeps bookmark data private', async () => {
    const req = new Request('https://bookmarks.example/api/board')
    expect((await onRequest(context(req))).status).toBe(401)
  })
})

function settingsDb(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const bind = vi.fn((key: string, value: string) => ({ key, value }))
  return {
    prepare: vi.fn(() => ({
      all: async () => ({ results: [...values].map(([key, value]) => ({ key, value })) }),
      bind,
    })),
    batch: vi.fn(async (statements: { key: string; value: string }[]) => {
      for (const { key, value } of statements) values.set(key, value)
    }),
    bind,
  }
}

describe('settings persistence', () => {
  it('uses the original name before a name has been configured', async () => {
    const db = settingsDb()
    const response = await onRequestGet(context(request(), db))
    expect(await response.json()).toEqual({ siteName: DEFAULT_SITE_NAME, openInNewTab: true })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns the saved site name', async () => {
    const db = settingsDb({ site_name: '我的书签' })
    expect(await (await onRequestGet(context(request(), db))).json()).toEqual({ siteName: '我的书签', openInNewTab: true })
  })

  it.each([undefined, null, 123, '', '   ', 'a'.repeat(61)])('rejects an invalid name: %s', async (siteName) => {
    const db = { prepare: vi.fn() }
    expect((await onRequestPut(context(request('PUT', { siteName }), db))).status).toBe(400)
    expect(db.prepare).not.toHaveBeenCalled()
  })

  it('trims the name and saves it as a bound parameter', async () => {
    const db = settingsDb()
    const response = await onRequestPut(context(request('PUT', { siteName: '  我的书签  ' }), db))
    expect(await response.json()).toEqual({ siteName: '我的书签', openInNewTab: true })
    expect(db.bind).toHaveBeenCalledWith('site_name', '我的书签')
  })

  it.each([true, false])('persists and returns openInNewTab = %s', async (openInNewTab) => {
    const db = settingsDb()
    const response = await onRequestPut(context(request('PUT', { siteName: '我的书签', openInNewTab }), db))
    expect(await response.json()).toEqual({ siteName: '我的书签', openInNewTab })
    expect(await (await onRequestGet(context(request(), db))).json()).toEqual({ siteName: '我的书签', openInNewTab })
  })

  it('preserves the opening preference when an older client only changes the name', async () => {
    const db = settingsDb({ open_in_new_tab: 'false' })
    const response = await onRequestPut(context(request('PUT', { siteName: '新名称' }), db))
    expect(await response.json()).toEqual({ siteName: '新名称', openInNewTab: false })
  })

  it.each([null, 0, 1, 'false', 'true'])('rejects a non-boolean opening preference: %s', async (openInNewTab) => {
    const db = settingsDb()
    const response = await onRequestPut(context(request('PUT', { siteName: '新名称', openInNewTab }), db))
    expect(response.status).toBe(400)
    expect(db.batch).not.toHaveBeenCalled()
  })
})
