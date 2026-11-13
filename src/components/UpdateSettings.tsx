import { ArrowUpCircle, CheckCircle2, Copy, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '../../shared/types'
import type { Platform } from '../platform'
import { useUi } from '../ui'
import { formatAgo, formatDate } from '../usage'

const COMPOSE_COMMAND = 'docker compose pull && docker compose up -d'
const DOCKER_IMAGE_COMMAND = 'docker pull ghcr.io/zxxx98/77bookmarks:latest'

/** Self-hosted version check, release notes, in-place update, and Docker update commands */
export function UpdateSettings({ update, onBusyChange }: { update: NonNullable<Platform['update']>; onBusyChange: (busy: boolean) => void }) {
  const { toast, confirm } = useUi()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      onBusyChange(false)
    }
  }, [onBusyChange])

  useEffect(() => {
    onBusyChange(applying || restarting)
  }, [applying, restarting, onBusyChange])

  const checkNow = async (silent = false) => {
    setChecking(true)
    setFailed(false)
    try {
      const next = await update.check()
      if (!mounted.current) return
      setStatus(next)
      if (!silent) {
        if (next.error) toast(next.error, 'error')
        else if (next.hasUpdate && next.latestVersion) toast(`发现新版本 v${next.latestVersion}`)
        else toast('当前已是最新版本')
      }
    } catch (error) {
      if (!mounted.current) return
      toast(error instanceof Error ? error.message : '检查更新失败', 'error')
    } finally {
      if (mounted.current) setChecking(false)
    }
  }

  const load = () => {
    setFailed(false)
    update.status().then((initial) => {
      if (!mounted.current) return
      setStatus(initial)
      if (initial.checkedAt === null) void checkNow(true)
    }, () => {
      if (mounted.current) setFailed(true)
    })
  }

  useEffect(load, [update])

  const copyCommand = async (command: string, label: string) => {
    try {
      await navigator.clipboard.writeText(command)
      toast(`${label}已复制`)
    } catch {
      toast('无法自动复制，请手动选择复制', 'error')
    }
  }

  const waitForRestart = async () => {
    setRestarting(true)
    // Give the container a moment to begin shutting down before polling health
    await new Promise((resolve) => setTimeout(resolve, 3000))
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!mounted.current) return
      try {
        const response = await fetch('/api/health', { cache: 'no-store' })
        if (response.ok) {
          window.location.reload()
          return
        }
      } catch {
        // Server is restarting
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    if (mounted.current) {
      setRestarting(false)
      toast('更新请求已发送，但等待服务恢复超时，请稍后手动刷新页面', 'error')
    }
  }

  const triggerUpdate = async () => {
    const ok = await confirm({
      title: '确认立即更新？',
      message: '将从 GitHub Release 下载最新自部署包并自动重启服务，期间页面会短暂断开。',
      confirmText: '立即更新',
    })
    if (!ok) return
    setApplying(true)
    try {
      const result = await update.apply()
      if (!mounted.current) return
      toast(result.message)
      void waitForRestart()
    } catch (error) {
      if (mounted.current) toast(error instanceof Error ? error.message : '触发更新失败', 'error')
    } finally {
      if (mounted.current) setApplying(false)
    }
  }

  const now = Date.now()
  const busy = checking || applying || restarting

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-control border border-line bg-surface-2 p-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          {status?.hasUpdate ? (
            <ArrowUpCircle size={17} className="shrink-0 text-accent" />
          ) : (
            <CheckCircle2 size={17} className="shrink-0 text-muted" />
          )}
          <div className="min-w-0 flex-1">
            {failed ? (
              <p role="status">版本状态加载失败</p>
            ) : !status ? (
              <p role="status">正在加载…</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">当前版本 v{status.currentVersion}</span>
                  {status.hasUpdate && status.latestVersion && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                      有新版本 v{status.latestVersion}
                    </span>
                  )}
                  {!status.hasUpdate && status.latestVersion && !status.error && (
                    <span className="text-xs text-faint">已是最新版本</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-faint">
                  {status.checkedAt ? `上次检查于${formatAgo(status.checkedAt, now)}` : '尚未检查更新'}
                  {status.publishedAt && status.hasUpdate ? ` · 新版本发布于 ${formatDate(Date.parse(status.publishedAt))}` : ''}
                </p>
              </>
            )}
          </div>
          {failed ? (
            <button type="button" className="btn btn-soft h-8" onClick={load}>重试</button>
          ) : (
            <button type="button" className="btn btn-soft h-8" disabled={busy || !status} onClick={() => void checkNow(false)}>
              {checking ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {checking ? '检查中…' : '检查更新'}
            </button>
          )}
        </div>

        {status?.error && (
          <p role="alert" className="mt-2.5 text-xs text-danger">{status.error}</p>
        )}

        {restarting && (
          <div role="status" className="mt-3 flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-xs text-muted">
            <LoaderCircle size={14} className="animate-spin shrink-0" />
            <span>正在等待服务重启并恢复连接…</span>
          </div>
        )}
      </div>

      {status?.hasUpdate && (
        <div className="rounded-control border border-accent/30 bg-surface-2 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">v{status.latestVersion} 更新内容</p>
            <div className="flex items-center gap-2">
              {status.releaseUrl && (
                <a
                  href={status.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  查看 Release
                  <ExternalLink size={12} />
                </a>
              )}
              {status.canTriggerUpdate && (
                <button type="button" className="btn btn-primary h-8" disabled={busy} onClick={() => void triggerUpdate()}>
                  {applying && <LoaderCircle size={14} className="animate-spin" />}
                  立即更新
                </button>
              )}
            </div>
          </div>
          {status.releaseNotes && (
            <pre className="mt-2.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-control border border-line bg-surface p-2.5 font-sans text-xs leading-relaxed text-muted">
              {status.releaseNotes}
            </pre>
          )}
        </div>
      )}

      <div className="rounded-control border border-line bg-surface-2 p-3.5">
        <p className="font-medium">Docker 更新方式</p>
        <p className="mt-1 text-xs leading-relaxed text-faint">
          在宿主机项目目录执行以下命令即可升级到最新版本（数据保存在持久化卷中不会丢失）：
        </p>
        <div className="mt-2.5 space-y-2">
          <CommandRow label="Compose 更新命令" command={COMPOSE_COMMAND} onCopy={() => void copyCommand(COMPOSE_COMMAND, '更新命令')} />
          <CommandRow label="镜像拉取命令" command={DOCKER_IMAGE_COMMAND} onCopy={() => void copyCommand(DOCKER_IMAGE_COMMAND, '拉取命令')} />
        </div>
        {status?.hasUpdate && !status.canTriggerUpdate && (
          <p className="mt-2.5 text-xs leading-relaxed text-faint">
            提示：当前版本未检测到可用的在线更新包（或非打包环境运行），请使用上方 Docker 命令升级。
          </p>
        )}
      </div>
    </div>
  )
}

function CommandRow({ label, command, onCopy }: { label: string; command: string; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-control border border-line bg-surface px-2.5 py-1.5 font-mono text-xs text-fg" aria-label={label}>
        {command}
      </code>
      <button type="button" className="btn btn-soft h-8 shrink-0" onClick={onCopy}>
        <Copy size={13} />
        复制
      </button>
    </div>
  )
}
