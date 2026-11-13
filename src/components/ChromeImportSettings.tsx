import { ChevronDown, ChevronRight, FileCode2, Folder, LoaderCircle, Search, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { backupStats } from '../../shared/backup'
import type { DesktopSummary } from '../../shared/types'
import { fullUrl, hostOf } from '../../shared/url'
import { api } from '../api'
import {
  allCheckState,
  countGroupSelected,
  createChromeSelection,
  filterChromeDesktop,
  filterChromePreview,
  groupCheckState,
  hasSiteRoot,
  parseChromeBookmarks,
  rootOriginSet,
  siteCheckState,
  toggleAllSelection,
  toggleGroupSelection,
  toggleLinkSelection,
  toggleSiteSelection,
  type CheckState,
  type ChromeImport,
  type ChromeImportSelection,
} from '../chrome-import'
import { useUi } from '../ui'

interface Props {
  desktops: DesktopSummary[]
  onImported: (desktopId: number) => void
  onClose: () => void
  onBusyChange: (busy: boolean) => void
  importBusy: boolean
}

function TriCheckbox({
  state,
  disabled,
  label,
  onChange,
}: {
  state: CheckState
  disabled?: boolean
  label: string
  onChange: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'indeterminate'
  }, [state])

  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-4 shrink-0 cursor-pointer accent-accent-solid disabled:cursor-not-allowed"
      checked={state === 'checked'}
      disabled={disabled}
      aria-label={label}
      onChange={onChange}
    />
  )
}

function initialExpandedGroups(data: ChromeImport): Set<number> {
  const groups = data.desktop.groups
  const totalSites = groups.reduce((sum, group) => sum + group.sites.length, 0)
  if (groups.length <= 5 || totalSites <= 30) {
    return new Set(groups.map((_, index) => index))
  }
  return groups.length > 0 ? new Set([0]) : new Set()
}

function initialExpandedSites(data: ChromeImport): Set<string> {
  const expanded = new Set<string>()
  const totalLinks = data.desktop.groups.reduce(
    (sum, group) => sum + group.sites.reduce((siteSum, site) => siteSum + site.links.length, 0),
    0,
  )
  if (totalLinks > 80) return expanded
  data.desktop.groups.forEach((group, groupIndex) => {
    group.sites.forEach((site, siteIndex) => {
      if (site.links.length > 0 && site.links.length <= 8) {
        expanded.add(`${groupIndex}:${siteIndex}`)
      }
    })
  })
  return expanded
}

export function ChromeImportSettings({ desktops, onImported, onClose, onBusyChange, importBusy }: Props) {
  const { toast } = useUi()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; data: ChromeImport } | null>(null)
  const [selection, setSelection] = useState<ChromeImportSelection>([])
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set())
  const [expandedSites, setExpandedSites] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<'idle' | 'reading' | 'parsing' | 'importing'>('idle')
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const busy = stage !== 'idle'

  const clearFile = () => {
    setFile(null)
    setSelection([])
    setExpandedGroups(new Set())
    setExpandedSites(new Set())
    setQuery('')
  }

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen || busy || importBusy) return
    clearFile()
    setStage('reading')
    onBusyChange(true)
    setDone(0)
    setTotal(0)
    try {
      // Let the reading state render before parsing a large HTML document.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const html = await chosen.text()
      setStage('parsing')
      const data = await parseChromeBookmarks(html, (count, size) => {
        setDone(count)
        setTotal(size)
      })
      setFile({ name: chosen.name, data })
      setSelection(createChromeSelection(data))
      setExpandedGroups(initialExpandedGroups(data))
      setExpandedSites(initialExpandedSites(data))
    } catch (error) {
      toast(error instanceof Error ? error.message : '读取 Chrome 书签失败', 'error')
    } finally {
      setStage('idle')
      onBusyChange(false)
    }
  }

  const rootSet = useMemo(() => (file ? rootOriginSet(file.data) : new Set<string>()), [file])
  const selectedDesktop = useMemo(
    () => (file ? filterChromeDesktop(file.data, selection) : null),
    [file, selection],
  )
  const totalStats = useMemo(() => (file ? backupStats([file.data.desktop]) : null), [file])
  const selectedStats = useMemo(() => (selectedDesktop ? backupStats([selectedDesktop]) : null), [selectedDesktop])
  const visibleGroups = useMemo(
    () => (file ? filterChromePreview(file.data.desktop.groups, query) : []),
    [file, query],
  )

  const runImport = async () => {
    if (!file || !selectedDesktop || !selectedStats || selectedStats.sites === 0 || busy || importBusy) return
    setStage('importing')
    onBusyChange(true)
    setDone(0)
    setTotal(0)
    try {
      const result = await api.importChrome(selectedDesktop)
      toast(`已导入 ${result.sites} 张卡片、${result.links} 个链接${file.data.skipped ? `，跳过 ${file.data.skipped} 个非网页或无效网址` : ''}`)
      onBusyChange(false)
      setStage('idle')
      onImported(result.desktopIds[0])
      onClose()
    } catch (error) {
      toast(`${error instanceof Error ? error.message : '导入失败'}；本次导入未保存`, 'error')
      setStage('idle')
      onBusyChange(false)
    }
  }

  const globalState: CheckState = file ? allCheckState(file.data, selection, rootSet) : 'unchecked'
  const filtering = query.trim().length > 0

  const allExpanded =
    visibleGroups.length > 0 &&
    visibleGroups.every(
      (vg) =>
        expandedGroups.has(vg.groupIndex) &&
        vg.sites.every((vs) => vs.linkIndices.length === 0 || expandedSites.has(`${vg.groupIndex}:${vs.siteIndex}`)),
    )

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedGroups(new Set())
      setExpandedSites(new Set())
      return
    }
    const nextGroups = new Set<number>()
    const nextSites = new Set<string>()
    visibleGroups.forEach((vg) => {
      nextGroups.add(vg.groupIndex)
      vg.sites.forEach((vs) => {
        if (vs.linkIndices.length > 0) nextSites.add(`${vg.groupIndex}:${vs.siteIndex}`)
      })
    })
    setExpandedGroups(nextGroups)
    setExpandedSites(nextSites)
  }

  const toggleGroupExpand = (groupIndex: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (!next.delete(groupIndex)) next.add(groupIndex)
      return next
    })
  }

  const toggleSiteExpand = (key: string) => {
    setExpandedSites((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  const handleToggleAll = () => {
    if (!file) return
    setSelection((prev) => toggleAllSelection(file.data, prev, rootSet))
  }

  const handleToggleGroup = (groupIndex: number) => {
    if (!file) return
    const group = file.data.desktop.groups[groupIndex]
    setSelection((prev) =>
      prev.map((groupSel, index) => (index === groupIndex ? toggleGroupSelection(group, groupSel, rootSet) : groupSel)),
    )
  }

  const handleToggleSite = (groupIndex: number, siteIndex: number) => {
    if (!file) return
    const site = file.data.desktop.groups[groupIndex].sites[siteIndex]
    setSelection((prev) =>
      prev.map((groupSel, gIdx) =>
        gIdx === groupIndex
          ? groupSel.map((siteSel, sIdx) => (sIdx === siteIndex ? toggleSiteSelection(site, siteSel, rootSet) : siteSel))
          : groupSel,
      ),
    )
  }

  const handleToggleLink = (groupIndex: number, siteIndex: number, linkIndex: number) => {
    setSelection((prev) =>
      prev.map((groupSel, gIdx) =>
        gIdx === groupIndex
          ? groupSel.map((siteSel, sIdx) => (sIdx === siteIndex ? toggleLinkSelection(siteSel, linkIndex) : siteSel))
          : groupSel,
      ),
    )
  }

  const progress = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <section className="border-t border-line pt-4">
      <h3 className="label">导入 Chrome 书签</h3>
      <p className="mb-2.5 text-xs leading-relaxed text-faint">在 Chrome 的书签管理器中导出 HTML 文件，再选择该文件。书签会添加为新桌面，嵌套文件夹会成为分组；图标优先使用浏览器缓存。</p>
      <input ref={input} type="file" accept=".html,.htm,text/html" disabled={importBusy} hidden onChange={chooseFile} />
      {!file ? (
        <button
          className="flex w-full flex-col items-center gap-1.5 rounded-control border border-dashed border-line px-4 py-5 text-sm text-muted transition outline-none hover:border-accent/50 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/50"
          disabled={importBusy}
          onClick={() => input.current?.click()}
        >
          {busy ? <LoaderCircle size={18} className="animate-spin" /> : <Upload size={18} />}
          {stage === 'reading' ? '正在读取文件…' : stage === 'parsing' ? '正在解析书签…' : '选择 Chrome 导出的 HTML 文件'}
        </button>
      ) : (
        <>
          <div className="flex items-start gap-3 rounded-control border border-line bg-surface-2/60 p-3">
            <FileCode2 size={18} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">{file.name}</p>
              <p className="mt-0.5 text-xs text-muted tabular-nums">
                已选 {selectedDesktop?.groups.length ?? 0}/{file.data.desktop.groups.length} 个分组 · {selectedStats?.sites ?? 0}/{totalStats?.sites ?? 0} 张卡片 · {selectedStats?.links ?? 0}/{totalStats?.links ?? 0} 个链接
              </p>
              {file.data.skipped > 0 && <p className="mt-1 text-xs text-muted">已跳过 {file.data.skipped} 个非网页或无效网址</p>}
            </div>
            <button className="icon-btn-sm -mt-1 -mr-1" aria-label="换一个文件" disabled={importBusy} onClick={clearFile}><X size={15} /></button>
          </div>

          <div className="mt-3 overflow-hidden rounded-control border border-line bg-surface-2/40" aria-label="书签解析面板">
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/70 px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-fg select-none">
                <TriCheckbox state={globalState} disabled={importBusy} label="全选所有分组和链接" onChange={handleToggleAll} />
                <span>全选</span>
              </label>

              <div className="relative ml-auto min-w-36 flex-1 sm:max-w-52">
                <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
                <input
                  type="text"
                  value={query}
                  disabled={importBusy}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="筛选分组或链接…"
                  aria-label="筛选分组或链接"
                  className="h-7 w-full rounded-control border border-line bg-surface pr-7 pl-7 text-xs text-fg transition outline-none placeholder:text-faint focus:border-accent/70 focus:ring-2 focus:ring-accent/15 disabled:opacity-50"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="清除筛选"
                    disabled={importBusy}
                    onClick={() => setQuery('')}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {!filtering && (
                <button
                  type="button"
                  disabled={importBusy}
                  onClick={toggleExpandAll}
                  className="shrink-0 rounded-control px-2 py-1 text-xs text-muted transition hover:bg-fg/6 hover:text-fg disabled:opacity-50"
                >
                  {allExpanded ? '全部收起' : '全部展开'}
                </button>
              )}
            </div>

            {visibleGroups.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted">没有找到匹配的分组或链接</p>
            ) : (
              <div className="max-h-72 divide-y divide-line overflow-y-auto">
                {visibleGroups.map(({ group, groupIndex, sites }) => {
                  const groupSel = selection[groupIndex] ?? []
                  const gState = groupCheckState(group, groupSel, rootSet)
                  const gCounts = countGroupSelected(group, groupSel)
                  const groupOpen = filtering || expandedGroups.has(groupIndex)

                  return (
                    <div key={groupIndex}>
                      <div className="flex items-center gap-2 bg-surface/50 px-2.5 py-2">
                        <button
                          type="button"
                          disabled={importBusy || filtering}
                          aria-expanded={groupOpen}
                          aria-label={`${groupOpen ? '收起' : '展开'}分组 ${group.name}`}
                          onClick={() => toggleGroupExpand(groupIndex)}
                          className="grid size-5 shrink-0 place-items-center rounded text-muted transition hover:bg-fg/6 hover:text-fg disabled:opacity-50"
                        >
                          {groupOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <TriCheckbox
                          state={gState}
                          disabled={importBusy}
                          label={`选择分组 ${group.name}`}
                          onChange={() => handleToggleGroup(groupIndex)}
                        />
                        <button
                          type="button"
                          disabled={importBusy || filtering}
                          onClick={() => toggleGroupExpand(groupIndex)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                          <Folder size={14} className="shrink-0 text-accent" />
                          <span className="truncate text-[13px] font-medium text-fg" title={group.name}>{group.name}</span>
                        </button>
                        <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
                          {gCounts.sites}/{group.sites.length} 卡片
                        </span>
                      </div>

                      {groupOpen && (
                        <div className="divide-y divide-line/60 border-t border-line/60 bg-surface/20">
                          {sites.map(({ site, siteIndex, linkIndices }) => {
                            const siteSel = groupSel[siteIndex] ?? { root: false, links: [] }
                            const sState = siteCheckState(site, siteSel, rootSet)
                            const siteKey = `${groupIndex}:${siteIndex}`
                            const hasLinks = linkIndices.length > 0
                            const siteOpen = filtering || expandedSites.has(siteKey)
                            const selectedLinkCount = siteSel.links.filter(Boolean).length
                            const onlyRoot = hasSiteRoot(site, rootSet) && site.links.length > 0 && siteSel.root && selectedLinkCount === 0
                            const host = hostOf(site.origin)

                            return (
                              <div key={siteIndex}>
                                <div className="flex items-center gap-2 py-1.5 pr-3 pl-7 transition hover:bg-fg/[0.03]">
                                  {hasLinks ? (
                                    <button
                                      type="button"
                                      disabled={importBusy || filtering}
                                      aria-expanded={siteOpen}
                                      aria-label={`${siteOpen ? '收起' : '展开'} ${site.title} 的链接`}
                                      onClick={() => toggleSiteExpand(siteKey)}
                                      className="grid size-5 shrink-0 place-items-center rounded text-muted transition hover:bg-fg/6 hover:text-fg disabled:opacity-50"
                                    >
                                      {siteOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                    </button>
                                  ) : (
                                    <span className="w-5 shrink-0" />
                                  )}
                                  <TriCheckbox
                                    state={sState}
                                    disabled={importBusy}
                                    label={`选择 ${site.title}`}
                                    onChange={() => handleToggleSite(groupIndex, siteIndex)}
                                  />
                                  {hasLinks ? (
                                    <button
                                      type="button"
                                      disabled={importBusy || filtering}
                                      onClick={() => toggleSiteExpand(siteKey)}
                                      className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                                    >
                                      <span className="truncate text-[13px] text-fg" title={site.title}>{site.title}</span>
                                      <span className="truncate font-mono text-[11px] text-faint" title={site.origin}>{host}</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={importBusy}
                                      onClick={() => handleToggleSite(groupIndex, siteIndex)}
                                      className="flex min-w-0 flex-1 items-baseline gap-2 text-left disabled:cursor-not-allowed"
                                    >
                                      <span className="truncate text-[13px] text-fg" title={site.title}>{site.title}</span>
                                      <span className="truncate font-mono text-[11px] text-faint" title={site.origin}>{host}</span>
                                    </button>
                                  )}
                                  {onlyRoot && (
                                    <span className="shrink-0 rounded-pill bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                                      仅主链接
                                    </span>
                                  )}
                                  {site.links.length > 0 && (
                                    <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums">
                                      {selectedLinkCount}/{site.links.length}
                                    </span>
                                  )}
                                </div>

                                {hasLinks && siteOpen && (
                                  <div className="border-t border-line/40 bg-surface-2/25 py-0.5">
                                    {linkIndices.map((linkIndex) => {
                                      const link = site.links[linkIndex]
                                      return (
                                        <label
                                          key={linkIndex}
                                          className="flex cursor-pointer items-center gap-2 py-1 pr-3 pl-14 transition hover:bg-fg/[0.03]"
                                        >
                                          <input
                                            type="checkbox"
                                            className="size-3.5 shrink-0 cursor-pointer accent-accent-solid disabled:cursor-not-allowed"
                                            checked={!!siteSel.links[linkIndex]}
                                            disabled={importBusy}
                                            aria-label={`选择链接 ${link.title}`}
                                            onChange={() => handleToggleLink(groupIndex, siteIndex, linkIndex)}
                                          />
                                          <span className="min-w-0 flex-1 truncate text-xs text-fg" title={link.title}>{link.title}</span>
                                          <span className="max-w-[42%] shrink-0 truncate font-mono text-[11px] text-faint" title={fullUrl(site.origin, link.path)}>
                                            {link.path}
                                          </span>
                                        </label>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <p className="mt-2 text-xs text-faint">同一网站合并为一张卡片；如果它出现在多个文件夹，卡片放在首次出现的分组中。</p>
          <div className="mt-4 flex items-center justify-between gap-3">
            {selectedStats?.sites === 0 ? (
              <p className="text-xs text-muted">请至少勾选一个分组或链接</p>
            ) : <span />}
            <button
              className="btn btn-primary"
              disabled={importBusy || desktops.length >= 20 || !selectedStats || selectedStats.sites === 0}
              onClick={runImport}
            >
              {stage === 'importing' && <LoaderCircle size={15} className="animate-spin" />}
              导入为新桌面
            </button>
          </div>
          {desktops.length >= 20 && <p className="mt-2 text-xs text-danger">已达到 20 个桌面的上限，请先删除一个桌面。</p>}
        </>
      )}
      {busy && (
        <div className="mt-3" role="status" aria-live="polite">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>{stage === 'importing' ? '正在保存书签…' : stage === 'parsing' ? `正在解析 ${done} / ${total} 个书签` : '正在读取文件'}</span>
            {total > 0 && <span>{progress}%</span>}
          </div>
          <div
            className="import-progress-track"
            role="progressbar"
            aria-label="Chrome 书签导入进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={total ? progress : undefined}
          >
            <div className={`import-progress-fill ${total ? '' : 'is-indeterminate'}`} style={total ? { width: `${progress}%` } : undefined} />
          </div>
        </div>
      )}
    </section>
  )
}
