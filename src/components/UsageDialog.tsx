import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, LoaderCircle, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Desktop, DesktopSummary, LinkUsage, SiteUsage } from '../../shared/types'
import { fullUrl, hostOf } from '../../shared/url'
import { api } from '../api'
import { Dialog, useAct, useUi } from '../ui'
import { filterRows, formatAgo, formatDate, sortRows, USAGE_FILTERS, USAGE_SORTS, usageRows, type UsageFilter, type UsageSort } from '../usage'
import { SiteIcon } from './SiteIcon'

interface Props {
  open: boolean
  onClose: () => void
  desktops: DesktopSummary[]
  desktop: Desktop
}

export function UsageDialog({ open, onClose, ...props }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="使用统计" width="max-w-2xl">
      <Content {...props} />
    </Dialog>
  )
}

const segment = (active: boolean) =>
  `flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-xs font-medium transition ${active ? 'bg-surface text-fg shadow-xs' : 'text-muted hover:text-fg'}`

function Content({ desktops, desktop }: Pick<Props, 'desktops' | 'desktop'>) {
  const queryClient = useQueryClient()
  const act = useAct()
  const { confirm } = useUi()
  // Fetched again on every opening: the clicks that matter may be seconds old
  const usage = useQuery({ queryKey: ['usage'], queryFn: api.usage, staleTime: 0, retry: false })
  const [filter, setFilter] = useState<UsageFilter>('all')
  const [sort, setSort] = useState<UsageSort>('idle')
  const [everyDesktop, setEveryDesktop] = useState(true)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  // "now" only moves on when fresh numbers arrive, so the list doesn't reshuffle between renders
  const now = useMemo(() => Date.now(), [usage.dataUpdatedAt])

  const scoped = useMemo(
    () => (usage.data ? usageRows(usage.data).filter((row) => everyDesktop || row.site.desktopId === desktop.id) : []),
    [usage.data, everyDesktop, desktop.id],
  )
  const rows = useMemo(() => sortRows(filterRows(scoped, filter, now), sort), [scoped, filter, sort, now])

  if (!usage.data) {
    return (
      <div className="grid place-items-center gap-3 py-10 text-sm text-muted" role="status">
        {usage.isError ? <>
          <p>统计加载失败：{usage.error.message}</p>
          <button className="btn btn-soft" onClick={() => void usage.refetch()}>重试</button>
        </> : <LoaderCircle className="animate-spin text-faint" />}
      </div>
    )
  }

  const { since } = usage.data
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['usage'] })
  const removeSite = async (site: SiteUsage) => {
    const ok = await confirm({
      title: `删除「${site.title}」？`,
      message: site.links.length ? `卡片上的 ${site.links.length} 个链接会一并删除。` : undefined,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    await act(() => api.deleteSite(site.id), '卡片已删除')
    await refresh()
  }
  const removeLink = async (link: LinkUsage) => {
    await act(() => api.deleteLink(link.id), '链接已删除')
    await refresh()
  }
  const toggle = (siteId: number) => setExpanded((prev) => {
    const next = new Set(prev)
    if (!next.delete(siteId)) next.add(siteId)
    return next
  })

  const lastUsed = (timestamp: number | null) => (timestamp === null ? '从未点击' : formatAgo(timestamp, now))
  const days = USAGE_FILTERS.find((item) => item.id === filter)!.days
  // Nothing can be known to be unused for longer than clicks have been counted
  const tooEarly = days > 0 && since !== null && now - since < days * 24 * 60 * 60 * 1000

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="筛选" className="flex gap-0.5 rounded-control border border-line bg-surface-2 p-0.5">
          {USAGE_FILTERS.map((item) => (
            <button key={item.id} type="button" aria-pressed={filter === item.id} className={segment(filter === item.id)} onClick={() => setFilter(item.id)}>
              {item.label}
              <span className="font-mono text-[11px] text-faint tabular-nums">{filterRows(scoped, item.id, now).length}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {desktops.length > 1 && (
            <select aria-label="范围" className="input h-8 w-auto px-2 text-xs" value={everyDesktop ? 'all' : 'current'} onChange={(event) => setEveryDesktop(event.target.value === 'all')}>
              <option value="all">全部桌面</option>
              <option value="current">仅「{desktop.name}」</option>
            </select>
          )}
          <select aria-label="排序" className="input h-8 w-auto px-2 text-xs" value={sort} onChange={(event) => setSort(event.target.value as UsageSort)}>
            {USAGE_SORTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
      </div>
      <p className="mt-3 text-xs text-faint">
        统计从本页打开卡片和链接的次数{since !== null && `，自 ${formatDate(since)} 起`}。卡片的次数包含它的全部链接。
      </p>

      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">
          {tooEarly ? `统计开始还不满 ${days} 天，暂时无法判断哪些书签这么久没用过。` : scoped.length === 0 ? '还没有书签。' : '没有符合条件的书签。'}
        </p>
      ) : (
        <ul className="-mx-2 mt-2 max-h-[55vh] overflow-y-auto px-2">
          {rows.map(({ site, clicks, lastUsedAt }) => {
            // A card whose last link was just deleted has nothing left to unfold
            const open = expanded.has(site.id) && site.links.length > 0
            const desktopName = desktops.find((d) => d.id === site.desktopId)?.name
            return (
              <li key={site.id} className="border-b border-line last:border-b-0">
                <div className="flex items-center gap-3 py-2.5">
                  <SiteIcon site={site} size={30} />
                  <div className="min-w-0 flex-1">
                    {/* Opening a bookmark from here is a check before deleting, so it isn't counted as use */}
                    <a href={site.origin} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:text-accent" title={site.title}>
                      {site.title}
                    </a>
                    <p className="truncate text-[11px] leading-5 text-faint">
                      <span className="font-mono">{hostOf(site.origin)}</span>
                      {' · '}
                      {desktops.length > 1 && desktopName ? `${desktopName} / ` : ''}{site.groupName}
                    </p>
                  </div>
                  <div className="shrink-0 text-right" title={lastUsedAt === null ? `添加于 ${formatDate(site.createdAt)}` : `上次打开：${formatDate(lastUsedAt)}`}>
                    <p className="font-mono text-sm tabular-nums">{clicks} 次</p>
                    <p className={`text-[11px] leading-5 ${lastUsedAt === null ? 'text-faint' : 'text-muted'}`}>{lastUsed(lastUsedAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <button
                      className={`icon-btn-sm ${site.links.length ? '' : 'invisible'}`}
                      aria-label={`${open ? '收起' : '展开'}「${site.title}」的 ${site.links.length} 个链接`}
                      aria-expanded={open}
                      onClick={() => toggle(site.id)}
                    >
                      <ChevronDown size={15} className={`transition ${open ? 'rotate-180' : ''}`} />
                    </button>
                    <button className="icon-btn-sm hover:!bg-danger/10 hover:!text-danger" aria-label={`删除卡片「${site.title}」`} onClick={() => void removeSite(site)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {open && (
                  <ul className="mb-2.5 ml-[42px] rounded-control border border-line bg-surface-2 px-2.5 py-1 text-xs">
                    <UsageLine title="主页" detail="/" clicks={site.clicks} lastUsed={lastUsed(site.lastClickedAt)} href={site.origin} />
                    {site.links.map((link) => (
                      <UsageLine
                        key={link.id}
                        title={link.title}
                        detail={link.path}
                        clicks={link.clicks}
                        lastUsed={lastUsed(link.lastClickedAt)}
                        href={fullUrl(site.origin, link.path)}
                        onDelete={() => void removeLink(link)}
                      />
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

interface UsageLineProps {
  title: string
  detail: string
  clicks: number
  lastUsed: string
  href: string
  onDelete?: () => void
}

/** The homepage or one link of an expanded card */
function UsageLine({ title, detail, clicks, lastUsed, href, onDelete }: UsageLineProps) {
  return (
    <li className="flex items-center gap-2.5 py-1">
      <a href={href} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-accent" title={`${title}\n${detail}`}>
        {title}
        <span className="ml-2 font-mono text-[11px] text-faint">{detail}</span>
      </a>
      <span className="shrink-0 font-mono tabular-nums">{clicks} 次</span>
      <span className="w-16 shrink-0 text-right text-muted">{lastUsed}</span>
      <button
        className={`icon-btn-sm size-6 hover:!bg-danger/10 hover:!text-danger ${onDelete ? '' : 'invisible'}`}
        aria-label={`删除链接「${title}」`}
        disabled={!onDelete}
        onClick={onDelete}
      >
        <Trash2 size={12} />
      </button>
    </li>
  )
}
