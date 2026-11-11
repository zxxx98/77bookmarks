import { Check, DatabaseBackup, Ellipsis, LogOut, Monitor, Moon, Palette, Pencil, Plus, Search, Sun } from 'lucide-react'
import type { RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Desktop, View } from '../../shared/types'
import { api } from '../api'
import { STYLE_PRESETS, useStyle, useTheme, type StyleId, type StylePreset, type Theme } from '../theme'
import { usePopover } from '../ui'
import { DesktopSwitcher } from './DesktopSwitcher'
import { ViewSwitch } from './ViewSwitch'

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: '系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
]

export function Logo({ size = 32 }: { size?: number }) {
  const [styleId] = useStyle()
  const rx = styleId === 'swiss' ? 0 : 7
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      className="shrink-0 select-none"
      style={{
        boxShadow: styleId === 'brutalist' ? '2px 2px 0px var(--line)' : undefined,
        borderRadius: styleId === 'swiss' ? 0 : Math.round(size * 0.22),
      }}
    >
      <rect width="32" height="32" rx={rx} fill="var(--accent-solid)" stroke="var(--line)" strokeWidth={styleId === 'brutalist' ? 2 : 1} />
      <path d="M11 8h10a1.5 1.5 0 0 1 1.5 1.5V24L16 19.5 9.5 24V9.5A1.5 1.5 0 0 1 11 8z" fill="var(--accent-fg)" />
    </svg>
  )
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
  const [styleId, setStyleId, activePreset] = useStyle()

  return (
    <header className="sticky top-0 z-30 border-b-[length:var(--border-w)] border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <div className="flex items-center gap-2.5 max-sm:hidden">
          <Logo />
          <span className="hidden font-display text-[15px] font-semibold tracking-tight xl:block">77 Bookmarks</span>
        </div>
        <DesktopSwitcher desktops={desktops} active={desktop} onSwitch={onSwitchDesktop} onStep={onStepDesktop} />

        <div className="relative mx-auto w-full max-w-md min-w-0">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            type="search"
            className="input h-9 pr-3 pl-9 sm:pr-9 [&::-webkit-search-cancel-button]:hidden"
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
          <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded-pill border border-line bg-surface px-1.5 font-mono text-[11px] leading-4 text-faint sm:block">
            /
          </kbd>
        </div>

        {/* On narrow screens the layout and theme controls move into the menu */}
        <ViewSwitch view={desktop.view} onView={onView} className="max-md:hidden" />
        <ThemeMenu theme={theme} onTheme={setTheme} styleId={styleId} activePreset={activePreset} onStyle={setStyleId} className="max-md:hidden" />
        <button
          className={`icon-btn ${editing ? '!bg-accent-soft !text-accent' : ''}`}
          title={editing ? '完成编辑' : '编辑'}
          aria-label={editing ? '完成编辑' : '编辑'}
          aria-pressed={editing}
          onClick={onToggleEditing}
        >
          {editing ? <Check size={17} /> : <Pencil size={16} />}
        </button>
        <MoreMenu view={desktop.view} onView={onView} theme={theme} onTheme={setTheme} styleId={styleId} onStyle={setStyleId} onBackup={onBackup} />
        <button className="btn btn-primary max-sm:w-9 max-sm:px-0" onClick={onAdd} aria-label="添加书签">
          <Plus size={16} strokeWidth={2.5} />
          <span className="max-sm:hidden">添加</span>
        </button>
      </div>
    </header>
  )
}

interface ThemeMenuProps {
  theme: Theme
  onTheme: (theme: Theme) => void
  styleId: StyleId
  activePreset: StylePreset
  onStyle: (style: StyleId) => void
  className?: string
}

function ThemeMenu({ theme, onTheme, styleId, activePreset, onStyle, className = '' }: ThemeMenuProps) {
  const menu = usePopover<HTMLDivElement>()
  const currentTheme = THEMES.find((t) => t.value === theme) ?? THEMES[0]

  return (
    <div ref={menu.ref} className={`relative ${className}`}>
      <button
        className={`icon-btn ${menu.open ? 'bg-fg/6 text-fg' : ''}`}
        title={`风格：${activePreset.name} · 主题：${currentTheme.label}`}
        aria-label={`外观与风格：${activePreset.name}`}
        aria-expanded={menu.open}
        onClick={() => menu.setOpen(!menu.open)}
      >
        <Palette size={17} />
      </button>

      {menu.open && (
        <div className="popover-panel absolute top-11 right-0 z-30 w-72 animate-rise p-2.5 [animation-duration:0.15s]">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-medium text-faint">外观模式</span>
            <div role="radiogroup" aria-label="外观模式" className="flex rounded-control border border-line bg-surface-2 p-0.5">
              {THEMES.map((item) => {
                const active = item.value === theme
                return (
                  <button
                    key={item.value}
                    role="radio"
                    aria-checked={active}
                    className={`flex items-center gap-1 rounded-[calc(var(--r-control)-2px)] px-2 py-1 text-xs font-medium transition outline-none ${
                      active ? 'bg-surface text-fg shadow-xs' : 'text-muted hover:text-fg'
                    }`}
                    onClick={() => onTheme(item.value)}
                  >
                    <item.icon size={12} />
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="my-2 h-px bg-line" />

          <div className="mb-1.5 px-1 text-[11px] font-medium text-faint">视觉风格</div>
          <div role="radiogroup" aria-label="视觉风格" className="flex flex-col gap-1">
            {STYLE_PRESETS.map((preset) => {
              const selected = preset.id === styleId
              return (
                <button
                  key={preset.id}
                  role="radio"
                  aria-checked={selected}
                  className={`flex items-start gap-2.5 rounded-control border px-2.5 py-2 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                    selected ? 'border-accent/60 bg-accent-soft/60' : 'border-transparent hover:bg-fg/5'
                  }`}
                  onClick={() => onStyle(preset.id)}
                >
                  <StyleSwatches swatches={preset.swatches} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={`text-sm font-medium ${selected ? 'text-accent' : 'text-fg'}`}>{preset.name}</span>
                      <span className="rounded-pill border border-line bg-surface-2 px-1.5 py-0.2 font-mono text-[10px] text-muted">{preset.tag}</span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted">{preset.description}</span>
                  </span>
                  {selected && <Check size={15} className="mt-0.5 shrink-0 text-accent" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function StyleSwatches({ swatches }: { swatches: [string, string, string, string] }) {
  return (
    <span className="mt-1 grid size-6 shrink-0 grid-cols-2 overflow-hidden rounded-[4px] border border-line shadow-2xs" aria-hidden="true">
      {swatches.map((color, i) => (
        <span key={i} style={{ backgroundColor: color }} />
      ))}
    </span>
  )
}

interface MenuProps {
  view: View
  onView: (view: View) => void
  theme: Theme
  onTheme: (theme: Theme) => void
  styleId: StyleId
  onStyle: (style: StyleId) => void
  onBackup: () => void
}

function MoreMenu({ view, onView, theme, onTheme, styleId, onStyle, onBackup }: MenuProps) {
  const queryClient = useQueryClient()
  const menu = usePopover<HTMLDivElement>()

  const logout = async () => {
    await api.logout().catch(() => null)
    queryClient.removeQueries({ queryKey: ['board'] })
    await queryClient.refetchQueries({ queryKey: ['board'] })
  }

  const item = 'flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm hover:bg-fg/6'
  const close = () => menu.setOpen(false)
  return (
    <div ref={menu.ref} className="relative">
      <button className="icon-btn" aria-label="更多" aria-expanded={menu.open} onClick={() => menu.setOpen(!menu.open)}>
        <Ellipsis size={18} />
      </button>
      {menu.open && (
        <div className="popover-panel absolute top-11 right-0 z-30 w-56 animate-rise p-1.5 [animation-duration:0.15s]">
          <div className="md:hidden">
            <ViewSwitch view={view} onView={onView} className="m-1" />
            <div className="mx-1 mt-2 mb-1 flex rounded-control border border-line bg-surface-2 p-0.5">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-[calc(var(--r-control)-2px)] py-1 text-xs font-medium ${
                    t.value === theme ? 'bg-surface text-fg shadow-xs' : 'text-muted'
                  }`}
                  onClick={() => onTheme(t.value)}
                >
                  <t.icon size={12} />
                  {t.label}
                </button>
              ))}
            </div>
            <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-faint">风格</div>
            <div className="grid grid-cols-2 gap-1 px-1 pb-1">
              {STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={`flex items-center gap-1.5 rounded-control border px-2 py-1.5 text-left text-xs font-medium ${
                    preset.id === styleId ? 'border-accent/60 bg-accent-soft text-accent' : 'border-line text-muted hover:text-fg'
                  }`}
                  onClick={() => onStyle(preset.id)}
                >
                  <span className="size-2.5 shrink-0 rounded-full border border-line" style={{ backgroundColor: preset.swatches[2] }} />
                  <span className="truncate">{preset.name}</span>
                </button>
              ))}
            </div>
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
