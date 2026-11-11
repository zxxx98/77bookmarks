// @ts-check
/** Connection code parsing, API calls and messages. No chrome.* here so it stays unit-testable. */

/** Anything but a token is rejected before the server is bothered */
const TOKEN_PATTERN = /^bm_[A-Za-z0-9_-]{20,}$/
/** Long enough for the server to read the page and fetch an icon */
const ADD_TIMEOUT = 25_000
const TIMEOUT = 10_000

/** @typedef {{ server: string, token: string, siteName?: string }} Connection */
/** @typedef {{ url: string, title?: string, desktopId?: number, groupId?: number }} Bookmark */
/** @typedef {{ id: number, name: string, groups?: { id: number, name: string }[] }} DesktopInfo */
/** @typedef {{ desktops: DesktopInfo[], desktop: DesktopInfo }} BoardPage */

/**
 * Reads a connection code of the shape `https://bookmarks.example.com/#bm_…`, which is what the
 * bookmark page hands out. The token sits in the fragment, so opening the code never sends it anywhere.
 * @param {string} code
 * @returns {Connection | null}
 */
export function parseConnection(code) {
  let url
  try {
    url = new URL(code.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const token = url.hash.slice(1)
  if (!TOKEN_PATTERN.test(token)) return null
  return { server: url.origin, token }
}

/**
 * Host permission asked for at connect time. Match patterns carry no port, so a server on `:8788`
 * is covered by the same pattern as one on the default port.
 * @param {string} server
 */
export function originPattern(server) {
  const url = new URL(server)
  return `${url.protocol}//${url.hostname}/*`
}

/**
 * Only pages the bookmark server can store: `chrome://`, `file://` and extension pages are out
 * @param {string} url
 */
export function isBookmarkable(url) {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export class ApiError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * @param {Connection} connection
 * @param {string} path
 * @param {RequestInit & { timeout?: number }} [init]
 */
async function request(connection, path, init = {}) {
  const { timeout = TIMEOUT, ...rest } = init
  let response
  try {
    response = await fetch(connection.server + '/api' + path, {
      ...rest,
      // The token is the whole authorization: cookies are only in the way
      credentials: 'omit',
      headers: { ...rest.headers, Authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(timeout),
    })
  } catch {
    throw new ApiError(0, `无法连接到 ${connection.server}，请检查地址和网络`)
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    if (response.status === 401) throw new ApiError(401, '连接码已失效，请在扩展选项里重新连接')
    throw new ApiError(response.status, data?.error ?? `请求失败（${response.status}）`)
  }
  return response.json()
}

/** @param {Connection} connection */
export const loadSiteName = (connection) => request(connection, '/settings').then((settings) => settings.siteName)

/**
 * @param {Connection} connection
 * @param {number | undefined} desktopId
 * @returns {Promise<BoardPage>}
 */
export const loadBoard = (connection, desktopId) => request(connection, `/board${desktopId ? `?desktop=${desktopId}` : ''}`)

/**
 * @param {Connection} connection
 * @param {Bookmark} bookmark
 * @returns {Promise<{ result: 'site_created' | 'site_exists' | 'link_added' | 'link_exists', siteTitle: string }>}
 */
export const addBookmark = (connection, bookmark) =>
  request(connection, '/bookmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bookmark),
    timeout: ADD_TIMEOUT,
  })

/**
 * What to tell the user after the server answered
 * @param {{ result: string, siteTitle: string }} response
 */
export function describeResult(response) {
  switch (response.result) {
    case 'site_created':
      return `已添加「${response.siteTitle}」`
    case 'link_added':
      return `已添加到「${response.siteTitle}」`
    case 'site_exists':
      return `「${response.siteTitle}」已在书签页里`
    case 'link_exists':
      return `「${response.siteTitle}」里已有这个链接`
    default:
      return '已添加'
  }
}
