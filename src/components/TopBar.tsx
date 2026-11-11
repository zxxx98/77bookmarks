import { Check, DatabaseBackup, Ellipsis, LogOut, Monitor, Moon, Pencil, Plus, Search, Sun } from 'lucide-react'
import type { RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Desktop, View } from '../../shared/types'
import { api } from '../api'
import { useTheme, type Theme } from '../theme'
import { usePopover } from '../ui'
import { DesktopSwitcher } from './DesktopSwitcher'
import { ViewSwitch } from './ViewSwitch'

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
]

export function Logo({ size = 32 }: { size?: number }) {
  return <img src="/favicon.svg" alt="" width={size} height={size} draggable={false} className="shrink-0" />
}

interface Props {
  desktops: Desktop[]
  desktop: Desktop
  onSwitchDesktop: (desktopId: number) => void
  onStepDesktop: (step: 1 | -1) => void
  onView: (view: View) => void
  query: string
  onQuery: (query: string) => void
  onSearchEnter: () => void
  searchRef: RefObject<HTMLInputElement | null>
  editing: boolean
  onToggleEditing: () => void
  onAdd: () => void
  onBackup: () => void
}

export function TopBar({ desktops, desktop, onSwitchDesktop, onStepDesktop, onView, query, onQuery, onSearchEnter, searchRef, editing, onToggleEditing, onAdd, onBackup }: Props) {
  const [theme, setTheme] = useTheme()
  const current = THEMES.find((t) => t.value === theme)!
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]
  const cycleTheme = () => setTheme(next.value)

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <div className="flex items-center gap-2.5 max-sm:hidden">
          <Logo />
          <span className="hidden text-[15px] font-semibold tracking-tight xl:block">77 Bookmarks</span>
        </div>
        <DesktopSwitcher desktops={desktops} active={desktop} onSwitch={onSwitchDesktop} onStep={onStepDesktop} />

        <div className="relative mx-auto w-full max-w-md min-w-0">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            type="search"
            className="input h-9 rounded-full bg-fg/5 pr-3 pl-9 sm:pr-9 [&::-webkit-search-cancel-button]:hidden"
            placeholder="搜索书签"
            aria-label="搜索书签"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSearchEnter()
              if (event.key === 'Escape') {
                onQuery('')
                event.currentTarget.blur()
              }
            }}
          />
          <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[11px] leading-4 text-faint sm:block">
            /
          </kbd>
        </div>

        {/* On narrow screens the layout and theme controls move into the menu */}
        <ViewSwitch view={desktop.view} onView={onView} className="max-md:hidden" />
        <button className="icon-btn max-md:hidden" title={`主题：${current.label}（点击切换为${next.label}）`} aria-label={`主题：${current.label}`} onClick={cycleTheme}>
          <current.icon size={17} />
        </button>
        <button
          className={`icon-btn ${editing ? '!bg-accent-soft !text-accent' : ''}`}
          title={editing ? '完成编辑' : '编辑'}
          aria-label={editing ? '完成编辑' : '编辑'}
          aria-pressed={editing}
          onClick={onToggleEditing}
        >
          {editing ? <Check size={17} /> : <Pencil size={16} />}
        </button>
        <MoreMenu view={desktop.view} onView={onView} theme={current} onCycleTheme={cycleTheme} onBackup={onBackup} />
        <button className="btn btn-primary max-sm:w-9 max-sm:px-0" onClick={onAdd} aria-label="添加书签">
          <Plus size={16} strokeWidth={2.5} />
          <span className="max-sm:hidden">添加</span>
        </button>
      </div>
    </header>
  )
}

interface MenuProps {
  view: View
  onView: (view: View) => void
  theme: (typeof THEMES)[number]
  onCycleTheme: () => void
  onBackup: () => void
}

function MoreMenu({ view, onView, theme, onCycleTheme, onBackup }: MenuProps) {
  const queryClient = useQueryClient()
  const menu = usePopover<HTMLDivElement>()

  const logout = async () => {
    await api.logout().catch(() => null)
    queryClient.removeQueries({ queryKey: ['board'] })
    await queryClient.refetchQueries({ queryKey: ['board'] })
  }

  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-fg/6'
  const close = () => menu.setOpen(false)
  return (
    <div ref={menu.ref} className="relative">
      <button className="icon-btn" aria-label="更多" aria-expanded={menu.open} onClick={() => menu.setOpen(!menu.open)}>
        <Ellipsis size={18} />
      </button>
      {menu.open && (
        <div className="absolute top-11 right-0 w-48 animate-rise rounded-xl border border-line bg-surface p-1 shadow-pop [animation-duration:0.15s]">
          <div className="md:hidden">
            <ViewSwitch view={view} onView={onView} className="m-1" />
            <button className={item} onClick={onCycleTheme}>
              <theme.icon size={15} className="text-muted" />
              主题：{theme.label}
            </button>
            <div className="my-1 h-px bg-line" />
          </div>
          <button
            className={item}
            onClick={() => {
              close()
              onBackup()
            }}
          >
            <DatabaseBackup size={15} className="text-muted" />
            备份与恢复
          </button>
          <div className="my-1 h-px bg-line" />
          <button className={item} onClick={logout}>
            <LogOut size={15} className="text-muted" />
            退出登录
          </button>
        </div>
      )}
    </div>
  )
}
