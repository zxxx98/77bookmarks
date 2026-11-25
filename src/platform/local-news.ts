import { mergeNewsItems, newsSourcesAt, type NewsFeedResult, type NewsItem, type NewsSection } from '../../shared/news'
import { createNewsFeedReader, readNewsArticle, readNewsBatch } from '../news-feed'

const readers = { omit: createNewsFeedReader(), include: createNewsFeedReader('include') }

export async function retryChallengedFeeds(section: NewsSection, offset: number, server: NewsFeedResult, verificationVisits?: ReadonlySet<string>): Promise<NewsFeedResult> {
  const batch = newsSourcesAt(section, offset) ?? []
  const sources = batch.filter(({ url }) => server.challengedSources?.includes(url) && server.failedSources?.includes(url))
  if (!sources.length) return server

  const credentials = (url: string) => verificationVisits?.has(url) ? 'include' : 'omit'
  const aggregated = section.sources.length > 1
  const local = await readNewsBatch(sources, (url) => readers[credentials(url)](url), aggregated)
  const recovered = new Set(sources.filter(({ url }) => !local.failedSources?.includes(url)).map(({ url }) => url))
  const items = local.items.map((item) => ({ ...item, localCredentials: credentials(item.feedUrl) } satisfies NewsItem))
  return {
    ...server,
    items: mergeNewsItems([...server.items, ...items], aggregated),
    failedSources: server.failedSources?.filter((url) => !recovered.has(url)),
    challengedSources: server.challengedSources?.filter((url) => !recovered.has(url)),
  }
}

export function localNewsArticle(item: NewsItem) {
  return readNewsArticle(readers[item.localCredentials ?? 'omit'], item.feedUrl, item.url)
}
