import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { ArrowUpRight, ChevronDown, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { mergeNewsItems, newsOrigins, NEWS_BATCH_SIZE, NEWS_REFRESH_MS, type NewsFeedResult, type NewsItem, type NewsSection, type NewsSource } from '../../shared/news'
import { api } from '../api'
import { platform } from '../platform'
import { useUi } from '../ui'

const VISIBLE_ITEMS = 6
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })

export function NewsPanel({ sections, openInNewTab }: { sections: NewsSection[]; openInNewTab: boolean }) {
  const [open, setOpen] = useState(true)
  const [activeId, setActiveId] = useState(sections[0]?.id)
  const contentId = useId()
  const section = sections.find(({ id }) => id === activeId) ?? sections[0]
  if (!section) return null

  return (
    <section aria-label="快报">
      <header className="mb-3 flex h-8 items-center gap-2 px-1">
        <h2 className="min-w-0">
          <button
            type="button"
            className="group/title flex min-w-0 items-center gap-1.5 rounded-control outline-none select-none focus-visible:ring-2 focus-visible:ring-accent/50"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown size={15} className={`shrink-0 text-muted transition-transform duration-200 group-hover/title:text-fg ${open ? '' : '-rotate-90'}`} />
            <span className="font-display text-sm font-semibold tracking-wide text-muted group-hover/title:text-fg">快报</span>
          </button>
        </h2>
      </header>
      <div id={contentId} hidden={!open} className="overflow-hidden rounded-card border-[length:var(--border-w)] border-line bg-surface shadow-card">
        {open && <>
          {sections.length > 4 ? (
            <div className="border-b border-line px-2 py-1.5">
              <select aria-label="快报板块" className="input h-8" value={section.id} onChange={(event) => setActiveId(event.target.value)}>
                {sections.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
          ) : sections.length > 1 && (
            <div role="group" aria-label="快报板块" className="flex flex-wrap gap-1 border-b border-line px-2 py-1.5">
              {sections.map(({ id, name }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={section.id === id}
                  className={`max-w-full truncate rounded-control px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${section.id === id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-fg/6 hover:text-fg'}`}
                  title={name}
                  onClick={() => setActiveId(id)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <NewsList key={section.id} section={section} openInNewTab={openInNewTab} />
        </>}
      </div>
    </section>
  )
}

function NewsList({ section, openInNewTab }: { section: NewsSection; openInNewTab: boolean }) {
  const queryClient = useQueryClient()
  const { confirm, toast } = useUi()
  const [granting, setGranting] = useState(false)
  const [grantFailed, setGrantFailed] = useState(false)
  const [removing, setRemoving] = useState(false)
  const originCount = useMemo(() => newsOrigins(section.sources).length, [section.sources])
  const queryKey = ['news-feed', section.id, section.sources]
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const result = await platform.newsFeed(section, pageParam)
      if (section.sources.length === 1 && result.failedSources?.length) {
        const previous = queryClient.getQueryData<InfiniteData<NewsFeedResult>>(queryKey)?.pages[0]
        if (previous?.items.length) return { ...result, items: previous.items }
      }
      return result
    },
    getNextPageParam: (_last, [first], offset) => {
      if (first.missingOrigins?.length === originCount) return undefined
      const next = offset + NEWS_BATCH_SIZE
      return next < section.sources.length ? next : undefined
    },
    retry: false,
    staleTime: NEWS_REFRESH_MS,
    refetchInterval: (query) => query.state.data?.pages[0]?.missingOrigins?.length === originCount ? false : NEWS_REFRESH_MS,
  })
  const { fetchNextPage, hasNextPage, isFetching, isError, data } = query

  useEffect(() => {
    if (hasNextPage && !isFetching && !isError) void fetchNextPage({ cancelRefetch: false })
  }, [fetchNextPage, hasNextPage, isFetching, isError])

  const missingOrigins = data?.pages[0]?.missingOrigins
  const failedUrls = new Set(data?.pages.flatMap((page) => page.failedSources ?? []))
  const failedSources = section.sources.filter(({ url }) => failedUrls.has(url))
  const items = useMemo(() => mergeNewsItems(data?.pages.flatMap((page) => page.items) ?? [], section.sources.length > 1), [data, section.sources.length])

  async function grantAccess() {
    setGranting(true)
    setGrantFailed(false)
    try {
      if (missingOrigins?.length && await platform.hostAccess?.request(missingOrigins)) await query.refetch()
      else setGrantFailed(true)
    } catch {
      setGrantFailed(true)
    } finally {
      setGranting(false)
    }
  }

  async function removeSource(source: NewsSource) {
    setRemoving(true)
    try {
      const label = source.name || sourceAddress(source.url)
      const approved = await confirm({
        title: '移除这个订阅源？',
        message: `将从「${section.name}」移除「${label.slice(0, 80)}${label.length > 80 ? '…' : ''}」。`,
        confirmText: '移除订阅源',
        danger: true,
      })
      if (!approved) return
      const settings = await api.removeNewsSource(section.id, source.url)
      queryClient.setQueryData(['settings'], settings)
      toast('已移除订阅源')
    } catch (error) {
      toast(error instanceof Error ? error.message : '移除订阅源失败，请重试', 'error')
    } finally {
      setRemoving(false)
    }
  }

  const loading = !items.length && !isError && (query.isPending || hasNextPage || isFetching)
  const scrollable = items.length > VISIBLE_ITEMS
  return (
    <>
      {missingOrigins?.length ? (
        <div className="grid justify-items-center gap-2 px-3 py-3 text-center text-xs text-muted">
          <p>{grantFailed ? '未获得订阅站点权限，可以重试。' : `此板块有 ${missingOrigins.length} 个站点需要授权。`}</p>
          <button type="button" className="btn btn-soft h-8" disabled={granting} onClick={() => void grantAccess()}>允许读取订阅</button>
        </div>
      ) : null}
      {(isError || failedSources.length > 0) && (
        <div className="border-b border-line text-xs text-muted">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <p role="status">{failedSources.length ? `${failedSources.length} 个订阅读取失败` : items.length ? '部分内容更新失败' : '快报加载失败'}</p>
            <button type="button" className="btn btn-soft h-7 shrink-0 px-2" disabled={isFetching} onClick={() => void query.refetch()}>重试</button>
          </div>
          {failedSources.length > 0 && (
            <ul aria-label="读取失败的订阅源" className="max-h-40 overflow-y-auto overscroll-contain px-3 pb-2">
              {failedSources.map((source) => {
                const address = sourceAddress(source.url)
                const label = source.name || address
                return (
                  <li key={source.url} className="flex items-center justify-between gap-2 border-t border-line py-1.5" title={address}>
                    <div className="min-w-0">
                      <p className="truncate text-fg">{label}</p>
                      {source.name && <p className="truncate text-faint">{address}</p>}
                    </div>
                    <button
                      type="button"
                      className="btn btn-soft h-7 shrink-0 px-2 hover:text-danger"
                      aria-label={`移除订阅源 ${label}`}
                      disabled={removing}
                      onClick={() => void removeSource(source)}
                    >
                      移除
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
      {items.length > 0 ? (
        <div
          className="overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
          style={{ maxHeight: `${VISIBLE_ITEMS * 4}rem` }}
          role={scrollable ? 'region' : undefined}
          aria-label={scrollable ? '快报列表' : undefined}
          tabIndex={scrollable ? 0 : undefined}
        >
          <ul>
            {items.map((item) => <NewsRow key={item.url} item={item} openInNewTab={openInNewTab} />)}
          </ul>
        </div>
      ) : loading ? (
        <div className="grid place-items-center px-3 py-6" role="status" aria-label="正在加载快报">
          <LoaderCircle size={18} className="animate-spin text-faint" />
        </div>
      ) : !isError && !failedSources.length && !missingOrigins?.length && <p className="px-3 py-6 text-center text-sm text-faint">暂无快报</p>}
    </>
  )
}

function sourceAddress(url: string): string {
  const { host, pathname } = new URL(url)
  return host + (pathname === '/' ? '' : pathname)
}

function NewsRow({ item, openInNewTab }: { item: NewsItem; openInNewTab: boolean }) {
  const published = item.publishedAt === null ? null : new Date(item.publishedAt)
  const today = published?.toDateString() === new Date().toDateString()
  return (
    <li className="h-16 [&+li]:border-t [&+li]:border-line">
      <a
        href={item.url}
        title={item.title}
        target={openInNewTab ? '_blank' : undefined}
        rel="noreferrer"
        className="flex h-full items-center gap-2 px-3 text-sm outline-none hover:bg-accent-soft hover:text-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
      >
        <div className="min-w-0 flex-1">
          <span className="line-clamp-2 leading-4.5 [overflow-wrap:anywhere]">{item.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-4 text-muted">
            {published && <>
              <time dateTime={published.toISOString()} className="shrink-0 font-mono tabular-nums">{(today ? timeFormat : dateFormat).format(published)}</time>
              <span aria-hidden="true">·</span>
            </>}
            <span className="truncate">{item.source}</span>
          </span>
        </div>
        <ArrowUpRight aria-hidden="true" size={14} className="shrink-0 text-faint" />
      </a>
    </li>
  )
}
