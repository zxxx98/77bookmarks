import { ImageUp, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Desktop, Site } from '../../shared/types'
import { hostOf, parseIconUrl } from '../../shared/url'
import { api } from '../api'
import { Dialog, useAct, useUi } from '../ui'
import { SiteIcon } from './SiteIcon'

const MAX_ICON_BYTES = 100 * 1024

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/** Whether the browser can show an image from this address */
function canLoadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image()
    image.referrerPolicy = 'no-referrer'
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = url
  })
}

interface Props {
  /** The card being edited, which is on `desktop` */
  site: Site | null
  desktop: Desktop
  desktops: Desktop[]
  onClose: () => void
}

export function EditSiteDialog({ site, desktop, desktops, onClose }: Props) {
  return (
    <Dialog open={!!site} onClose={onClose} title="编辑卡片">
      {site && <Editor key={site.id} site={site} desktop={desktop} desktops={desktops} />}
    </Dialog>
  )
}

const pill = (selected: boolean) =>
  `max-w-full truncate rounded-full border px-3 py-1 text-sm transition ${
    selected ? 'border-accent/50 bg-accent-soft font-medium text-accent' : 'border-line text-muted hover:text-fg'
  }`

function Editor({ site, desktop, desktops }: { site: Site; desktop: Desktop; desktops: Desktop[] }) {
  const groups = desktop.groups
  const act = useAct()
  const { toast } = useUi()
  const fileInput = useRef<HTMLInputElement>(null)
  const [iconBusy, setIconBusy] = useState(false)
  const [iconUrl, setIconUrl] = useState(site.iconUrl ?? '')
  const groupId = groups.find((g) => g.sites.some((s) => s.id === site.id))?.id

  const changeIcon = async (action: () => Promise<unknown>, success: string) => {
    setIconBusy(true)
    await act(action, success)
    setIconBusy(false)
  }

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_ICON_BYTES) return toast('图片不能超过 100 KB', 'error')
    const dataUrl = await readAsDataUrl(file)
    await changeIcon(() => api.setIcon(site.id, { dataUrl }), '图标已更新')
  }

  const useIconUrl = async (event: FormEvent) => {
    event.preventDefault()
    const url = parseIconUrl(iconUrl)
    if (!url) return toast('无效的图片地址', 'error')
    setIconBusy(true)
    // Checked here rather than on the server: the browser is what will load it, and it may reach addresses the server can't
    if (await canLoadImage(url)) {
      if (await act(() => api.setIcon(site.id, { url }), '图标已更新')) setIconUrl(url)
    } else {
      toast('无法加载这个地址的图片', 'error')
    }
    setIconBusy(false)
  }

  const saveTitle = (value: string) => {
    const title = value.trim()
    if (title && title !== site.title) void act(() => api.updateSite(site.id, { title }))
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="relative">
          <SiteIcon site={site} size={52} />
          {iconBusy && (
            <span className="absolute inset-0 grid place-items-center rounded-[14px] bg-surface/70">
              <LoaderCircle size={18} className="animate-spin text-accent" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted">{hostOf(site.origin)}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <button className="btn btn-soft h-7 px-2 text-xs" disabled={iconBusy} onClick={() => changeIcon(() => api.setIcon(site.id), '图标已更新')}>
              <RefreshCw size={12} />
              重新获取
            </button>
            <button className="btn btn-soft h-7 px-2 text-xs" disabled={iconBusy} onClick={() => fileInput.current?.click()}>
              <ImageUp size={12} />
              上传
            </button>
            {(site.iconVersion > 0 || site.iconUrl) && (
              <button
                className="btn btn-soft h-7 px-2 text-xs"
                disabled={iconBusy}
                onClick={() => changeIcon(() => api.removeIcon(site.id), '已改用字母图标').then(() => setIconUrl(''))}
              >
                移除
              </button>
            )}
          </div>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={upload} />
        </div>
      </div>

      <form className="-mt-2" onSubmit={useIconUrl}>
        <label className="label" htmlFor="site-icon-url">
          图标地址
        </label>
        <div className="flex gap-2">
          <input
            id="site-icon-url"
            className="input h-9"
            placeholder="https://example.com/icon.png"
            autoComplete="off"
            spellCheck={false}
            maxLength={2000}
            value={iconUrl}
            onChange={(event) => setIconUrl(event.target.value)}
          />
          <button className="btn btn-soft" disabled={!iconUrl.trim() || iconBusy || parseIconUrl(iconUrl) === site.iconUrl}>
            使用
          </button>
        </div>
        <p className="mt-1.5 text-xs text-faint">
          {site.iconUrl ? '正在使用这个地址的图片。重新获取或上传会替换它。' : '填写图片的网络地址，图片由浏览器直接从该地址加载。'}
        </p>
      </form>

      <div>
        <label className="label" htmlFor="site-title">
          标题
        </label>
        <input
          id="site-title"
          className="input"
          defaultValue={site.title}
          maxLength={80}
          onBlur={(event) => saveTitle(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
      </div>

      {groups.length > 1 && (
        <div>
          <span className="label">分组</span>
          <div className="flex flex-wrap gap-1.5">
            {groups.map((group) => (
              <button
                key={group.id}
                aria-pressed={group.id === groupId}
                className={pill(group.id === groupId)}
                onClick={() => group.id !== groupId && void act(() => api.updateSite(site.id, { groupId: group.id }))}
              >
                {group.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {desktops.length > 1 && (
        <div>
          <span className="label">桌面</span>
          <div className="flex flex-wrap gap-1.5">
            {desktops.map((item) => (
              <button
                key={item.id}
                aria-pressed={item.id === desktop.id}
                className={pill(item.id === desktop.id)}
                // The card leaves this desktop, which closes the dialog
                onClick={() => item.id !== desktop.id && void act(() => api.updateSite(site.id, { desktopId: item.id }), `已移到桌面「${item.name}」`)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {site.links.length > 0 && (
        <div>
          <span className="label">子链接</span>
          <ul className="-mr-1 flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
            {site.links.map((link) => (
              <li key={link.id} className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <input
                    aria-label="链接标题"
                    className="input h-9"
                    defaultValue={link.title}
                    maxLength={80}
                    onBlur={(event) => {
                      const title = event.target.value.trim()
                      if (title && title !== link.title) void act(() => api.renameLink(link.id, title))
                    }}
                    onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                  />
                  <p className="mt-0.5 truncate px-1 font-mono text-[11px] text-faint">{link.path}</p>
                </div>
                <button
                  className="icon-btn-sm mb-4 hover:!bg-danger/10 hover:!text-danger"
                  aria-label={`删除链接 ${link.title}`}
                  onClick={() => void act(() => api.deleteLink(link.id))}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="-mt-2 text-xs text-faint">修改会自动保存。</p>
    </div>
  )
}
