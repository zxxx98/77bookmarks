import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, LoaderCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { NEWS_REFRESH_MS, type NewsItem, type NewsSection } from '../../shared/news'
import { platform } from '../platform'
import { Dialog } from '../ui'

interface Props {
  item: NewsItem
  section: NewsSection
  openInNewTab: boolean
  onClose: () => void
}

export function NewsReader({ item, section, openInNewTab, onClose }: Props) {
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => { content.current?.focus({ preventScroll: true }) }, [])

  const query = useQuery({
    queryKey: ['news-article', section.id, item.feedUrl, item.url, item.localCredentials],
    queryFn: async () => {
      const article = await platform.newsArticle(section, item)
      if (article?.format !== 'html') return article
      const { sanitizeNewsHtml } = await import('../news-article-html')
      const body = sanitizeNewsHtml(article.body, item.url)
      return body ? { ...article, body } : null
    },
    staleTime: NEWS_REFRESH_MS,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const article = query.data
  const published = item.publishedAt === null ? null : new Date(item.publishedAt)

  return createPortal(
    <Dialog open onClose={onClose} title={item.title} width="max-w-2xl" panelClassName="flex max-h-[min(76dvh,52rem)] flex-col overflow-hidden">
      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
          <span className="truncate" title={item.source}>{item.source}</span>
          {published && <time dateTime={published.toISOString()} className="shrink-0">{published.toLocaleString('zh-CN')}</time>}
          {article && <span className="shrink-0 rounded-pill bg-accent-soft px-1.5 py-0.5 text-accent">{article.kind === 'full' ? '全文' : '摘要'}</span>}
        </div>
        <a className="btn btn-soft h-8 shrink-0" href={item.url} target={openInNewTab ? '_blank' : undefined} rel="noreferrer">
          打开原文 <ArrowUpRight aria-hidden="true" size={14} />
        </a>
      </div>

      <div ref={content} role="region" aria-label="快报内容" tabIndex={0} className="min-h-0 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50">
        {query.isPending ? (
          <div className="flex items-center gap-2 py-5 text-sm text-muted" role="status"><LoaderCircle className="animate-spin" size={16} />正在读取快报内容…</div>
        ) : article ? (
          article.format === 'html'
            ? <article className="news-article" dangerouslySetInnerHTML={{ __html: article.body }} />
            : <article className="news-article whitespace-pre-wrap">{article.body}</article>
        ) : query.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm text-muted">
            <p role="status">快报内容读取失败</p>
            <button type="button" className="btn btn-soft h-8" disabled={query.isFetching} onClick={() => void query.refetch()}>重试</button>
          </div>
        ) : <p className="py-4 text-sm text-muted">此条订阅未提供正文或摘要。</p>}
      </div>
    </Dialog>,
    document.body,
  )
}
