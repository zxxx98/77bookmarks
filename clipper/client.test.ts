import { describe, expect, it } from 'vitest'
import { clipperRpc, parseConnectionCode } from './client'

describe('parseConnectionCode', () => {
  it('extracts origin and token from a valid connection code', () => {
    expect(parseConnectionCode('  https://bm.example.com:8443/some/path#bm_abc123  ')).toEqual({
      origin: 'https://bm.example.com:8443',
      token: 'bm_abc123',
    })
    expect(parseConnectionCode('http://127.0.0.1:8791/#bm_test')).toEqual({
      origin: 'http://127.0.0.1:8791',
      token: 'bm_test',
    })
  })

  it('rejects empty, malformed, non-http, or tokenless inputs', () => {
    expect(parseConnectionCode('')).toBeNull()
    expect(parseConnectionCode('not-a-url')).toBeNull()
    expect(parseConnectionCode('ftp://example.com/#bm_123')).toBeNull()
    expect(parseConnectionCode('https://example.com/')).toBeNull()
    expect(parseConnectionCode('https://example.com/#')).toBeNull()
  })
})

describe('clipperRpc', () => {
  it('sends Bearer authorization and returns the RPC value', async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return Response.json({ value: { siteName: '77 Bookmarks' } })
    }) as typeof fetch

    try {
      const value = await clipperRpc({ origin: 'https://bm.example.com', token: 'bm_secret' }, 'settings')
      expect(capturedUrl).toBe('https://bm.example.com/api/rpc')
      expect(capturedInit?.method).toBe('POST')
      expect((capturedInit?.headers as Record<string, string>).authorization).toBe('Bearer bm_secret')
      expect(capturedInit?.body).toBe(JSON.stringify({ method: 'settings', args: [] }))
      expect(value).toEqual({ siteName: '77 Bookmarks' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('throws a friendly error on 401 or network failure', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => Response.json({ error: '连接码已失效' }, { status: 401 })) as typeof fetch
    try {
      await expect(clipperRpc({ origin: 'https://bm.example.com', token: 'bm_bad' }, 'board', 0)).rejects.toThrow('连接码已失效')
    } finally {
      globalThis.fetch = originalFetch
    }

    globalThis.fetch = (async () => { throw new TypeError('network down') }) as typeof fetch
    try {
      await expect(clipperRpc({ origin: 'https://bm.example.com', token: 'bm_bad' }, 'board', 0)).rejects.toThrow('无法连接服务器')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
