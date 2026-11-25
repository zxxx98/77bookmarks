import { parseFeed } from 'feedsmith'
import { mergeNewsItems, newsSourceKey, NEWS_REFRESH_MS, type NewsArticle, type NewsFeedResult, type NewsHeadline, type NewsItem, type NewsSource } from '../shared/news'
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
  article?: NewsArticle
}

interface ParsedEntry extends NewsHeadline {
  article?: NewsArticle
}

type ReadFeed = (url: string) => Promise<ParsedEntry[]>

function articleContent(kind: NewsArticle['kind'], body?: string, format: NewsArticle['format'] = 'html'): NewsArticle | undefined {
  const content = body?.trim()
  if (content) return { kind, format, body: content }
}

function atomContent(kind: NewsArticle['kind'], content?: { type?: string; value?: string }): NewsArticle | undefined {
  const type = content?.type?.toLowerCase()
  if (!type || type === 'text' || type === 'text/plain') return articleContent(kind, content?.value, 'text')
  if (type === 'html' || type === 'xhtml' || type === 'text/html' || type === 'application/xhtml+xml') return articleContent(kind, content?.value)
}

function webUrl(value?: string, base?: string): URL | undefined {
  if (!value?.trim()) return
  try {
    const url = new URL(value, base)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) return url
  } catch { /* Skip invalid links. */ }
}

const plainText = (value?: string) => value?.replace(/\s+/g, ' ').trim()

export function readNewsItems(text: string, url: string): ParsedEntry[] {
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
        article: articleContent('full', item.content?.encoded) ?? articleContent('summary', item.description),
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
        article: atomContent('full', item.content) ?? atomContent('summary', item.summary),
      }))
      break
    case 'rdf':
      title = result.feed.title
      base = webUrl(result.feed.xml?.base, url)?.href ?? url
      entries = (result.feed.items ?? []).map((item) => ({
        title: item.title ?? item.dc?.titles?.[0], link: item.link, base: item.xml?.base,
        source: item.dc?.sources?.[0], date: item.dc?.dates?.[0],
        article: articleContent('full', item.content?.encoded) ?? articleContent('summary', item.description),
      }))
      break
    case 'json':
      title = result.feed.title
      entries = (result.feed.items ?? []).map((item) => ({
        title: item.title ?? item.summary, link: item.url ?? item.external_url,
        date: item.date_published ?? item.date_modified,
        article: articleContent('full', item.content_html) ?? articleContent('full', item.content_text, 'text') ?? articleContent('summary', item.summary, 'text'),
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
      source: (plainText(entry.source) || feedTitle || '').slice(0, 120),
      publishedAt: Number.isFinite(date) ? date : null,
      ...(entry.article ? { article: entry.article } : {}),
    }]
  })
  return mergeNewsItems(items, false)
}

export async function readNewsBatch(sources: NewsSource[], read: ReadFeed, aggregated: boolean): Promise<NewsFeedResult> {
  const results = await Promise.allSettled(sources.map(({ url }) => read(url)))
  const items: NewsItem[] = []
  const failedSources: string[] = []
  const challengedSources: string[] = []
  for (const [index, result] of results.entries()) {
    const { url, name } = sources[index]
    if (result.status === 'rejected') {
      failedSources.push(url)
      if (result.reason instanceof FeedChallengeError) challengedSources.push(url)
      continue
    }
    for (const { article: _article, ...item } of result.value) {
      items.push({ ...item, feedUrl: url, source: item.source || name || new URL(item.url).hostname })
    }
  }
  return {
    status: 'ok', items: mergeNewsItems(items, aggregated),
    ...(failedSources.length ? { failedSources } : {}),
    ...(challengedSources.length ? { challengedSources } : {}),
  }
}

export async function readNewsArticle(read: ReadFeed, feedUrl: string, articleUrl: string): Promise<NewsArticle | null> {
  const entries = await read(feedUrl)
  return entries.find(({ url }) => url === articleUrl)?.article ?? null
}

class FeedChallengeError extends Error {}

async function fetchNewsFeed(input: string, credentials: RequestCredentials): Promise<ParsedEntry[]> {
  const url = parseNewsFeedUrl(input)
  if (!url) throw new Error('快报订阅地址无效')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(url, {
      signal: controller.signal, credentials, referrerPolicy: 'no-referrer',
      headers: { accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*;q=0.1' },
    })
    if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') throw new FeedChallengeError()
    const html = /^text\/html\b/i.test(response.headers.get('content-type') ?? '')
    if ((!response.ok && !html) || !response.body) throw new Error('无法读取快报订阅')
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
    const text = chunks.join('') + decoder.decode()
    if (html && /^\s*(?:<!doctype html[^>]*>\s*)?<html\b/i.test(text) && /window\._cf_chl_opt\s*=|\/cdn-cgi\/challenge-platform\//i.test(text)) {
      throw new FeedChallengeError()
    }
    if (!response.ok) throw new Error('无法读取快报订阅')
    return readNewsItems(text, response.url || url)
  } finally {
    clearTimeout(timeout)
    void reader?.cancel().catch(() => undefined)
    controller.abort()
  }
}

/** Shares each in-flight request and recent result across open pages. */
export function createNewsFeedReader(credentials: RequestCredentials = 'omit') {
  const cache = new Map<string, { items: Promise<ParsedEntry[]>; expiresAt: number }>()
  const read: ReadFeed = (url) => {
    const key = newsSourceKey(url)
    const cached = cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.items

    cache.delete(key)
    const record = { items: fetchNewsFeed(url, credentials), expiresAt: Infinity }
    cache.set(key, record)
    if (cache.size > MAX_CACHED_FEEDS) cache.delete(cache.keys().next().value!)
    void record.items.then(
      () => { record.expiresAt = Date.now() + NEWS_REFRESH_MS },
      () => { if (cache.get(key) === record) cache.delete(key) },
    )
    return record.items
  }
  return read
}
