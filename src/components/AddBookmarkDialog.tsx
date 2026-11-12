import { LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { AddResult, Desktop } from '../../shared/types'
import { parseBookmarkUrl, parseIconUrl } from '../../shared/url'
import { api } from '../api'
import { Dialog, useAct, useUi } from '../ui'
import { SiteIcon } from './SiteIcon'

const RESULT_MESSAGE: Record<AddResult['result'], (title: string) => string> = {
  site_created: (title) => `已添加「${title}」`,
  site_exists: (title) => `「${title}」已经存在`,
  link_added: (title) => `已添加到现有卡片「${title}」`,
  link_exists: (title) => `「${title}」上已有这个链接`,
}

/** Adds to `desktop`, the one currently shown */
export function AddBookmarkDialog({ open, initialUrl = '', onClose, desktop }: { open: boolean; initialUrl?: string; onClose: () => void; desktop: Desktop }) {
  const groups = desktop.groups
  const act = useAct()
  const { toast } = useUi()
  const [url, setUrl] = useState('')
  const [groupId, setGroupId] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)
  /** null while the optional icon field is folded away */
  const [iconUrl, setIconUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setUrl(initialUrl)
    setIconUrl(null)
  }, [open, initialUrl])

  const parsed = useMemo(() => parseBookmarkUrl(url), [url])
  const existing = useMemo(() => (parsed ? groups.flatMap((g) => g.sites).find((s) => s.origin === parsed.origin) : undefined), [parsed, groups])
  const selectedGroup = groups.find((g) => g.id === groupId)?.id ?? groups[0]?.id
  const customIcon = iconUrl?.trim() ? parseIconUrl(iconUrl) : null
  const iconInvalid = !!iconUrl?.trim() && !customIcon

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!parsed || busy || iconInvalid) return
    setBusy(true)
    const ok = await act(async () => {
      const result = await api.addBookmark(url, desktop.id, selectedGroup)
      toast(RESULT_MESSAGE[result.result](result.siteTitle))
      // A custom icon only applies to a card created just now, never to one that was already there
      if (customIcon && result.result === 'site_created') await api.setIcon(result.siteId, { url: customIcon })
    })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} title="添加书签">
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

        {groups.length > 0 && !existing && (
          <div className="mt-4">
            <span className="label">分组</span>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
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

        {!existing &&
          (iconUrl === null ? (
            <button type="button" className="mt-3 text-xs text-muted underline-offset-2 hover:text-accent hover:underline" onClick={() => setIconUrl('')}>
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
                value={iconUrl}
                onChange={(event) => setIconUrl(event.target.value)}
              />
            </div>
          ))}

        <div className="mt-5 flex items-center justify-end gap-2">
          {busy && <span className="mr-auto text-xs text-muted">正在保存到本地…</span>}
          <button type="button" className="btn btn-soft" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={!parsed || busy || iconInvalid}>
            {busy && <LoaderCircle size={15} className="animate-spin" />}
            添加
          </button>
        </div>
      </form>
    </Dialog>
  )
}
