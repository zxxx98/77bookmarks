import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../functions/api/_middleware'
import type { Fn } from './http'
import { hasValidSession } from './session'
import { useToken } from './token'

vi.mock('./session', () => ({ hasValidSession: vi.fn() }))
vi.mock('./token', async (original) => ({ ...(await original<typeof import('./token')>()), useToken: vi.fn() }))

const EXTENSION = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

function call(method: string, path: string, headers: Record<string, string> = {}) {
  const next = vi.fn(async () => new Response('ok'))
  const waitUntil = vi.fn()
  const request = new Request(`https://bookmarks.example${path}`, { method, headers })
  const context = { request, env: { DB: {}, ADMIN_PASSWORD: 'password', SESSION_SECRET: 'secret' }, next, waitUntil } as unknown as Parameters<Fn>[0]
  return { response: onRequest(context) as Promise<Response>, next, waitUntil }
}
const withToken = { Authorization: 'Bearer bm_token', Origin: EXTENSION }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasValidSession).mockResolvedValue(false)
  vi.mocked(useToken).mockResolvedValue({ ok: true, touch: null })
})

describe('access token requests', () => {
  it.each([
    ['POST', '/api/bookmarks'],
    ['GET', '/api/board'],
    ['GET', '/api/settings'],
  ])('lets the extension %s %s from its own origin', async (method, path) => {
    const { response, next } = call(method, path, withToken)
    expect((await response).status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
    expect(useToken).toHaveBeenCalledWith({}, 'bm_token')
    expect(hasValidSession).not.toHaveBeenCalled()
  })

  it.each([
    ['DELETE', '/api/sites/1'],
    ['PATCH', '/api/sites/1'],
    ['DELETE', '/api/links/1'],
    ['GET', '/api/export'],
    ['POST', '/api/import'],
    ['PUT', '/api/settings'],
    ['PUT', '/api/order'],
    ['POST', '/api/token'],
    ['DELETE', '/api/token'],
    ['GET', '/api/usage'],
    ['GET', '/api/bookmarks'],
    ['POST', '/api/board'],
  ])('does not let a token %s %s', async (method, path) => {
    const { response, next } = call(method, path, withToken)
    expect((await response).status).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects an unknown token even on an allowed route', async () => {
    vi.mocked(useToken).mockResolvedValue({ ok: false, touch: null })
    const { response, next } = call('POST', '/api/bookmarks', withToken)
    expect((await response).status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('does not fall back to the session cookie when a bad token is sent', async () => {
    vi.mocked(useToken).mockResolvedValue({ ok: false, touch: null })
    vi.mocked(hasValidSession).mockResolvedValue(true)
    const { response, next } = call('GET', '/api/board', { Authorization: 'Bearer nope' })
    expect((await response).status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('keeps the last-used write alive after the response', async () => {
    const touch = Promise.resolve()
    vi.mocked(useToken).mockResolvedValue({ ok: true, touch })
    const { response, waitUntil } = call('GET', '/api/board', withToken)
    await response
    expect(waitUntil).toHaveBeenCalledWith(touch)
  })
})

describe('session requests', () => {
  it('still rejects cross-site writes that carry no token', async () => {
    vi.mocked(hasValidSession).mockResolvedValue(true)
    const { response, next } = call('POST', '/api/bookmarks', { Origin: EXTENSION })
    expect((await response).status).toBe(403)
    expect(next).not.toHaveBeenCalled()
    expect(useToken).not.toHaveBeenCalled()
  })

  it('serves a signed-in same-origin request without consulting tokens', async () => {
    vi.mocked(hasValidSession).mockResolvedValue(true)
    const { response, next } = call('POST', '/api/token', { Origin: 'https://bookmarks.example' })
    expect((await response).status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
    expect(useToken).not.toHaveBeenCalled()
  })

  it('requires signing in when there is neither a session nor a token', async () => {
    const { response, next } = call('GET', '/api/board')
    expect((await response).status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})
