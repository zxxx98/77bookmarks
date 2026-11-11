import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkPlus, LoaderCircle, SearchX } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { VIEWS, type Board, type View } from '../shared/types'
import { api, ApiError } from './api'
import { AddBookmarkDialog } from './components/AddBookmarkDialog'
import { BackupDialog } from './components/BackupDialog'
import { BoardView } from './components/BoardView'
import { EditSiteDialog } from './components/EditSiteDialog'
import { LoginPage } from './components/LoginPage'
import { TopBar } from './components/TopBar'
import { searchBoard } from './search'
import { useUi } from './ui'

const DESKTOP_KEY = 'desktop'
const SWIPE_DISTANCE = 70

export default function App() {
  const board = useQuery({ queryKey: ['board'], queryFn: api.board, retry: false })

  if (board.data) return <Home board={board.data} />
  if (board.isPending) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <LoaderCircle className="animate-spin text-faint" />
      </main>
    )
  }
  if (board.error instanceof ApiError && board.error.status === 401) return <LoginPage onSuccess={() => board.refetch()} />
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="text-sm text-muted">加载失败：{board.error?.message}</p>
        <button className="btn btn-soft mt-4" onClick={() => board.refetch()}>
          重试
        </button>
      </div>
    </main>
  )
}

function Home({ board }: { board: Board }) {
  const queryClient = useQueryClient()
  const { toast } = useUi()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [editingSiteId, setEditingSiteId] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // The desktop shown is remembered per browser. A remembered one that no longer exists falls back to the first
  const [desktopId, setDesktopId] = useState(() => Number(localStorage.getItem(DESKTOP_KEY)))
  const { desktops } = board
  const desktopIndex = Math.max(
    0,
    desktops.findIndex((d) => d.id === desktopId),
  )
  const desktop = desktops[desktopIndex]
  /** Side the next desktop slides in from: 1 from the right, -1 from the left, 0 on first load */
  const [slide, setSlide] = useState(0)

  useEffect(() => {
    localStorage.setItem(DESKTOP_KEY, String(desktop.id))
  }, [desktop.id])

  const switchDesktop = useCallback(
    (id: number, direction?: 1 | -1) => {
      const index = desktops.findIndex((d) => d.id === id)
      if (id === desktop.id) return
      // A desktop that isn't loaded yet (just created or imported) is always further right
      setSlide(direction ?? (index < 0 || index > desktopIndex ? 1 : -1))
      setDesktopId(id)
      setEditingSiteId(null)
      window.scrollTo({ top: 0 })
    },
    [desktops, desktop.id, desktopIndex],
  )

  const stepDesktop = useCallback(
    (step: 1 | -1) => {
      if (desktops.length > 1) switchDesktop(desktops[(desktopIndex + step + desktops.length) % desktops.length].id, step)
    },
    [desktops, desktopIndex, switchDesktop],
  )

  // Saves run one after another, so that quick changes can't reach the server out of order
  const viewSaves = useRef<Promise<unknown>>(Promise.resolve())
  const setView = useCallback(
    (view: View) => {
      const id = desktop.id
      queryClient.setQueryData<Board>(['board'], (current) => current && { desktops: current.desktops.map((d) => (d.id === id ? { ...d, view } : d)) })
      viewSaves.current = viewSaves.current
        .then(() => api.updateDesktop(id, { view }))
        .catch((error: Error) => {
          toast(error.message, 'error')
          return queryClient.invalidateQueries({ queryKey: ['board'] })
        })
    },
    [queryClient, toast, desktop.id],
  )
  /** Reads the view from the cache, which is ahead of this render when keys are pressed in quick succession */
  const cycleView = useCallback(() => {
    const shown = queryClient.getQueryData<Board>(['board'])?.desktops.find((d) => d.id === desktop.id)?.view ?? desktop.view
    setView(VIEWS[(VIEWS.indexOf(shown) + 1) % VIEWS.length])
  }, [queryClient, desktop.id, desktop.view, setView])

  const result = useMemo(() => searchBoard(desktop.groups, query), [desktop.groups, query])
  const searching = query.trim() !== ''
  /** Matches on the desktops that aren't shown */
  const elsewhere = useMemo(() => {
    if (!searching) return []
    return desktops
      .filter((d) => d.id !== desktop.id)
      .map((d) => ({ desktop: d, count: searchBoard(d.groups, query).groups.reduce((count, group) => count + group.sites.length, 0) }))
      .filter((entry) => entry.count > 0)
  }, [desktops, desktop.id, query, searching])
  const editingSite = desktop.groups.flatMap((g) => g.sites).find((s) => s.id === editingSiteId) ?? null

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      // defaultPrevented: a keyboard drag is using the arrow keys
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (target.closest('input, textarea, select, [contenteditable]') || document.querySelector('[aria-modal="true"]')) return

      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setAdding(true)
      } else if (event.key.toLowerCase() === 'v') {
        cycleView()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (desktops.length > 1) event.preventDefault()
        stepDesktop(event.key === 'ArrowLeft' ? -1 : 1)
      } else if (/^[1-9]$/.test(event.key)) {
        const numbered = desktops[Number(event.key) - 1]
        if (numbered) switchDesktop(numbered.id)
      } else if (event.key === 'Escape') {
        setEditing(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [desktops, cycleView, stepDesktop, switchDesktop])

  // A horizontal swipe switches desktops on touch screens. Off in edit mode, where touches drag cards
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : null
    touchStart.current = touch && !editing ? { x: touch.clientX, y: touch.clientY } : null
  }
  const onTouchEnd = (event: TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const dx = event.changedTouches[0].clientX - start.x
    const dy = event.changedTouches[0].clientY - start.y
    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 2) stepDesktop(dx < 0 ? 1 : -1)
  }

  const empty = desktop.groups.every((g) => g.sites.length === 0)
  const noResults = searching && result.groups.length === 0

  return (
    <>
      <TopBar
        desktops={desktops}
        desktop={desktop}
        onSwitchDesktop={switchDesktop}
        onStepDesktop={stepDesktop}
        onView={setView}
        query={query}
        onQuery={setQuery}
        onSearchEnter={() => result.firstUrl && window.open(result.firstUrl, '_blank', 'noreferrer')}
        searchRef={searchRef}
        editing={editing}
        onToggleEditing={() => setEditing(!editing)}
        onAdd={() => setAdding(true)}
        onBackup={() => setBackupOpen(true)}
      />
      <main className="mx-auto max-w-7xl overflow-x-clip px-4 pt-8 pb-24 sm:px-6" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <motion.div
          key={desktop.id}
          initial={slide === 0 ? false : { opacity: 0, x: slide * 36 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {empty && !editing && !searching ? (
            <div className="grid animate-rise place-items-center py-28 text-center">
              <span className="mb-4 grid size-14 place-items-center rounded-card border-[length:var(--border-w)] border-line bg-accent-soft text-accent">
                <BookmarkPlus size={26} />
              </span>
              <h2 className="font-display text-lg font-semibold">{desktops.length > 1 ? `「${desktop.name}」还没有书签` : '还没有书签'}</h2>
              <p className="mt-1 mb-5 max-w-xs text-sm text-muted">粘贴一个网址，域名会成为卡片，子路径会成为卡片上的链接。</p>
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                添加第一个书签
              </button>
            </div>
          ) : noResults ? (
            <div className={`grid place-items-center text-center text-muted ${elsewhere.length ? 'pt-28 pb-8' : 'py-28'}`}>
              <SearchX size={28} className="mb-3 text-faint" />
              <p className="text-sm">
                {desktops.length > 1 ? `「${desktop.name}」中` : ''}没有找到与「{query.trim()}」相关的书签
              </p>
            </div>
          ) : (
            <BoardView desktop={desktop} groups={result.groups} editing={editing} sortable={editing && !searching} matchedLinks={result.matchedLinks} onEditSite={setEditingSiteId} />
          )}

          {elsewhere.length > 0 && (
            <div className={`flex flex-wrap items-center gap-2 text-sm text-muted ${noResults ? 'justify-center' : 'mt-10 border-t border-line pt-5'}`}>
              <span>其他桌面：</span>
              {elsewhere.map((entry) => (
                <button
                  key={entry.desktop.id}
                  className="flex max-w-full items-center gap-1.5 rounded-pill border-[length:var(--border-w)] border-line bg-surface px-3 py-1 transition hover:border-accent/50 hover:text-accent"
                  onClick={() => switchDesktop(entry.desktop.id)}
                >
                  <span className="truncate font-medium">{entry.desktop.name}</span>
                  <span className="shrink-0 font-mono text-xs text-faint tabular-nums">{entry.count} 个结果</span>
                </button>
              ))}
            </div>
          )}
        </motion.div>
      </main>
      <AddBookmarkDialog open={adding} onClose={() => setAdding(false)} desktop={desktop} />
      <EditSiteDialog site={editingSite} desktop={desktop} desktops={desktops} onClose={() => setEditingSiteId(null)} />
      <BackupDialog open={backupOpen} onClose={() => setBackupOpen(false)} desktops={desktops} desktop={desktop} onImported={switchDesktop} />
    </>
  )
}
