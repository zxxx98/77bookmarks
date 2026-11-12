// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTitleHtml, requestPageTitle, titleFromHtml, TITLE_MESSAGE, TITLE_TIMEOUT_MS } from './page-title'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const htmlResponse = (html: string, status = 200) => new Response(html, {
  status, headers: { 'content-type': 'text/html; charset=utf-8' },
})

describe('page title lookup', () => {
  it('reads a real title, decodes entities and normalizes whitespace without executing HTML', () => {
    const html = '<!-- <title>假标题</title> --><script>throw new Error("must not run")</script><TITLE>\n 中文 &amp; Docs   指南 </TITLE><img src="https://example.com/tracker">'
    expect(titleFromHtml(html)).toBe('中文 & Docs 指南')
    expect(titleFromHtml(`<title>${'长'.repeat(100)}</title>`)).toHaveLength(80)
    expect(titleFromHtml('<title>   </title>')).toBeUndefined()
    expect(titleFromHtml('<h1>No title</h1>')).toBeUndefined()
    expect(titleFromHtml('<title>Incomplete')).toBeUndefined()
  })

  it('fetches the normalized child URL in preview without cookies or a referrer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse('<head><title>文档 &amp; 入门</title></head>'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await requestPageTitle('example.com/docs?utm_source=test&lang=zh#start')).toEqual({ status: 'success', title: '文档 & 入门' })
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/docs?lang=zh#start', expect.objectContaining({
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: expect.any(AbortSignal),
    }))
  })

  it('requests permission for only the pasted site and gets HTML from the extension worker', async () => {
    const request = vi.fn().mockResolvedValue(true)
    const sendMessage = vi.fn().mockResolvedValue({ html: '<title>扩展读取的标题</title>' })
    const fetchMock = vi.fn()
    vi.stubGlobal('chrome', { permissions: { request }, runtime: { id: 'test-extension', sendMessage } })
    vi.stubGlobal('fetch', fetchMock)
    const pending = requestPageTitle('https://example.com/docs', { requestPermission: true })
    // Permission must start synchronously, while the button gesture is still active.
    expect(request).toHaveBeenCalledWith({ origins: ['https://example.com/*'] })
    expect(await pending).toEqual({ status: 'success', title: '扩展读取的标题' })
    expect(sendMessage).toHaveBeenCalledWith({ type: TITLE_MESSAGE, url: 'https://example.com/docs' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back without a request when permission is denied', async () => {
    const sendMessage = vi.fn()
    vi.stubGlobal('chrome', { permissions: { request: vi.fn().mockResolvedValue(false) }, runtime: { id: 'test-extension', sendMessage } })
    expect(await requestPageTitle('https://example.com/docs', { requestPermission: true })).toEqual({ status: 'fallback' })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('does not prompt during automatic lookups and reports when site access is needed', async () => {
    const request = vi.fn()
    const contains = vi.fn().mockResolvedValue(false)
    const sendMessage = vi.fn()
    vi.stubGlobal('chrome', { permissions: { contains, request }, runtime: { id: 'test-extension', sendMessage } })
    expect(await requestPageTitle('https://example.com/docs')).toEqual({ status: 'permission' })
    expect(contains).toHaveBeenCalledWith({ origins: ['https://example.com/*'] })
    expect(request).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('automatically uses already granted site access without a prompt', async () => {
    const request = vi.fn()
    const sendMessage = vi.fn().mockResolvedValue({ html: '<title>已授权的标题</title>' })
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn().mockResolvedValue(true), request }, runtime: { id: 'test-extension', sendMessage } })
    expect(await requestPageTitle('https://example.com/docs')).toEqual({ status: 'success', title: '已授权的标题' })
    expect(request).not.toHaveBeenCalled()
  })

  it('skips permission prompts and network access while offline', async () => {
    const request = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('navigator', { onLine: false })
    vi.stubGlobal('chrome', { permissions: { request }, runtime: { id: 'test-extension' } })
    vi.stubGlobal('fetch', fetchMock)
    expect(await requestPageTitle('https://example.com/docs')).toEqual({ status: 'fallback' })
    expect(request).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back when the extension worker is unavailable', async () => {
    vi.stubGlobal('chrome', { permissions: { contains: vi.fn().mockResolvedValue(true) }, runtime: { id: 'test-extension', sendMessage: vi.fn().mockRejectedValue(new Error('worker unavailable')) } })
    expect(await requestPageTitle('https://example.com/docs')).toEqual({ status: 'fallback' })
  })

  it.each(['https://example.com', 'file:///etc/passwd', 'javascript:alert(1)', ''])('skips invalid URLs and site roots: %s', async (url) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await requestPageTitle(url)).toEqual({ status: 'fallback' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back on CORS and network errors, HTTP errors and non-HTML responses', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(htmlResponse('<title>Forbidden</title>', 403))
      .mockResolvedValueOnce(new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }))
    vi.stubGlobal('fetch', fetchMock)
    for (let i = 0; i < 3; i++) expect(await requestPageTitle('https://example.com/docs')).toEqual({ status: 'fallback' })
  })

  it('aborts a stalled fetch after three seconds', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      signal = init.signal as AbortSignal
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const pending = requestPageTitle('https://example.com/docs')
    await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS)
    expect(await pending).toEqual({ status: 'fallback' })
    expect(signal?.aborted).toBe(true)
  })

  it('also times out while the response body is stalled', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))
      },
    }), { headers: { 'content-type': 'text/html' } }))))
    const pending = requestPageTitle('https://example.com/docs')
    await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS)
    expect(await pending).toEqual({ status: 'fallback' })
  })

  it('stops reading at the head instead of waiting for the rest of the page', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('<head><title>Ready</title></head>')) },
      cancel,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-type': 'text/html' } })))
    expect(await requestPageTitle('https://example.com/docs')).toEqual({ status: 'success', title: 'Ready' })
    expect(cancel).toHaveBeenCalled()
  })

  it('limits the downloaded HTML size and discards an unfinished title', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(`<head><title>${'x'.repeat(300 * 1024)}</title></head>`)))
    const html = await fetchTitleHtml('https://example.com/docs')
    expect(html?.length).toBe(256 * 1024)
    expect(titleFromHtml(html!)).toBeUndefined()
  })
})
