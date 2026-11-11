import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  danger?: boolean
}

interface Ui {
  toast: (message: string, kind?: 'info' | 'error') => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
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
        await queryClient.invalidateQueries({ queryKey: ['board'] })
      }
    },
    [queryClient, toast],
  )
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: 'info' | 'error' }[]>([])
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)
  const nextId = useRef(0)

  const ui = useMemo<Ui>(
    () => ({
      toast(message, kind = 'info') {
        const id = nextId.current++
        setToasts((list) => [...list, { id, message, kind }])
        setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 5000 : 2600)
      },
      confirm: (options) => new Promise((resolve) => setPending({ ...options, resolve })),
    }),
    [],
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
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
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
  children: ReactNode
}

export function Dialog({ open, onClose, title, width = 'max-w-md', children }: DialogProps) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const token = Symbol()
    openDialogs.push(token)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || openDialogs.at(-1) !== token) return
      event.stopImmediatePropagation()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      openDialogs.splice(openDialogs.indexOf(token), 1)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[12vh] backdrop-blur-xs"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(event) => event.target === event.currentTarget && onClose()}
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
              <button className="icon-btn-sm -mr-1" aria-label="关闭" onClick={onClose}>
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
