import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, BookmarkPlus, LoaderCircle, SearchX } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import type { SystemSettings } from '../shared/settings'
import type { BoardPage, View } from '../shared/types'
import { parseBookmarkUrl } from '../shared/url'
import { api, ApiError } from './api'
import { updateBoardCache } from './board-cache'
import { AddBookmarkDialog } from './components/AddBookmarkDialog'
import { BoardView } from './components/BoardView'
import { EditSiteDialog } from './components/EditSiteDialog'
import { LoginPage } from './components/LoginPage'
import { SettingsDialog } from './components/SettingsDialog'
import { TopBar } from './components/TopBar'
import { SEARCH_ENGINES, SearchEngineIcon, useSearchEngine } from './engines'
import { searchBoard } from './search'
import { readSettings } from './settings'
import { UiProvider, useUi } from './ui'

const DESKTOP_KEY = 'desktop'
const SWIPE_DISTANCE = 70
const LOCK_KEY = 'bookmarks-lock'
type LockMode = 'locked' | 'signed-out'

function storedLockMode(): LockMode | null {
  const value = localStorage.getItem(LOCK_KEY)
  return value === 'locked' || value === 'signed-out' ? value : null
}

function canUseGlobalShortcut(event: KeyboardEvent | ClipboardEvent) {
  if (event.defaultPrevented || document.querySelector('[aria-modal="true"], .popover-panel:not([data-edit-controls])')) return false
  return !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'))
}

export default function App() {
  const queryClient = useQueryClient()
  const [desktopId, setDesktopId] = useState(() => Number(localStorage.getItem(DESKTOP_KEY)))
  const [lockMode, setLockMode] = useState(storedLockMode)
  const previousPage = useRef<BoardPage | undefined>(undefined)
  const logoutFlight = useRef<Promise<unknown>>(Promise.resolve())
  const board = useQuery({
    queryKey: ['board', desktopId],
    queryFn: () => api.board(desktopId),
    retry: false,
    enabled: !lockMode,
    placeholderData: keepPreviousData,
  })
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings, placeholderData: readSettings })
  const systemSettings = settings.data ?? readSettings()
  const { siteName } = systemSettings

  useEffect(() => {
    document.title = siteName
  }, [siteName])

  const clearBookmarks = useCallback(() => {
    previousPage.current = undefined
    void queryClient.cancelQueries({ queryKey: ['board'] })
    void queryClient.cancelQueries({ queryKey: ['board-search'] })
    queryClient.removeQueries({ queryKey: ['board'] })
    queryClient.removeQueries({ queryKey: ['board-search'] })
  }, [queryClient])

  useEffect(() => {
    if (lockMode || !board.data || board.isPlaceholderData) return
    previousPage.current = board.data
    const resolvedId = board.data.desktop.id
    localStorage.setItem(DESKTOP_KEY, String(resolvedId))
    if (desktopId !== resolvedId) {
      queryClient.setQueryData(['board', resolvedId], board.data)
      setDesktopId(resolvedId)
    }
  }, [board.data, board.isPlaceholderData, desktopId, queryClient, lockMode])

  const endSession = useCallback((mode: LockMode) => {
    // Hide the board immediately, and persist the lock before contacting the server.
    localStorage.setItem(LOCK_KEY, mode)
    setLockMode(mode)
    clearBookmarks()
    // Login waits for logout, so a slow logout cannot erase the newly issued cookie.
    logoutFlight.current = api.logout().catch(() => undefined)
  }, [clearBookmarks])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'l' || event.isComposing) return
      if (!board.data && !lockMode) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!lockMode && !event.repeat) endSession('locked')
    }
    // Capture also works while an input, menu, dialog, or drag is active.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [board.data, lockMode, endSession])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCK_KEY && event.key !== null) return
      const mode = storedLockMode()
      if (mode) {
        setLockMode(mode)
        clearBookmarks()
      } else {
        // Another tab has verified the password; refresh before showing its session.
        void board.refetch().then((result) => {
          if (!result.error && !storedLockMode()) setLockMode(null)
        })
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [board.refetch, clearBookmarks])

  const loggedIn = async () => {
    const result = await board.refetch()
    if (result.error) throw result.error
    localStorage.removeItem(LOCK_KEY)
    setLockMode(null)
  }

  if (lockMode || (board.error instanceof ApiError && board.error.status === 401)) {
    return <LoginPage siteName={siteName} locked={lockMode === 'locked'} beforeLogin={() => logoutFlight.current} onSuccess={loggedIn} />
  }
  const page = board.data ?? previousPage.current
  if (page) return (
    <UiProvider>
      <Home
        board={page}
        desktopId={desktopId}
        onSelectDesktop={setDesktopId}
        loading={board.isPlaceholderData || !board.data}
        loadError={!board.data ? board.error?.message : undefined}
        onRetryBoard={() => { void board.refetch() }}
        settingsReady={settings.isSuccess && !settings.isPlaceholderData}
        settingsError={settings.isError}
        onRetrySettings={() => { void settings.refetch() }}
        settings={systemSettings}
        onLock={() => endSession('locked')}
        onLogout={() => endSession('signed-out')}
      />
    </UiProvider>
  )
  if (board.isPending) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <LoaderCircle className="animate-spin text-faint" />
      </main>
    )
  }
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

interface HomeProps {
  board: BoardPage
  desktopId: number
  onSelectDesktop: (id: number) => void
  loading: boolean
  loadError?: string
  onRetryBoard: () => void
  settingsReady: boolean
  settingsError: boolean
  onRetrySettings: () => void
  settings: SystemSettings
  onLock: () => void
  onLogout: () => void
}

function Home({ board, desktopId, onSelectDesktop, loading, loadError, onRetryBoard, settingsReady, settingsError, onRetrySettings, settings, onLock, onLogout }: HomeProps) {
  const { siteName, openInNewTab } = settings
  const queryClient = useQueryClient()
  const { toast } = useUi()
  const [engine] = useSearchEngine()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  // null closes the dialog; an empty string opens it without a pasted URL
  const [addingUrl, setAddingUrl] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingSiteId, setEditingSiteId] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // The desktop shown is remembered per browser. A remembered one that no longer exists falls back to the first
  const { desktops } = board
  const desktopIndex = Math.max(
    0,
    desktops.findIndex((d) => d.id === (loading ? desktopId : board.desktop.id)),
  )
  const selected = desktops.find((d) => d.id === desktopId)
  const desktop = loading ? { ...(selected ?? { id: desktopId, name: '加载中…', view: 'large' as View }), groups: [] } : board.desktop
  /** Side the next desktop slides in from: 1 from the right, -1 from the left, 0 on first load */
  const [slide, setSlide] = useState(0)

  const switchDesktop = useCallback(
    (id: number, direction?: 1 | -1) => {
      const index = desktops.findIndex((d) => d.id === id)
      if (id === desktop.id) return
      // A desktop that isn't loaded yet (just created or imported) is always further right
      setSlide(direction ?? (index < 0 || index > desktopIndex ? 1 : -1))
      onSelectDesktop(id)
      setEditing(false)
      setAddingUrl(null)
      setEditingSiteId(null)
      window.scrollTo({ top: 0 })
    },
    [desktops, desktop.id, desktopIndex, onSelectDesktop],
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
      updateBoardCache(queryClient, (page) => ({ ...page, desktops: page.desktops.map((d) => d.id === id ? { ...d, view } : d), desktop: page.desktop.id === id ? { ...page.desktop, view } : page.desktop }))
      viewSaves.current = viewSaves.current
        .then(() => api.updateDesktop(id, { view }))
        .catch((error: Error) => {
          toast(error.message, 'error')
          return queryClient.invalidateQueries({ queryKey: ['board'] })
        })
    },
    [queryClient, toast, desktop.id],
  )
  const result = useMemo(() => searchBoard(desktop.groups, query), [desktop.groups, query])
  const searching = query.trim() !== ''
  // Only aggregate counts cross the network while searching another desktop.
  const [searchTerm, setSearchTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(query.trim()), 200)
    return () => clearTimeout(timer)
  }, [query])
  const otherMatches = useQuery({ queryKey: ['board-search', searchTerm], queryFn: () => api.search(searchTerm), enabled: !!searchTerm && desktops.length > 1, retry: false })
  const elsewhere = useMemo(() => {
    if (!searching || searchTerm !== query.trim()) return []
    return (otherMatches.data ?? [])
      .filter((match) => match.desktopId !== desktop.id)
      .flatMap((match) => {
        const item = desktops.find((d) => d.id === match.desktopId)
        return item ? [{ desktop: item, count: match.count }] : []
      })
  }, [otherMatches.data, desktops, desktop.id, query, searchTerm, searching])
  const editingSite = desktop.groups.flatMap((g) => g.sites).find((s) => s.id === editingSiteId) ?? null

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // defaultPrevented: a keyboard drag is using the arrow keys
      if (!canUseGlobalShortcut(event) || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return

      if (editing && (event.key === 'Enter' || event.key === 'Escape')) {
        event.preventDefault()
        // A long press can leave the card link focused; don't keep its keyboard focus ring on exit
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        setEditing(false)
      } else if (/^[a-z0-9]$/i.test(event.key)) {
        event.preventDefault()
        setQuery((current) => current + event.key)
        searchRef.current?.focus()
      } else if (event.key === 'Tab' && desktops.length > 1) {
        event.preventDefault()
        stepDesktop(event.shiftKey ? -1 : 1)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (desktops.length > 1) event.preventDefault()
        stepDesktop(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    const onPaste = (event: ClipboardEvent) => {
      if (!canUseGlobalShortcut(event)) return
      // The paste event exposes the clipboard without requesting clipboard-read permission
      const url = event.clipboardData?.getData('text/plain').trim()
      if (!url || !parseBookmarkUrl(url)) return
      event.preventDefault()
      if (!loading) setAddingUrl(url)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  }, [desktops.length, editing, stepDesktop, loading])

  // A horizontal swipe switches desktops on touch screens. Off in edit mode, where touches drag cards
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : null
    touchStart.current = touch && !editing ? { x: touch.clientX, y: touch.clientY } : null
  }
  const onTouchEnd = (event: TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start || editing) return
    const dx = event.changedTouches[0].clientX - start.x
    const dy = event.changedTouches[0].clientY - start.y
    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 2) stepDesktop(dx < 0 ? 1 : -1)
  }

  const empty = desktop.groups.every((g) => g.sites.length === 0)
  const noResults = searching && result.groups.length === 0

  const handleSearchEngine = useCallback(() => {
    const trimmed = query.trim()
    if (!trimmed) return
    const url = engine.buildUrl(trimmed)
    if (openInNewTab) {
      window.open(url, '_blank', 'noreferrer')
    } else {
      window.location.assign(url)
    }
  }, [engine, query, openInNewTab])

  const handleSearchBookmark = useCallback(() => {
    if (!result.firstUrl) return
    if (openInNewTab) {
      window.open(result.firstUrl, '_blank', 'noreferrer')
    } else {
      window.location.assign(result.firstUrl)
    }
  }, [result.firstUrl, openInNewTab])

  return (
    <>
      <TopBar
        siteName={siteName}
        desktops={desktops}
        desktop={desktop}
        onSwitchDesktop={switchDesktop}
        onStepDesktop={stepDesktop}
        onView={setView}
        query={query}
        onQuery={setQuery}
        onSearchEnter={handleSearchEngine}
        onSearchBookmark={handleSearchBookmark}
        searchRef={searchRef}
        editing={editing}
        onToggleEditing={() => !loading && setEditing(!editing)}
        onAdd={() => !loading && setAddingUrl('')}
        onSettings={() => setSettingsOpen(true)}
        onLock={onLock}
        onLogout={onLogout}
      />
      <main className="mx-auto max-w-7xl overflow-x-clip px-4 pt-8 pb-24 sm:px-6" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <motion.div
          key={desktop.id}
          initial={slide === 0 ? false : { opacity: 0, x: slide * 36 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {loading ? (
            <div role="status" aria-label={loadError ? '桌面加载失败' : '正在加载桌面'} className="grid place-items-center gap-3 py-28">
              {loadError ? <>
                <p className="text-sm text-muted">加载失败：{loadError}</p>
                <button className="btn btn-soft" onClick={onRetryBoard}>重试</button>
              </> : <LoaderCircle className="animate-spin text-faint" />}
            </div>
          ) : empty && !editing && !searching ? (
            <div className="grid animate-rise place-items-center py-28 text-center">
              <span className="mb-4 grid size-14 place-items-center rounded-card border-[length:var(--border-w)] border-line bg-accent-soft text-accent">
                <BookmarkPlus size={26} />
              </span>
              <h2 className="font-display text-lg font-semibold">{desktops.length > 1 ? `「${desktop.name}」还没有书签` : '还没有书签'}</h2>
              <p className="mt-1 mb-5 max-w-xs text-sm text-muted">粘贴一个网址，域名会成为卡片，子路径会成为卡片上的链接。</p>
              <button className="btn btn-primary" onClick={() => setAddingUrl('')}>
                添加第一个书签
              </button>
            </div>
          ) : noResults ? (
            <div className={`grid place-items-center text-center text-muted ${elsewhere.length ? 'pt-24 pb-8' : 'py-24'}`}>
              <SearchX size={28} className="mb-3 text-faint" />
              <p className="text-sm">
                {desktops.length > 1 ? `「${desktop.name}」中` : ''}没有找到与「{query.trim()}」相关的书签
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary h-8 gap-1.5 px-3 text-xs"
                  onClick={handleSearchEngine}
                >
                  <SearchEngineIcon id={engine.id} size={14} />
                  <span>在 {engine.name} 搜索「{query.trim()}」</span>
                  <ArrowUpRight size={13} className="opacity-75" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted">
                <span className="text-faint">其他引擎：</span>
                {SEARCH_ENGINES.filter((e) => e.id !== engine.id).map((e) => (
                  <a
                    key={e.id}
                    href={e.buildUrl(query.trim())}
                    target={openInNewTab ? '_blank' : undefined}
                    rel={openInNewTab ? 'noreferrer' : undefined}
                    className="flex items-center gap-1.5 rounded-pill border border-line bg-surface px-2.5 py-1 text-muted transition hover:border-accent/50 hover:text-fg"
                  >
                    <SearchEngineIcon id={e.id} size={12} />
                    <span>{e.name}</span>
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <BoardView
              openInNewTab={openInNewTab}
              desktop={desktop}
              groups={result.groups}
              editing={editing}
              sortable={!searching}
              matchedLinks={result.matchedLinks}
              onEditSite={setEditingSiteId}
              onStartEditing={() => setEditing(true)}
            />
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
      <AddBookmarkDialog open={addingUrl !== null} initialUrl={addingUrl ?? ''} onClose={() => setAddingUrl(null)} desktop={desktop} />
      <EditSiteDialog site={editingSite} desktop={desktop} desktops={desktops} onClose={() => setEditingSiteId(null)} />
      <SettingsDialog ready={settingsReady} loadError={settingsError} onRetry={onRetrySettings} open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} desktops={desktops} desktop={desktop} onImported={switchDesktop} />
    </>
  )
}
