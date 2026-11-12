import { LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { platform } from '../platform'
import { onDataChanged } from '../storage/client'
import type { SyncConfig, SyncKind, SyncStatus } from '../sync/types'
import { useAct, useUi } from '../ui'

interface Props {
  onBusyChange: (busy: boolean) => void
  importBusy: boolean
}

const KINDS: { value: SyncKind; label: string; placeholder: string }[] = [
  { value: 'worker', label: 'Cloudflare Worker', placeholder: 'https://77bookmarks-sync.你的账号.workers.dev' },
  { value: 'webdav', label: 'WebDAV', placeholder: 'https://dav.jianguoyun.com/dav/77bookmarks' },
]

const message = (error: unknown) => (error instanceof Error ? error.message : '操作失败，请重试')

function when(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString() : '从未同步'
}

/** Shows a summary of what the last sync did, in the order the merge reports it */
function summary(status: SyncStatus) {
  if (status.state.lastError) return '同步失败'
  if (!status.synced) return '尚未同步'
  if (status.dirty) return '有本地改动待上传'
  return '已同步'
}

export function SyncSettings({ onBusyChange, importBusy }: Props) {
  const act = useAct()
  const { toast } = useUi()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [form, setForm] = useState<SyncConfig | null>(null)
  const [busy, setBusy] = useState<'save' | 'test' | 'now' | null>(null)
  const [error, setError] = useState('')
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'missing' | 'unavailable'>('unknown')

  const refresh = async () => {
    try {
      setStatus(await api.syncStatus())
    } catch (err) {
      setError(message(err))
    }
  }

  useEffect(() => {
    let alive = true
    void api.syncStatus().then(
      (value) => {
        if (!alive) return
        setStatus(value)
        setForm((current) => current ?? value.config)
      },
      (err) => { if (alive) setError(message(err)) },
    )
    return () => { alive = false }
  }, [])

  // A sync may also run in the background worker, so the panel follows the data events
  useEffect(() => onDataChanged(() => { void refresh() }), [])

  const origin = (() => {
    try {
      const url = new URL(form?.endpoint ?? '')
      return url.protocol === 'http:' || url.protocol === 'https:' ? `${url.origin}/*` : null
    } catch {
      return null
    }
  })()
  const originLabel = origin?.replace(/\/\*$/, '') ?? ''

  useEffect(() => {
    // The self-hosted server makes the requests itself, so there is nothing to grant
    const access = platform.hostAccess
    if (!access) { setPermission(platform.kind === 'extension' ? 'unavailable' : 'unknown'); return }
    if (form?.kind !== 'webdav' || !origin) { setPermission('unknown'); return }
    let alive = true
    void access.contains(origin).then(
      (granted) => { if (alive) setPermission(granted ? 'granted' : 'missing') },
      () => { if (alive) setPermission('unknown') },
    )
    return () => { alive = false }
  }, [form?.kind, origin])

  const patch = (value: Partial<SyncConfig>) => setForm((current) => current && { ...current, ...value })

  const runSync = async () => {
    setBusy('now')
    setError('')
    onBusyChange(true)
    try {
      const outcome = await api.syncNow()
      const stats = outcome.stats
      const changed = stats ? stats.added + stats.updated + stats.deleted : 0
      toast(outcome.status === 'unchanged' ? '没有需要同步的改动' : changed ? `已同步，合并了 ${changed} 条记录` : '已是最新')
      await refresh()
    } catch (err) {
      setError(message(err))
      toast(message(err), 'error')
    } finally {
      onBusyChange(false)
      setBusy(null)
    }
  }

  const save = async () => {
    if (!form) return
    setBusy('save')
    setError('')
    onBusyChange(true)
    const saved = await act(async () => {
      const value = await api.updateSyncConfig(form)
      setForm(value)
      await refresh()
      return value
    })
    onBusyChange(false)
    setBusy(null)
    if (!saved) return
    toast('同步设置已保存')
    // Turning it on should show a result right away instead of waiting for the timer
    if (form.enabled) await runSync()
  }

  const test = async () => {
    if (!form) return
    setBusy('test')
    onBusyChange(true)
    setError('')
    const ok = await act(async () => { await api.testSync(form) }, '连接成功')
    if (!ok) setError('连接失败，请检查地址与凭据')
    onBusyChange(false)
    setBusy(null)
  }

  const requestPermission = async () => {
    const access = platform.hostAccess
    if (!origin || !access) return
    const granted = await access.request(origin).catch(() => false)
    setPermission(granted ? 'granted' : 'missing')
  }

  if (!form || !status) {
    return (
      <div className="grid place-items-center gap-3 py-8 text-sm text-muted" role="status">
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : <><LoaderCircle className="animate-spin" /><p>正在读取同步设置…</p></>}
      </div>
    )
  }

  const kind = KINDS.find((item) => item.value === form.kind) ?? KINDS[0]
  const disabled = busy !== null || importBusy
  const visibleError = error || status.state.lastError

  return (
    <div className="flex flex-col gap-4">
      <section className="flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-accent-solid"
            checked={form.enabled}
            disabled={disabled}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
          启用云同步
        </label>
        <a
          href="https://github.com/zxxx98/77bookmarks#云同步可选"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-xs text-muted underline underline-offset-4 hover:text-fg"
        >
          配置说明 ↗
        </a>
      </section>

      <section>
        <p className="label">同步方式</p>
        <div role="radiogroup" aria-label="同步方式" className="mt-2 grid grid-cols-2 gap-2">
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={form.kind === option.value}
              disabled={disabled}
              className={`rounded-control border-[length:var(--border-w)] px-3 py-2 text-center transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                form.kind === option.value ? 'border-accent/60 bg-accent-soft' : 'border-line hover:bg-fg/4'
              }`}
              onClick={() => patch({ kind: option.value })}
            >
              <span className={`block text-sm font-medium ${form.kind === option.value ? 'text-accent' : ''}`}>{option.label}</span>
            </button>
          ))}
        </div>

        <label className="label mt-4" htmlFor="sync-endpoint">{form.kind === 'worker' ? 'Worker 地址' : 'WebDAV 地址'}</label>
        <input
          id="sync-endpoint"
          className="input"
          type="url"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder={kind.placeholder}
          value={form.endpoint}
          disabled={disabled}
          onChange={(event) => { patch({ endpoint: event.target.value }); setError('') }}
        />
        {form.kind === 'worker' ? (
          <>
            <label className="label mt-4" htmlFor="sync-token">同步令牌</label>
            <input
              id="sync-token"
              className="input font-mono"
              type="password"
              autoComplete="off"
              placeholder="输入同步令牌"
              value={form.token}
              disabled={disabled}
              onChange={(event) => { patch({ token: event.target.value }); setError('') }}
            />
          </>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="sync-username">账号</label>
                <input id="sync-username" className="input" autoComplete="off" value={form.username} disabled={disabled} onChange={(event) => { patch({ username: event.target.value }); setError('') }} />
              </div>
              <div>
                <label className="label" htmlFor="sync-password">密码 / 应用密码</label>
                <input id="sync-password" className="input" type="password" autoComplete="off" value={form.password} disabled={disabled} onChange={(event) => { patch({ password: event.target.value }); setError('') }} />
              </div>
            </div>
            {permission === 'missing' && origin && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <p className="min-w-0 break-all text-muted">允许访问 {originLabel}</p>
                <button type="button" className="btn btn-soft" disabled={disabled} onClick={requestPermission}>授权访问</button>
              </div>
            )}
            {permission === 'unavailable' && <p className="mt-2 text-xs text-faint">请在扩展中连接 WebDAV。</p>}
          </>
        )}
      </section>

      <section className="border-t border-line pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={disabled} onClick={save}>
            {busy === 'save' && <LoaderCircle size={15} className="animate-spin" />}
            保存
          </button>
          <button className="btn btn-soft" disabled={disabled || !form.endpoint} onClick={test}>
            {busy === 'test' ? <LoaderCircle size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
            测试连接
          </button>
          <button className="btn btn-soft" disabled={disabled || !status.config.enabled} onClick={runSync}>
            {busy === 'now' ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            立即同步
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted" role="status">
          <span className="flex items-center gap-1.5">
            {visibleError ? <TriangleAlert size={14} className="text-danger" /> : <ShieldCheck size={14} className="text-accent" />}
            {summary(status)}
          </span>
          {status.state.lastSyncAt && <span>上次同步：{when(status.state.lastSyncAt)}</span>}
        </div>
        {visibleError && <p role="alert" className="mt-2 text-xs text-danger">{visibleError}</p>}
      </section>
    </div>
  )
}
