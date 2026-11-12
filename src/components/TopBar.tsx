import { BookmarkPlus, ChartNoAxesColumn, Check, ChevronDown, CornerDownLeft, Ellipsis, FoldVertical, FolderPlus, ListTodo, LogOut, Monitor, Moon, Palette, Pencil, Plus, Settings, Sun, UnfoldVertical, X } from 'lucide-react'
import type { RefObject } from 'react'
import type { Desktop, DesktopSummary, View } from '../../shared/types'
import { SEARCH_ENGINES, SearchEngineIcon, useSearchEngine, type SearchEngineId } from '../engines'
import { STYLE_PRESETS, useStyle, useTheme, type StyleId, type StylePreset, type Theme } from '../theme'
import { useLogout } from '../session'
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
  siteName: string
  desktops: DesktopSummary[]
  desktop: Desktop
  onSwitchDesktop: (desktopId: number) => void
  onStepDesktop: (step: 1 | -1) => void
  onView: (view: View) => void
  allCollapsed?: boolean
  onToggleCollapseAll?: () => void
  query: string
  onQuery: (query: string) => void
  onSearchEnter: () => void
  onSearchBookmark?: () => void
  searchRef: RefObject<HTMLInputElement | null>
  editing: boolean
  onToggleEditing: () => void
  onAdd: () => void
  onCreateGroup: () => void
  onSettings: () => void
  onUsage: () => void
  todoOpen: boolean
  /** Open to-dos, once the list has loaded */
  todoCount?: number
  onToggleTodos: () => void
}

export function TopBar({
  siteName,
  desktops,
  desktop,
  onSwitchDesktop,
  onStepDesktop,
  onView,
  allCollapsed,
  onToggleCollapseAll,
  query,
  onQuery,
  onSearchEnter,
  onSearchBookmark,
  searchRef,
  editing,
  onToggleEditing,
  onAdd,
  onCreateGroup,
  onSettings,
  onUsage,
  todoOpen,
  todoCount,
  onToggleTodos,
}: Props) {
  const [theme, setTheme] = useTheme()
  const [styleId, setStyleId, activePreset] = useStyle()
  const [engine] = useSearchEngine()
  const hasQuery = query.length > 0

  return (
    <header className="sticky top-0 z-30 border-b-[length:var(--border-w)] border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <div className="flex items-center gap-2.5 max-sm:hidden">
          <Logo />
          <span className="hidden max-w-48 truncate font-display text-[15px] font-semibold tracking-tight xl:block" title={siteName}>{siteName}</span>
        </div>
        <DesktopSwitcher desktops={desktops} active={desktop} onSwitch={onSwitchDesktop} onStep={onStepDesktop} />

        <div className="relative mx-auto w-full max-w-md min-w-0">
          <div className="absolute top-1/2 left-1.5 z-10 -translate-y-1/2">
            <EngineMenu searchRef={searchRef} />
          </div>
          <input
            ref={searchRef}
            type="search"
            className={`input h-9 pl-12 transition-all [&::-webkit-search-cancel-button]:hidden ${
              hasQuery ? 'pr-18 sm:pr-22' : 'pr-3'
            }`}
            placeholder={`搜索 ${engine.name} 或书签`}
            aria-label={`在 ${engine.name} 搜索或筛选书签`}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (event.shiftKey && onSearchBookmark) {
                  onSearchBookmark()
                } else {
                  onSearchEnter()
                }
              }
              if (event.key === 'Escape') {
                onQuery('')
                event.currentTarget.blur()
              }
            }}
          />
          {hasQuery && (
            <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1">
              <button
                type="button"
                className="icon-btn-sm size-6 text-faint hover:text-fg"
                title="清空"
                aria-label="清空搜索"
                onClick={() => {
                  onQuery('')
                  searchRef.current?.focus()
                }}
              >
                <X size={13} />
              </button>
              <button
                type="button"
                className="flex h-6 items-center gap-1 rounded-[calc(var(--r-control)-2px)] bg-fg/6 px-1.5 text-[11px] font-medium text-muted transition hover:bg-fg/10 hover:text-fg"
                title={`在 ${engine.name} 搜索（Enter）`}
                onClick={onSearchEnter}
              >
                <span className="max-xs:hidden">搜索</span>
                <CornerDownLeft size={10} className="text-faint" />
              </button>
            </div>
          )}
        </div>

        {/* On narrow screens the layout and theme controls move into the menu */}
        <ViewSwitch view={desktop.view} onView={onView} className="max-md:hidden" />
        {onToggleCollapseAll && (
          <button
            className={`icon-btn max-md:hidden ${allCollapsed ? '!bg-accent-soft !text-accent' : ''}`}
            title={allCollapsed ? '展开所有分组（Alt+C）' : '折叠所有分组（Alt+C）'}
            aria-label={allCollapsed ? '展开所有分组' : '折叠所有分组'}
            aria-pressed={allCollapsed}
            onClick={onToggleCollapseAll}
          >
            {allCollapsed ? <UnfoldVertical size={16} /> : <FoldVertical size={16} />}
          </button>
        )}
        {/* Narrower screens fold the to-dos with the title above the bookmarks instead */}
        <button
          className={`icon-btn relative max-lg:hidden ${todoOpen ? '!bg-accent-soft !text-accent' : ''}`}
          title={todoOpen ? '收起待办（Alt+T 添加待办）' : '展开待办（Alt+T 添加待办）'}
          aria-label={todoOpen ? '收起待办' : todoCount ? `展开待办，${todoCount} 项未完成` : '展开待办'}
          aria-pressed={todoOpen}
          onClick={onToggleTodos}
        >
          <ListTodo size={17} />
          {!todoOpen && !!todoCount && (
            <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-solid px-1 font-mono text-[10px] leading-none font-semibold text-accent-fg tabular-nums">
              {todoCount > 99 ? '99+' : todoCount}
            </span>
          )}
        </button>
        <ThemeMenu theme={theme} onTheme={setTheme} styleId={styleId} activePreset={activePreset} onStyle={setStyleId} className="max-md:hidden" />
        <button
          className={`icon-btn ${editing ? '!bg-accent-soft !text-accent' : ''}`}
          title={editing ? '完成编辑（Enter / Esc）' : '编辑'}
          aria-label={editing ? '完成编辑' : '编辑'}
          aria-pressed={editing}
          onClick={onToggleEditing}
        >
          {editing ? <Check size={17} /> : <Pencil size={16} />}
        </button>
        <MoreMenu
          view={desktop.view}
          onView={onView}
          theme={theme}
          onTheme={setTheme}
          styleId={styleId}
          onStyle={setStyleId}
          allCollapsed={allCollapsed}
          onToggleCollapseAll={onToggleCollapseAll}
          onSettings={onSettings}
          onUsage={onUsage}
        />
        <AddMenu onAdd={onAdd} onCreateGroup={onCreateGroup} />
      </div>
    </header>
  )
}

function AddMenu({ onAdd, onCreateGroup }: { onAdd: () => void; onCreateGroup: () => void }) {
  const menu = usePopover<HTMLDivElement>()
  const item = 'flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm transition hover:bg-fg/6 focus-visible:bg-fg/6'

  return (
    <div ref={menu.ref} className="relative shrink-0">
      <div className="flex">
        <button className="btn btn-primary rounded-r-none max-sm:hidden" onClick={onAdd} aria-label="添加书签">
          <Plus size={16} strokeWidth={2.5} />
          添加
        </button>
        <button
          className="btn btn-primary w-7 px-0 max-sm:w-9 sm:rounded-l-none sm:border-l-accent-fg/25"
          aria-label="添加选项"
          title="添加书签或新建分组"
          aria-expanded={menu.open}
          onClick={() => menu.setOpen(!menu.open)}
        >
          <ChevronDown size={14} className="max-sm:hidden" />
          <Plus size={16} strokeWidth={2.5} className="sm:hidden" />
        </button>
      </div>
      {menu.open && (
        <div className="popover-panel absolute top-11 right-0 z-40 w-40 animate-rise p-1.5 [animation-duration:0.15s]">
          <button className={item} onClick={() => { menu.setOpen(false); onAdd() }}>
            <BookmarkPlus size={15} className="text-muted" />
            添加书签
          </button>
          <button className={item} onClick={() => { menu.setOpen(false); onCreateGroup() }}>
            <FolderPlus size={15} className="text-muted" />
            新建分组
          </button>
        </div>
      )}
    </div>
  )
}

function EngineMenu({ searchRef }: { searchRef?: RefObject<HTMLInputElement | null> }) {
  const [engine, setEngine] = useSearchEngine()
  const menu = usePopover<HTMLDivElement>()

  return (
    <div ref={menu.ref} className="relative shrink-0">
      <button
        type="button"
        className={`flex h-7 items-center gap-1 rounded-[calc(var(--r-control)-2px)] px-1.5 transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
          menu.open ? 'bg-fg/8 text-fg' : 'text-muted hover:bg-fg/6 hover:text-fg'
        }`}
        title={`当前搜索引擎：${engine.name}（点击切换）`}
        aria-label={`当前搜索引擎：${engine.name}`}
        aria-expanded={menu.open}
        onClick={() => menu.setOpen(!menu.open)}
      >
        <SearchEngineIcon id={engine.id} size={16} />
        <ChevronDown size={11} className={`text-faint transition-transform duration-150 ${menu.open ? 'rotate-180' : ''}`} />
      </button>

      {menu.open && (
        <div className="popover-panel absolute top-9 left-0 z-40 w-44 animate-rise p-1 shadow-pop [animation-duration:0.15s]">
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-faint">搜索引擎</div>
          <div role="radiogroup" aria-label="搜索引擎" className="flex flex-col gap-0.5">
            {SEARCH_ENGINES.map((item) => {
              const selected = item.id === engine.id
              return (
                <button
                  key={item.id}
                  role="radio"
                  aria-checked={selected}
                  className={`flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-xs transition outline-none ${
                    selected ? 'bg-accent-soft font-medium text-accent' : 'text-fg hover:bg-fg/6'
                  }`}
                  onClick={() => {
                    setEngine(item.id)
                    menu.setOpen(false)
                    searchRef?.current?.focus()
                  }}
                >
                  <SearchEngineIcon id={item.id} size={15} />
                  <span className="flex-1">{item.name}</span>
                  {selected && <Check size={13} className="shrink-0 text-accent" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
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
  allCollapsed?: boolean
  onToggleCollapseAll?: () => void
  onSettings: () => void
  onUsage: () => void
}

function MoreMenu({ view, onView, theme, onTheme, styleId, onStyle, allCollapsed, onToggleCollapseAll, onSettings, onUsage }: MenuProps) {
  const menu = usePopover<HTMLDivElement>()

  const item = 'flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm hover:bg-fg/6'
  const logout = useLogout()
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
            {onToggleCollapseAll && (
              <button
                className={item}
                onClick={() => {
                  close()
                  onToggleCollapseAll()
                }}
              >
                {allCollapsed ? <UnfoldVertical size={15} className="text-muted" /> : <FoldVertical size={15} className="text-muted" />}
                <span className="flex-1">{allCollapsed ? '展开所有分组' : '折叠所有分组'}</span>
                <kbd className="font-mono text-xs text-faint">Alt+C</kbd>
              </button>
            )}
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
              onUsage()
            }}
          >
            <ChartNoAxesColumn size={15} className="text-muted" />
            使用统计
          </button>
          <button
            className={item}
            onClick={() => {
              close()
              onSettings()
            }}
          >
            <Settings size={15} className="text-muted" />
            系统设置
          </button>
          {logout && (
            <button
              className={item}
              onClick={() => {
                close()
                logout()
              }}
            >
              <LogOut size={15} className="text-muted" />
              退出登录
            </button>
          )}
        </div>
      )}
    </div>
  )
}
