import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Globe, LoaderCircle, Network, X } from 'lucide-react'

interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  danger?: boolean
}

export interface BookmarkOpenOptions {
  title: string
  extranetUrl: string
  intranetUrl: string
  openInNewTab: boolean
  defaultIntranet?: boolean
}

interface Ui {
  toast: (message: string, kind?: 'info' | 'error') => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
  openBookmark: (options: BookmarkOpenOptions) => void
}

export function navigateToUrl(url: string, openInNewTab: boolean) {
  if (openInNewTab) {
    window.open(url, '_blank', 'noreferrer')
  } else {
    window.location.assign(url)
  }
}

export async function probeIntranetUrl(url: string, outerSignal?: AbortSignal, timeoutMs = 2500): Promise<boolean> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  outerSignal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(url, {
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', onAbort)
  }
}

const UiContext = createContext<Ui | null>(null)

export function useUi(): Ui {
  const ui = useContext(UiContext)
  if (!ui) throw new Error('useUi must be used inside UiProvider')
  return ui
}

/** Runs a mutation, refreshes the board, and reports failures as a toast */
export function useAct() {
  const queryClient = useQueryClient()
  const { toast } = useUi()
  return useCallback(
    async (action: () => Promise<unknown>, success?: string): Promise<boolean> => {
      try {
        await action()
        if (success) toast(success)
        return true
      } catch (error) {
        toast(error instanceof Error ? error.message : '操作失败', 'error')
        return false
      } finally {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['board'] }),
          queryClient.invalidateQueries({ queryKey: ['board-search'] }),
        ])
      }
    },
    [queryClient, toast],
  )
}

interface ProbeState {
  title: string
  intranetUrl: string
  extranetUrl: string
  status: 'probing' | 'reachable' | 'unreachable'
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: 'info' | 'error' }[]>([])
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)
  const [networkChoice, setNetworkChoice] = useState<BookmarkOpenOptions | null>(null)
  const [probeState, setProbeState] = useState<ProbeState | null>(null)
  const probeCleanupRef = useRef<(() => void) | null>(null)
  const nextId = useRef(0)

  const cancelProbe = useCallback(() => {
    probeCleanupRef.current?.()
    probeCleanupRef.current = null
    setProbeState(null)
  }, [])

  useEffect(() => () => probeCleanupRef.current?.(), [])

  const ui = useMemo<Ui>(
    () => ({
      toast(message, kind = 'info') {
        const id = nextId.current++
        setToasts((list) => [...list, { id, message, kind }])
        setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 5000 : 2600)
      },
      confirm: (options) => new Promise((resolve) => setPending({ ...options, resolve })),
      openBookmark(options) {
        cancelProbe()
        if (options.defaultIntranet === false) {
          setNetworkChoice(options)
          return
        }
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        let cancelled = false
        probeCleanupRef.current = () => {
          cancelled = true
          controller.abort()
          if (timer) clearTimeout(timer)
        }
        setProbeState({
          title: options.title,
          intranetUrl: options.intranetUrl,
          extranetUrl: options.extranetUrl,
          status: 'probing',
        })
        void probeIntranetUrl(options.intranetUrl, controller.signal).then((reachable) => {
          if (cancelled) return
          setProbeState({
            title: options.title,
            intranetUrl: options.intranetUrl,
            extranetUrl: options.extranetUrl,
            status: reachable ? 'reachable' : 'unreachable',
          })
          timer = setTimeout(() => {
            if (cancelled) return
            probeCleanupRef.current = null
            setProbeState(null)
            navigateToUrl(reachable ? options.intranetUrl : options.extranetUrl, options.openInNewTab)
          }, 1000)
        })
      },
    }),
    [cancelProbe],
  )

  const settle = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  return (
    <UiContext.Provider value={ui}>
      {children}
      <Dialog open={!!pending} onClose={() => settle(false)} title={pending?.title ?? ''} width="max-w-sm">
        {pending?.message && <p className="text-sm leading-relaxed text-muted">{pending.message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-soft" onClick={() => settle(false)}>
            取消
          </button>
          <button autoFocus className={`btn ${pending?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => settle(true)}>
            {pending?.confirmText ?? '确定'}
          </button>
        </div>
      </Dialog>
      <Dialog open={!!networkChoice} onClose={() => setNetworkChoice(null)} title={networkChoice ? `选择访问方式 · ${networkChoice.title}` : '选择访问方式'} width="max-w-md">
        {networkChoice && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted">该书签配置了内网地址，请选择要打开的网络链接：</p>
            <button
              type="button"
              autoFocus
              className="flex w-full items-center gap-3 rounded-control border border-line bg-surface-2/70 p-3.5 text-left transition hover:border-accent hover:bg-accent-soft/50"
              onClick={() => {
                const { intranetUrl, openInNewTab } = networkChoice
                setNetworkChoice(null)
                navigateToUrl(intranetUrl, openInNewTab)
              }}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-control bg-accent-soft text-accent">
                <Network size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-fg">内网地址</span>
                <span className="mt-0.5 block truncate font-mono text-xs text-muted">{networkChoice.intranetUrl}</span>
              </span>
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-control border border-line bg-surface-2/70 p-3.5 text-left transition hover:border-accent hover:bg-accent-soft/50"
              onClick={() => {
                const { extranetUrl, openInNewTab } = networkChoice
                setNetworkChoice(null)
                navigateToUrl(extranetUrl, openInNewTab)
              }}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-control bg-surface text-muted">
                <Globe size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-fg">外网地址</span>
                <span className="mt-0.5 block truncate font-mono text-xs text-muted">{networkChoice.extranetUrl}</span>
              </span>
            </button>
            <div className="mt-1 flex justify-end">
              <button type="button" className="btn btn-soft" onClick={() => setNetworkChoice(null)}>
                取消
              </button>
            </div>
          </div>
        )}
      </Dialog>
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {probeState && (
            <motion.div
              key="intranet-probe"
              layout
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              role="status"
              aria-live="polite"
              className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-control border-[length:var(--border-w)] border-line bg-fg px-4 py-2.5 text-sm font-medium text-bg shadow-pop backdrop-blur"
            >
              {probeState.status === 'probing' ? (
                <>
                  <LoaderCircle size={16} className="shrink-0 animate-spin text-accent" />
                  <span>正在探测「{probeState.title}」内网链接是否可达…</span>
                </>
              ) : probeState.status === 'reachable' ? (
                <>
                  <CheckCircle2 size={16} className="shrink-0 text-accent" />
                  <span>内网链接可达，1 秒后自动跳转内网…</span>
                </>
              ) : (
                <>
                  <AlertCircle size={16} className="shrink-0 text-danger" />
                  <span>内网链接不可达，1 秒后自动跳转外网…</span>
                </>
              )}
              <button
                type="button"
                aria-label="取消跳转"
                className="ml-1 rounded px-1.5 py-0.5 text-xs opacity-75 transition hover:opacity-100"
                onClick={cancelProbe}
              >
                取消
              </button>
            </motion.div>
          )}
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              role="status"
              className={`rounded-control border-[length:var(--border-w)] px-4 py-2 text-sm font-medium shadow-pop backdrop-blur ${
                t.kind === 'error' ? 'border-danger/30 bg-danger text-white' : 'border-line bg-fg text-bg'
              }`}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </UiContext.Provider>
  )
}

/** Open/closed state for a menu that closes on an outside click or Escape */
export function usePopover<T extends HTMLElement>() {
  const [open, setOpen] = useState(false)
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return { open, setOpen, ref }
}

// Open dialogs, innermost last, so that Escape only closes the one on top
const openDialogs: symbol[] = []

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  width?: string
  closeDisabled?: boolean
  children: ReactNode
}

export function Dialog({ open, onClose, title, width = 'max-w-md', closeDisabled, children }: DialogProps) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const token = Symbol()
    openDialogs.push(token)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || openDialogs.at(-1) !== token || closeDisabled) return
      event.stopImmediatePropagation()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      openDialogs.splice(openDialogs.indexOf(token), 1)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, closeDisabled])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[12vh] backdrop-blur-xs"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(event) => {
            if (!closeDisabled && event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`popover-panel w-full ${width} p-5`}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold">{title}</h2>
              <button
                className={`icon-btn-sm -mr-1 ${closeDisabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`}
                aria-label="关闭"
                disabled={closeDisabled}
                onClick={onClose}
              >
                <X size={16} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
