import type { SystemSettings } from './settings'

export interface NewsSection {
  id: string
  name: string
  feedUrl: string
}

export interface NewsItem {
  title: string
  url: string
  source: string
  publishedAt: number | null
}

export type NewsFeedResult = { status: 'ok'; items: NewsItem[] } | { status: 'permission' }

export const NEWS_REFRESH_MS = 5 * 60 * 1000

export function newsSectionsOf(settings: SystemSettings): NewsSection[] {
  return settings.newsFeedUrl ? [{ id: 'news', name: '快报', feedUrl: settings.newsFeedUrl }] : []
}
