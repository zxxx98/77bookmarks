import { parseFeed } from 'feedsmith'
import { NEWS_REFRESH_MS, type NewsItem } from '../shared/news'
import { parseNewsFeedUrl } from '../shared/url'

const TIMEOUT_MS = 8000
const MAX_FEED_BYTES = 2 * 1024 * 1024
const MAX_CACHED_FEEDS = 16

interface FeedEntry {
  title?: string
  link?: string
  source?: string
  date?: string
  base?: string
}

function webUrl(value?: string, base?: string): URL | undefined {
  if (!value?.trim()) return
  try {
    const url = new URL(value, base)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) return url
  } catch { /* Skip invalid links. */ }
}

const plainText = (value?: string) => value?.replace(/\s+/g, ' ').trim()

export function readNewsItems(text: string, url: string): NewsItem[] {
  const result = parseFeed(text)
  let entries: FeedEntry[]
  let title: string | undefined
  let base = url
  switch (result.format) {
    case 'rss':
      title = result.feed.title
      base = webUrl(result.feed.xml?.base, url)?.href ?? url
      entries = (result.feed.items ?? []).map((item) => ({
        title: item.title ?? item.dc?.titles?.[0],
        link: item.link ?? (item.guid?.isPermaLink !== false ? webUrl(item.guid?.value)?.href : undefined),
        source: item.source?.title ?? item.dc?.sources?.[0],
        date: item.pubDate ?? item.dc?.dates?.[0],
        base: item.xml?.base,
      }))
      break
    case 'atom':
      title = result.feed.title?.value
      base = webUrl(result.feed.xml?.base, url)?.href ?? url
      entries = (result.feed.entries ?? []).map((item) => ({
        title: item.title?.value,
        link: item.links?.find((link) => link.href && (!link.rel || link.rel === 'alternate'))?.href,
        source: item.source?.title?.value,
        date: item.published ?? item.updated,
        base: item.xml?.base,
      }))
      break
    case 'rdf':
      title = result.feed.title
      base = webUrl(result.feed.xml?.base, url)?.href ?? url
      entries = (result.feed.items ?? []).map((item) => ({
        title: item.title ?? item.dc?.titles?.[0], link: item.link, base: item.xml?.base,
        source: item.dc?.sources?.[0], date: item.dc?.dates?.[0],
      }))
      break
    case 'json':
      title = result.feed.title
      entries = (result.feed.items ?? []).map((item) => ({
        title: item.title ?? item.summary, link: item.url ?? item.external_url,
        date: item.date_published ?? item.date_modified,
      }))
      break
  }

  const feedTitle = plainText(title)
  const items = entries.flatMap((entry) => {
    const link = webUrl(entry.link, webUrl(entry.base, base)?.href ?? base)
    const headline = plainText(entry.title)
    if (!link || !headline) return []
    const date = entry.date ? Date.parse(entry.date) : NaN
    return [{
      title: headline.slice(0, 300), url: link.href,
      source: (plainText(entry.source) || feedTitle || link.hostname).slice(0, 120),
      publishedAt: Number.isFinite(date) ? date : null,
    }]
  })
  items.sort((a, b) => (b.publishedAt ?? Number.MIN_SAFE_INTEGER) - (a.publishedAt ?? Number.MIN_SAFE_INTEGER))
  const seen = new Set<string>()
  return items.filter(({ url }) => {
    if (seen.has(url)) return false
    seen.add(url)
    return true
  })
}

export async function fetchNewsFeed(input: string): Promise<NewsItem[]> {
  const url = parseNewsFeedUrl(input)
  if (!url) throw new Error('快报订阅地址无效')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(url, {
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*;q=0.1' },
    })
    if (!response.ok || !response.body) throw new Error('无法读取快报订阅')
    reader = response.body.getReader()
    const charset = response.headers.get('content-type')?.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]
    const decoder = new TextDecoder(charset)
    const chunks: string[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_FEED_BYTES) throw new Error('快报订阅文件过大')
      chunks.push(decoder.decode(value, { stream: true }))
    }
    return readNewsItems(chunks.join('') + decoder.decode(), response.url || url)
  } finally {
    clearTimeout(timeout)
    void reader?.cancel().catch(() => undefined)
    controller.abort()
  }
}

/** Shares each in-flight request and recent result across open pages. */
export function createNewsFeedReader() {
  const cache = new Map<string, { items: Promise<NewsItem[]>; expiresAt: number }>()
  return (url: string): Promise<NewsItem[]> => {
    const cached = cache.get(url)
    if (cached && cached.expiresAt > Date.now()) return cached.items

    cache.delete(url)
    const record = { items: fetchNewsFeed(url), expiresAt: Infinity }
    cache.set(url, record)
    if (cache.size > MAX_CACHED_FEEDS) cache.delete(cache.keys().next().value!)
    void record.items.then(
      () => { record.expiresAt = Date.now() + NEWS_REFRESH_MS },
      () => { if (cache.get(url) === record) cache.delete(url) },
    )
    return record.items
  }
}
