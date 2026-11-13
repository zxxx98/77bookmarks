import { LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MAX_SITE_DESCRIPTION_LENGTH, type AddResult, type Desktop } from '../../shared/types'
import { fallbackLinkTitle, fullUrl, parseBookmarkUrl, parseIconUrl, parseIntranetUrl } from '../../shared/url'
import { api } from '../api'
import { requestPageTitle, type PageTitleResult } from '../page-title'
import { Dialog, useAct, useUi } from '../ui'
import { privateSpace } from '../private/session'
import { SiteIcon } from './SiteIcon'

const RESULT_MESSAGE: Record<AddResult['result'], (title: string) => string> = {
  site_created: (title) => `已添加「${title}」`,
  site_exists: (title) => `「${title}」已经存在`,
  link_added: (title) => `已添加到现有卡片「${title}」`,
  link_exists: (title) => `「${title}」上已有这个链接`,
}

interface LinkTitleDraft {
  url: string
  name: string
  edited: boolean
  status: PageTitleResult['status'] | 'loading'
}

interface SiteTitleDraft {
  origin: string
  name: string
  edited: boolean
}

/** Adds to `desktop`, the one currently shown */
export function AddBookmarkDialog({ open, initialUrl = '', onClose, desktop }: { open: boolean; initialUrl?: string; onClose: () => void; desktop: Desktop }) {
  const groups = desktop.groups
  const act = useAct()
  const { toast } = useUi()
  const [url, setUrl] = useState('')
  const [groupId, setGroupId] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)
  const [siteTitleDraft, setSiteTitleDraft] = useState<SiteTitleDraft | null>(null)
  const [titleDraft, setTitleDraft] = useState<LinkTitleDraft | null>(null)
  const [description, setDescription] = useState('')
  const [intranetUrl, setIntranetUrl] = useState('')
  const titleRequest = useRef(0)
  /** null while the optional icon field is folded away */
  const [iconUrl, setIconUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setUrl(initialUrl)
    setSiteTitleDraft(null)
    setDescription('')
    setIntranetUrl('')
    setIconUrl(null)
  }, [open, initialUrl])

  const parsed = useMemo(() => parseBookmarkUrl(url), [url])
  const existing = useMemo(() => (parsed ? groups.flatMap((g) => g.sites).find((s) => s.origin === parsed.origin) : undefined), [parsed, groups])
  const defaultSiteTitle = parsed ? parsed.host.slice(0, 80) : ''
  const siteTitle = siteTitleDraft && (siteTitleDraft.origin === (parsed?.origin ?? '') || siteTitleDraft.edited) ? siteTitleDraft.name : defaultSiteTitle
  const titleUrl = parsed?.path && !existing?.links.some((link) => link.path === parsed.path) ? fullUrl(parsed.origin, parsed.path) : null
  const defaultTitle = parsed?.path ? fallbackLinkTitle(parsed.path).slice(0, 80) : ''
  const currentTitle = titleDraft?.url === titleUrl ? titleDraft : null
  const linkTitle = currentTitle?.name ?? defaultTitle
  const selectedGroup = groups.find((g) => g.id === groupId)?.id ?? groups[0]?.id
  const customIcon = iconUrl?.trim() ? parseIconUrl(iconUrl) : null
  const iconInvalid = !!iconUrl?.trim() && !customIcon
  const parsedIntranet = intranetUrl.trim() ? parseIntranetUrl(intranetUrl) : null
  const intranetInvalid = !!intranetUrl.trim() && !parsedIntranet

  const readTitle = useCallback(async (target: string, requestPermission: boolean, version: number) => {
    if (titleRequest.current !== version) return
    setTitleDraft((draft) => draft?.url === target ? { ...draft, status: 'loading' } : draft)
    const result = await requestPageTitle(target, { requestPermission })
    if (titleRequest.current !== version) return
    setTitleDraft((draft) => draft?.url === target ? {
      ...draft,
      status: result.status,
      name: !draft.edited && result.status === 'success' ? result.title : draft.name,
    } : draft)
  }, [])

  useEffect(() => {
    const version = ++titleRequest.current
    if (!open || !titleUrl) { setTitleDraft(null); return }
    const path = parseBookmarkUrl(titleUrl)!.path!
    setTitleDraft({ url: titleUrl, name: fallbackLinkTitle(path).slice(0, 80), edited: false, status: 'loading' })
    const timer = setTimeout(() => { void readTitle(titleUrl, false, version) }, 400)
    return () => {
      clearTimeout(timer)
      // Ignore late responses after changing URL, closing the dialog or reopening it.
      titleRequest.current++
    }
  }, [open, titleUrl, readTitle])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!parsed || busy || iconInvalid || intranetInvalid) return
    titleRequest.current++
    setBusy(true)
    const ok = await act(async () => {
      const resolvedSiteTitle = siteTitle.trim() || defaultSiteTitle
      const title = titleUrl ? linkTitle.trim() || defaultTitle : resolvedSiteTitle
      const result = await api.addBookmark(url, desktop.id, selectedGroup, title, {
        siteTitle: resolvedSiteTitle,
        description: description.trim() || undefined,
        intranetUrl: parsedIntranet ?? undefined,
      })
      toast(RESULT_MESSAGE[result.result](result.siteTitle))
      // A custom icon only applies to a card created just now, never to one that was already there
      if (customIcon && result.result === 'site_created') await api.setIcon(result.siteId, { url: customIcon })
    })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} closeDisabled={busy} title="添加书签">
      <form onSubmit={submit}>
        <label className="label" htmlFor="bookmark-url">
          网址
        </label>
        <input
          id="bookmark-url"
          className="input"
          placeholder="粘贴链接，例如 github.com/anthropics/claude-code"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />

        <div className="mt-3 min-h-[4.5rem] rounded-control border-[length:var(--border-w)] border-line bg-surface-2/60 p-3 text-sm">
          {!url.trim() ? (
            <p className="text-faint">网址会自动拆分：域名成为一张卡片，子路径成为卡片上的链接。</p>
          ) : !parsed ? (
            <p className="text-danger">这不是一个有效的网址</p>
          ) : (
            <>
              <p className="font-mono text-[13px] break-all">
                <span className="rounded-pill bg-accent-soft px-1.5 py-0.5 font-medium text-accent">{parsed.host}</span>
                {parsed.path && <span className="text-muted">{parsed.path}</span>}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                {existing ? (
                  <>
                    <SiteIcon site={existing} size={16} />
                    {parsed.path ? `将添加到现有卡片「${existing.title}」` : `卡片「${existing.title}」已存在`}
                  </>
                ) : parsed.path ? (
                  '将新建卡片，并添加这个子链接'
                ) : (
                  '将新建卡片'
                )}
              </p>
            </>
          )}
        </div>

        {!existing && (
          <div className="mt-4">
            <label className="label" htmlFor="bookmark-site-title">主链接名称</label>
            <input
              id="bookmark-site-title"
              className="input"
              maxLength={80}
              placeholder={defaultSiteTitle || '留空则默认使用域名'}
              value={siteTitle}
              disabled={busy}
              onChange={(event) => setSiteTitleDraft({ origin: parsed?.origin ?? '', name: event.target.value, edited: true })}
            />
          </div>
        )}

        {titleUrl && (
          <div className="mt-4">
            <label className="label" htmlFor="bookmark-link-title">子链接名称</label>
            <input
              id="bookmark-link-title"
              className="input"
              maxLength={80}
              placeholder={defaultTitle}
              value={linkTitle}
              disabled={busy}
              onChange={(event) => setTitleDraft({ url: titleUrl, name: event.target.value, edited: true, status: currentTitle?.status ?? 'loading' })}
            />
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
              <p role="status" className="flex items-center gap-1.5">
                {currentTitle?.status === 'loading' ? (
                  <><LoaderCircle size={13} className="shrink-0 animate-spin" />正在读取网页标题，可直接修改名称并添加。</>
                ) : currentTitle?.status === 'permission' ? (
                  '可直接修改名称，或授权读取网页标题。'
                ) : currentTitle?.status === 'success' ? (
                  currentTitle.edited ? '已读取网页标题，保留你填写的名称。' : '已读取网页标题，名称可修改。'
                ) : (
                  currentTitle?.edited ? '未能读取网页标题，使用你填写的名称。' : '未能读取网页标题，已使用路径末段，名称可修改。'
                )}
              </p>
              {currentTitle?.status === 'permission' && (
                <button type="button" className="btn btn-soft shrink-0" disabled={busy} onClick={() => { void readTitle(titleUrl, true, ++titleRequest.current) }}>
                  读取网页标题
                </button>
              )}
            </div>
          </div>
        )}

        {!existing && (
          <>
            <div className="mt-4">
              <label className="label" htmlFor="bookmark-intranet-url">内网地址（可选）</label>
              <input
                id="bookmark-intranet-url"
                className={`input ${intranetInvalid ? '!border-danger/60' : ''}`}
                maxLength={2000}
                placeholder="例如 http://192.168.1.100:8080"
                autoComplete="off"
                spellCheck={false}
                value={intranetUrl}
                disabled={busy}
                onChange={(event) => setIntranetUrl(event.target.value)}
              />
              {intranetInvalid && <p className="mt-1.5 text-xs text-danger">请输入有效的内网 HTTP(S) 地址</p>}
            </div>

            <div className="mt-4">
              <label className="label" htmlFor="bookmark-description">描述（可选）</label>
              <input
                id="bookmark-description"
                className="input"
                maxLength={MAX_SITE_DESCRIPTION_LENGTH}
                placeholder="添加简短描述"
                value={description}
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </>
        )}

        {groups.length > 0 && !existing && (
          <div className="mt-4">
            <span className="label">分组</span>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={group.id === selectedGroup}
                  className={`rounded-pill border-[length:var(--border-w)] px-3 py-1 text-sm transition ${
                    group.id === selectedGroup ? 'border-accent/60 bg-accent-soft font-medium text-accent' : 'border-line text-muted hover:text-fg'
                  }`}
                  onClick={() => setGroupId(group.id)}
                >
                  {group.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {!existing && !privateSpace.active() &&
          (iconUrl === null ? (
            <button type="button" disabled={busy} className="mt-3 text-xs text-muted underline-offset-2 hover:text-accent hover:underline" onClick={() => setIconUrl('')}>
              使用自定义图标地址
            </button>
          ) : (
            <div className="mt-4">
              <label className="label" htmlFor="bookmark-icon-url">
                图标地址（可选）
              </label>
              <input
                id="bookmark-icon-url"
                className={`input ${iconInvalid ? '!border-danger/60' : ''}`}
                placeholder="https://example.com/icon.png，留空则自动获取"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                maxLength={2000}
                disabled={busy}
                value={iconUrl}
                onChange={(event) => setIconUrl(event.target.value)}
              />
            </div>
          ))}

        <div className="mt-5 flex items-center justify-end gap-2">
          {busy && <span role="status" className="mr-auto text-xs text-muted">正在保存到本地…</span>}
          <button type="button" className="btn btn-soft" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={!parsed || busy || iconInvalid || intranetInvalid}>
            {busy && <LoaderCircle size={15} className="animate-spin" />}
            添加
          </button>
        </div>
      </form>
    </Dialog>
  )
}
