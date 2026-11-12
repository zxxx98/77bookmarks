import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptySnapshot, MAX_SNAPSHOT_BYTES } from '../../shared/sync'
import { EMPTY_SYNC_CONFIG, SyncConflictError } from './types'
import { workerTransport } from './worker'
import { webdavTransport } from './webdav'

const config = { ...EMPTY_SYNC_CONFIG, endpoint: 'https://sync.example.com/folder', token: 'test-token', username: '用户', password: 'secret' }
const snapshot = emptySnapshot('device-a', 1)
const file = { format: '77bookmarks-sync-file', version: 1, snapshot }
const davFile = (etag = '"v1"') => new Response(JSON.stringify(file), { headers: etag ? { etag } : {} })
afterEach(() => vi.unstubAllGlobals())

describe('Worker transport', () => {
  it('distinguishes an empty vault from the wrong endpoint', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Empty vault' }, { status: 404 })).mockResolvedValueOnce(Response.json({ error: 'Not found' }, { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    const transport = workerTransport(config)
    expect(await transport.pull()).toBeNull()
    await expect(transport.pull()).rejects.toThrow('Worker 地址')
  })
  it('sends conditional writes with bearer auth and reports version conflicts', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ version: 1 }, { headers: { etag: '"1"' } })).mockResolvedValueOnce(new Response(null, { status: 412 }))
    vi.stubGlobal('fetch', fetch)
    const transport = workerTransport(config)
    expect(await transport.push(snapshot, null)).toBe('1')
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ authorization: 'Bearer test-token', 'if-none-match': '*' })
    await expect(transport.push(snapshot, '1')).rejects.toBeInstanceOf(SyncConflictError)
    expect(fetch.mock.calls[1][1].headers['if-match']).toBe('"1"')
    expect(fetch.mock.calls[0][1].redirect).toBe('error')
  })
  it('measures the upload limit in UTF-8 bytes', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(workerTransport(config).push({ ...snapshot, deviceId: '中'.repeat(MAX_SNAPSHOT_BYTES / 2) }, null)).rejects.toThrow('太大')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('WebDAV transport', () => {
  it('preserves opaque ETags and uses them for conditional writes', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(davFile('"opaque-etag"')).mockResolvedValueOnce(davFile('"opaque-etag"')).mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(davFile('"new-etag"'))
    vi.stubGlobal('fetch', fetch)
    const transport = webdavTransport(config)
    expect((await transport.pull())?.version).toBe('"opaque-etag"')
    expect(await transport.push(snapshot, '"opaque-etag"')).toBe('"new-etag"')
    expect(fetch.mock.calls[2][1].headers['if-match']).toBe('"opaque-etag"')
    expect(fetch.mock.calls[0][0]).toBe('https://sync.example.com/folder/77bookmarks-sync.json')
  })
  it('protects first creation against another device creating the file', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response(null, { status: 412 }))
    vi.stubGlobal('fetch', fetch)
    await expect(webdavTransport(config).push(snapshot, null)).rejects.toBeInstanceOf(SyncConflictError)
    expect(fetch.mock.calls[1][1].headers['if-none-match']).toBe('*')
  })
  it('refuses to overwrite a file that was deleted or changed since it was pulled', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(davFile('"new"'))
    vi.stubGlobal('fetch', fetch)
    await expect(webdavTransport(config).push(snapshot, '"old"')).rejects.toBeInstanceOf(SyncConflictError)
    await expect(webdavTransport(config).push(snapshot, '"old"')).rejects.toBeInstanceOf(SyncConflictError)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('refuses unsafe servers without strong ETags', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(davFile('')).mockResolvedValueOnce(davFile('W/"weak"'))
    vi.stubGlobal('fetch', fetch)
    await expect(webdavTransport(config).pull()).rejects.toThrow('强 ETag')
    await expect(webdavTransport(config).pull()).rejects.toThrow('强 ETag')
  })
})
