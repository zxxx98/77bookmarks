import { afterEach, describe, expect, it, vi } from 'vitest'
import { canLoadDirectly, linkTitleFrom, pickDirectIcon, probeIcon, reportedMeta, siteTitleFrom } from './meta'

describe('titles reported by the browser extension', () => {
  const url = 'https://grafana.corp.example/d/abc/prod-overview'

  it('names a link after the tab title, without the name of its site', () => {
    expect(linkTitleFrom(reportedMeta('Prod Overview - Dashboards - Grafana', url), url, 'Grafana')).toBe('Prod Overview - Dashboards')
  })

  it('has no link title to offer when the tab title is only the site name', () => {
    expect(linkTitleFrom(reportedMeta('Grafana', url), url, 'Grafana')).toBeNull()
  })

  it('is not mistaken for a redirect, unlike a fetch that ended on a login page', () => {
    const fetched = { title: 'Login - Grafana', siteName: null, icons: [], finalUrl: 'https://grafana.corp.example/login' }
    expect(linkTitleFrom(fetched, url, 'Grafana')).toBeNull()
    expect(linkTitleFrom(reportedMeta('Prod Overview', url), url, 'Grafana')).toBe('Prod Overview')
  })

  it('names a card after the meaningful part of a homepage tab title', () => {
    expect(siteTitleFrom(reportedMeta('首页 | 内部知识库', 'https://wiki.corp.example'))).toBe('内部知识库')
  })
})

describe('icons loaded from the site itself', () => {
  afterEach(() => vi.unstubAllGlobals())

  const serve = (response: () => Response) => {
    const fetchMock = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('takes only https addresses, so that no image is blocked as mixed content', () => {
    expect(canLoadDirectly('https://example.com/icon.png')).toBe(true)
    expect(canLoadDirectly('http://example.com/icon.png')).toBe(false)
    expect(canLoadDirectly('not an address')).toBe(false)
  })

  it('accepts an address that serves an image', async () => {
    serve(() => new Response('', { status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': '1024' } }))
    expect(await probeIcon('https://example.com/icon.png')).toEqual({
      url: 'https://example.com/icon.png',
      contentType: 'image/png',
      size: 1024,
    })
  })

  it('turns down an address that serves something else', async () => {
    serve(() => new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    expect(await probeIcon('https://example.com/page')).toBeNull()
  })

  it('turns down an address that is not there', async () => {
    serve(() => new Response('', { status: 404 }))
    expect(await probeIcon('https://example.com/icon.png')).toBeNull()
  })

  it('trusts a site that refuses HEAD, because the browser asks with GET anyway', async () => {
    serve(() => new Response('', { status: 405 }))
    expect(await probeIcon('https://example.com/icon.png')).toEqual({
      url: 'https://example.com/icon.png',
      contentType: null,
      size: null,
    })
  })

  it('takes the address the page offers', async () => {
    const fetchMock = serve(() =>
      new Response('', { status: 200, headers: { 'Content-Type': 'image/x-icon' } }),
    )
    expect(await pickDirectIcon('https://example.com', ['https://example.com/icon.png'])).toMatchObject({
      url: 'https://example.com/icon.png',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('skips an address the browser would have to load over http', async () => {
    const fetchMock = serve(() => new Response('', { status: 200, headers: { 'Content-Type': 'image/png' } }))
    expect(await pickDirectIcon('https://example.com', ['http://example.com/icon.png'])).toMatchObject({
      url: 'https://example.com/favicon.ico',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
