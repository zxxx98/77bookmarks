import { useQueryClient } from '@tanstack/react-query'
import { DatabaseBackup, LoaderCircle, Settings } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { MAX_SITE_NAME_LENGTH, type SystemSettings } from '../../shared/settings'
import type { Desktop, DesktopSummary } from '../../shared/types'
import { api } from '../api'
import { Dialog, useUi } from '../ui'
import { BackupSettings } from './BackupSettings'

interface Props {
  open: boolean
  ready: boolean
  loadError: boolean
  onRetry: () => void
  onClose: () => void
  settings: SystemSettings
  desktops: DesktopSummary[]
  desktop: Desktop
  onImported: (desktopId: number) => void
}

export function SettingsDialog({ open, ready, loadError, onRetry, ...props }: Props) {
  return (
    <Dialog open={open} onClose={props.onClose} title="系统设置" width="max-w-lg">
      {ready ? <Content {...props} /> : (
        <div className="grid place-items-center gap-3 py-8 text-sm text-muted" role="status">
          {loadError ? <>
            <p>设置加载失败</p>
            <button className="btn btn-soft" onClick={onRetry}>重试</button>
          </> : <><LoaderCircle className="animate-spin" /><p>正在加载设置…</p></>}
        </div>
      )}
    </Dialog>
  )
}

function Content({ settings, ...backupProps }: Omit<Props, 'open' | 'ready' | 'loadError' | 'onRetry'>) {
  const queryClient = useQueryClient()
  const { toast } = useUi()
  const [tab, setTab] = useState<'general' | 'backup'>('general')
  const [name, setName] = useState(settings.siteName)
  const [openInNewTab, setOpenInNewTab] = useState(settings.openInNewTab)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (saving || !name.trim()) return
    setSaving(true)
    setError('')
    try {
      const settings = await api.updateSettings({ siteName: name.trim(), openInNewTab })
      queryClient.setQueryData<SystemSettings>(['settings'], settings)
      setName(settings.siteName)
      setOpenInNewTab(settings.openInNewTab)
      toast('设置已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div role="tablist" aria-label="设置分类" className="mb-5 flex gap-1 rounded-control border border-line bg-surface-2 p-1">
        {([
          { id: 'general', label: '基本设置', icon: Settings },
          { id: 'backup', label: '备份与恢复', icon: DatabaseBackup },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`settings-panel-${id}`}
            className={`flex flex-1 items-center justify-center gap-2 rounded-control px-3 py-2 text-sm font-medium transition ${tab === id ? 'bg-surface text-fg shadow-xs' : 'text-muted hover:text-fg'}`}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="settings-panel-general" aria-labelledby="settings-tab-general" hidden={tab !== 'general'}>
        <form onSubmit={save}>
          <label className="label" htmlFor="site-name">网站名称</label>
          <input
            id="site-name"
            className="input"
            value={name}
            disabled={saving}
            onChange={(event) => {
              setName(event.target.value)
              setError('')
            }}
            maxLength={MAX_SITE_NAME_LENGTH}
            placeholder="输入网站名称"
            required
            aria-describedby="site-name-hint"
          />
          <p id="site-name-hint" className="mt-2 text-xs text-faint">显示在顶栏、登录页和浏览器标题中，最多 {MAX_SITE_NAME_LENGTH} 个字符。</p>
          <label className="mt-5 flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-accent-solid"
              checked={openInNewTab}
              disabled={saving}
              onChange={(event) => {
                setOpenInNewTab(event.target.checked)
                setError('')
              }}
              aria-describedby="open-in-new-tab-hint"
            />
            在新标签页打开
          </label>
          <p id="open-in-new-tab-hint" className="mt-1.5 text-xs text-faint">适用于书签、子链接和搜索结果，取消勾选后在当前标签页打开。</p>
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
          <div className="mt-5 flex justify-end">
            <button className="btn btn-primary" disabled={saving || !name.trim() || (name.trim() === settings.siteName && openInNewTab === settings.openInNewTab)}>
              {saving && <LoaderCircle size={15} className="animate-spin" />}
              保存设置
            </button>
          </div>
        </form>
      </div>
      <div role="tabpanel" id="settings-panel-backup" aria-labelledby="settings-tab-backup" hidden={tab !== 'backup'}>
        <BackupSettings {...backupProps} />
      </div>
    </>
  )
}
