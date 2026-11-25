import type { SystemSettings } from './settings'
import { parseNewsFeedUrl } from './url'

export interface NewsSource {
  url: string
  name?: string
}

export interface NewsSection {
  id: string
  name: string
  sources: NewsSource[]
}

export interface NewsHeadline {
  title: string
  url: string
  source: string
  publishedAt: number | null
}

export interface NewsItem extends NewsHeadline {
  feedUrl: string
  localCredentials?: 'omit' | 'include'
}

export interface NewsArticle {
  kind: 'full' | 'summary'
  format: 'html' | 'text'
  body: string
}

export interface NewsFeedResult {
  status: 'ok'
  items: NewsItem[]
  failedSources?: string[]
  challengedSources?: string[]
  missingOrigins?: string[]
}

export const NEWS_REFRESH_MS = 5 * 60 * 1000
export const NEWS_BATCH_SIZE = 8
export const MAX_NEWS_SECTIONS = 100
export const MAX_NEWS_SOURCES = 1000
export const MAX_NEWS_NAME = 160
const MAX_AGGREGATED_ITEMS = 120

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function newsSourceKey(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  return parsed.href
}

export function parseNewsSections(value: unknown): NewsSection[] | null {
  if (!Array.isArray(value) || value.length > MAX_NEWS_SECTIONS) return null
  const sections: NewsSection[] = []
  const ids = new Set<string>(['news'])
  let count = 0
  let size = 0
  for (const section of value) {
    if (!isObject(section) || typeof section.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(section.id) || ids.has(section.id)) return null
    if (typeof section.name !== 'string' || !section.name.trim() || section.name.length > MAX_NEWS_NAME) return null
    if (!Array.isArray(section.sources) || !section.sources.length) return null
    ids.add(section.id)
    count += section.sources.length
    if (count > MAX_NEWS_SOURCES) return null
    const sources: NewsSource[] = []
    const seen = new Set<string>()
    for (const source of section.sources) {
      if (!isObject(source) || (source.name !== undefined && (typeof source.name !== 'string' || source.name.length > MAX_NEWS_NAME))) return null
      const url = parseNewsFeedUrl(source.url)
      if (!url) return null
      const key = newsSourceKey(url)
      if (seen.has(key)) continue
      seen.add(key)
      const name = typeof source.name === 'string' ? source.name.trim() : ''
      size += url.length + name.length
      if (size > 1024 * 1024) return null
      sources.push({ url, ...(name ? { name } : {}) })
    }
    sections.push({ id: section.id, name: section.name.trim(), sources })
  }
  return sections
}

export function newsSectionsOf(settings: SystemSettings): NewsSection[] {
  const sections = settings.newsSections ?? []
  return settings.newsFeedUrl ? [{ id: 'news', name: '快报', sources: [{ url: settings.newsFeedUrl }] }, ...sections] : sections
}

export function newsSourcesAt(section: NewsSection, offset: unknown): NewsSource[] | null {
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset >= section.sources.length || offset % NEWS_BATCH_SIZE !== 0) return null
  return section.sources.slice(offset, offset + NEWS_BATCH_SIZE)
}

export function findNewsSource(section: NewsSection | undefined, url: unknown): NewsSource | undefined {
  return section?.sources.find((source) => source.url === url)
}

export function newsOrigins(sources: NewsSource[]): string[] {
  return [...new Set(sources.map(({ url }) => newsOrigin(url)))]
}

export const newsOrigin = (url: string): string => `${new URL(url).origin}/*`

export function mergeNewsItems<T extends NewsHeadline>(items: T[], aggregated = true): T[] {
  const sorted = [...items].sort((a, b) => (b.publishedAt ?? Number.MIN_SAFE_INTEGER) - (a.publishedAt ?? Number.MIN_SAFE_INTEGER))
  const result: T[] = []
  const seen = new Set<string>()
  for (const item of sorted) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    result.push(item)
    if (aggregated && result.length === MAX_AGGREGATED_ITEMS) break
  }
  return result
}
