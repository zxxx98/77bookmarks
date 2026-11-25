import { afterEach, expect, it, vi } from 'vitest'
import { selfhostPlatform } from './selfhost'

afterEach(() => vi.unstubAllGlobals())

it('keeps ordinary failures on the server path and recovers challenged feeds and articles locally', async () => {
  const sources = ['server', 'challenge', 'missing'].map((name) => ({ url: `https://example.test/${name}` }))
  const section = { id: 'mixed', name: '快报', sources }
  const [healthy, challenged, missing] = sources.map(({ url }) => url)
  const serverItem = { feedUrl: healthy, title: '服务器条目', url: healthy + '/article', source: '日报', publishedAt: null }
  const result = { status: 'ok', items: [serverItem], failedSources: [challenged, missing], challengedSources: [challenged] }
  const rss = '<rss version="2.0"><channel><item><title>本机条目</title><link>/local</link><description>本机摘要</description></item></channel></rss>'
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (url === '/api/news-feed?section=mixed&offset=0') return Response.json(result)
    if (url === challenged && options.credentials === 'include') return new Response(rss)
    throw new TypeError('Failed to fetch')
  })
  vi.stubGlobal('fetch', fetch)
  expect(await selfhostPlatform.newsFeed(section, 0)).toEqual(result)
  expect(fetch.mock.calls.map(([url, options]) => [url, options.credentials])).toEqual([
    ['/api/news-feed?section=mixed&offset=0', 'same-origin'], [challenged, 'omit'],
  ])
  fetch.mockClear()
  const retried = await selfhostPlatform.newsFeed(section, 0, new Set([challenged]))
  expect(retried.failedSources).toEqual([missing])
  expect(retried.challengedSources).toEqual([])
  expect(retried.items).toEqual([serverItem, expect.objectContaining({ title: '本机条目', feedUrl: challenged })])
  expect(await selfhostPlatform.newsArticle(section, retried.items[1])).toMatchObject({ body: '本机摘要' })
  expect(fetch.mock.calls.map(([url, options]) => [url, options.credentials])).toEqual([
    ['/api/news-feed?section=mixed&offset=0', 'same-origin'], [challenged, 'include'],
  ])
})

it('uses an anonymous browser request only for challenged sources configured in the requested batch', async () => {
  const sources = Array.from({ length: 9 }, (_, index) => ({ url: `https://batch.test/${index}` }))
  const section = { id: 'batch', name: '快报', sources }
  const urls = [sources[0].url, sources[8].url, 'https://unknown.test/rss']
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ status: 'ok', items: [], failedSources: urls, challengedSources: urls }))
    .mockResolvedValueOnce(new Response('<rss version="2.0"><channel><title>空</title></channel></rss>'))
  vi.stubGlobal('fetch', fetch)
  const result = await selfhostPlatform.newsFeed(section, 8)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch).toHaveBeenLastCalledWith(sources[8].url, expect.objectContaining({ credentials: 'omit' }))
  expect(result.failedSources).toEqual([urls[0], urls[2]])
})
