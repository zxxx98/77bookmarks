import { afterEach, describe, expect, it, vi } from 'vitest'
import { addBookmark, ApiError, describeResult, isBookmarkable, loadBoard, originPattern, parseConnection } from '../extension/lib.js'

const TOKEN = 'bm_Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFy'
const connection = { server: 'https://bookmarks.example.com', token: TOKEN }

afterEach(() => vi.unstubAllGlobals())

describe('connection code', () => {
  it('splits a code into the server address and the token', () => {
    expect(parseConnection(`https://bookmarks.example.com/#${TOKEN}`)).toEqual(connection)
  })

  it('keeps the port of a self-hosted or local server', () => {
    expect(parseConnection(`  http://192.168.1.2:8788/#${TOKEN}\n`)).toEqual({ server: 'http://192.168.1.2:8788', token: TOKEN })
  })

  it.each([
    '',
    'not a code',
    TOKEN,
    'https://bookmarks.example.com/',
    'https://bookmarks.example.com/#bm_short',
    'https://bookmarks.example.com/#password',
    `ftp://bookmarks.example.com/#${TOKEN}`,
    `javascript:alert(1)#${TOKEN}`,
  ])('rejects %j', (code) => {
    expect(parseConnection(code)).toBeNull()
  })
})

describe('host permission', () => {
  it('asks for the server alone, without the port that match patterns cannot carry', () => {
    expect(originPattern('http://192.168.1.2:8788')).toBe('http://192.168.1.2/*')
    expect(originPattern('https://bookmarks.example.com')).toBe('https://bookmarks.example.com/*')
  })
})

describe('bookmarkable pages', () => {
  it.each(['https://example.com/a?b=c', 'http://localhost:3000'])('accepts %s', (url) => {
    expect(isBookmarkable(url)).toBe(true)
  })

  it.each(['chrome://extensions', 'chrome-extension://abc/popup.html', 'file:///home/me/a.html', 'about:blank', '', 'example.com'])('refuses %j', (url) => {
    expect(isBookmarkable(url)).toBe(false)
  })
})

describe('result messages', () => {
  it.each([
    ['site_created', '已添加「GitHub」'],
    ['link_added', '已添加到「GitHub」'],
    ['site_exists', '「GitHub」已在书签页里'],
    ['link_exists', '「GitHub」里已有这个链接'],
  ])('describes %s', (result, message) => {
    expect(describeResult({ result, siteTitle: 'GitHub' })).toBe(message)
  })
})

describe('requests', () => {
  const respond = (status: number, body: unknown) => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('adds a bookmark with the token and never with cookies', async () => {
    const fetchMock = respond(200, { result: 'site_created', siteId: 1, siteTitle: 'Docs' })
    const bookmark = { url: 'https://docs.example/guide', title: 'Guide', desktopId: 2, groupId: 5 }
    expect(await addBookmark(connection, bookmark)).toMatchObject({ result: 'site_created' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://bookmarks.example.com/api/bookmarks')
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' })
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` })
    expect(JSON.parse(init.body as string)).toEqual(bookmark)
  })

  it('asks for the first desktop unless one is chosen', async () => {
    const fetchMock = respond(200, { desktops: [], desktop: { id: 1, name: '主桌面', groups: [] } })
    await loadBoard(connection, undefined)
    await loadBoard(connection, 3)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://bookmarks.example.com/api/board', 'https://bookmarks.example.com/api/board?desktop=3'])
  })

  it('tells the user to reconnect when the token no longer works', async () => {
    respond(401, { error: '访问令牌无效' })
    await expect(loadBoard(connection, undefined)).rejects.toMatchObject({ status: 401, message: '连接码已失效，请在扩展选项里重新连接' })
  })

  it('passes on what the server said about other failures', async () => {
    respond(400, { error: '无效的网址' })
    const error = await addBookmark(connection, { url: 'nope' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, message: '无效的网址' })
  })

  it('names the server when it cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(loadBoard(connection, undefined)).rejects.toMatchObject({ status: 0, message: '无法连接到 https://bookmarks.example.com，请检查地址和网络' })
  })
})
