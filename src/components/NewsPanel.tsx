import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, ChevronDown, LoaderCircle } from 'lucide-react'
import { useId, useState } from 'react'
import { NEWS_REFRESH_MS, type NewsItem, type NewsSection } from '../../shared/news'
import { platform } from '../platform'

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
          {sections.length > 1 && (
            <div role="group" aria-label="快报板块" className="flex flex-wrap gap-1 border-b border-line px-2 py-1.5">
              {sections.map(({ id, name }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={section.id === id}
                  className={`rounded-control px-2.5 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${section.id === id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-fg/6 hover:text-fg'}`}
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
  const [granting, setGranting] = useState(false)
  const [grantFailed, setGrantFailed] = useState(false)
  const query = useQuery({
    queryKey: ['news-feed', section.id, section.feedUrl],
    queryFn: () => platform.newsFeed(section),
    retry: false,
    staleTime: (query) => query.state.data?.status === 'permission' ? 0 : NEWS_REFRESH_MS,
    refetchInterval: (query) => query.state.data?.status === 'permission' ? false : NEWS_REFRESH_MS,
  })

  async function grantAccess() {
    setGranting(true)
    setGrantFailed(false)
    try {
      if (await platform.hostAccess?.request(`${new URL(section.feedUrl).origin}/*`)) await query.refetch()
      else setGrantFailed(true)
    } catch {
      setGrantFailed(true)
    } finally {
      setGranting(false)
    }
  }

  if (query.isPending) return (
    <div className="grid place-items-center px-3 py-6" role="status" aria-label="正在加载快报">
      <LoaderCircle size={18} className="animate-spin text-faint" />
    </div>
  )
  if (query.data?.status === 'permission' && !query.isError) return (
    <div className="grid justify-items-center gap-2 px-3 py-4 text-center text-sm text-muted">
      <p>{grantFailed ? '未获得订阅站点权限，可以重试。' : '允许访问订阅站点后即可显示快报。'}</p>
      <button type="button" className="btn btn-soft h-8" disabled={granting} onClick={() => void grantAccess()}>允许读取订阅</button>
    </div>
  )

  const items = query.data?.status === 'ok' ? query.data.items : []
  const scrollable = items.length > VISIBLE_ITEMS
  return (
    <>
      {query.isError && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted" role="status">
          <span>{items.length ? '更新失败，暂时显示上次的快报' : '快报加载失败'}</span>
          <button type="button" className="btn btn-soft h-7 shrink-0 px-2" disabled={query.isFetching} onClick={() => void query.refetch()}>重试</button>
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
      ) : !query.isError && <p className="px-3 py-6 text-center text-sm text-faint">暂无快报</p>}
    </>
  )
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
