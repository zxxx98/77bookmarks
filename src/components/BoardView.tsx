import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, GripVertical, Pencil, Pin, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { Desktop, Group, Site, View } from '../../shared/types'
import type { LayoutColumns } from '../../shared/settings'
import { api } from '../api'
import { updateBoardCache } from '../board-cache'
import { useAct, useUi } from '../ui'
import { SiteCard } from './SiteCard'

const toElement = (node: EventTarget | null): Element | null => {
  if (!node || typeof node !== 'object') return null
  if ('closest' in node && typeof (node as { closest?: unknown }).closest === 'function') return node as Element
  if ('parentElement' in node) return toElement((node as { parentElement?: EventTarget | null }).parentElement ?? null)
  return null
}

export class GripPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: ReactPointerEvent) => {
        if (!event.isPrimary || event.button !== 0) return false
        const element = toElement(event.target)
        return !!element?.closest('[data-drag-handle]')
      },
    },
  ]
}

export class LongPressPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: ReactPointerEvent) => {
        if (!event.isPrimary || event.button !== 0 || event.pointerType === 'touch') return false
        const element = toElement(event.target)
        if (!element) return false
        if (element.closest('[data-drag-handle]')) return false
        if (element.closest('button, input, textarea, select, [data-open]')) return false
        return true
      },
    },
  ]
}

class CardPointerSensor extends PointerSensor {
  constructor(props: ConstructorParameters<typeof PointerSensor>[0]) {
    super({
      ...props,
      options: {
        ...props.options,
        activationConstraint: toElement(props.event.target)?.closest('[data-drag-handle]') ? { distance: 4 } : { delay: 400, tolerance: 8 },
      },
    })
  }

  // dnd-kit keeps one handler per event name, so both pointer gestures share one sensor
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (event: ReactPointerEvent) => GripPointerSensor.activators[0].handler(event) || LongPressPointerSensor.activators[0].handler(event),
    },
  ]
}

// Sortable ids are prefixed so groups and cards can share one DndContext
type Ref = { type: 'g' | 's'; id: number }
const ref = (id: UniqueIdentifier): Ref => ({ type: String(id)[0] as Ref['type'], id: Number(String(id).slice(2)) })
const groupIndexOfSite = (groups: Group[], siteId: number) => groups.findIndex((g) => g.sites.some((s) => s.id === siteId))

const isPinned = (data: { current?: Record<string, unknown> } | undefined) => !!data?.current?.pinned

export const collisionDetection: CollisionDetection = (args) => {
  const groupsOnly = args.droppableContainers.filter((c) => String(c.id)[0] === 'g')
  if (String(args.active.id)[0] === 'g') {
    // Pinned groups stay ahead of the others, so a group is only sorted among its own kind
    const pinned = isPinned(args.active.data)
    return closestCenter({ ...args, droppableContainers: groupsOnly.filter((c) => isPinned(c.data) === pinned) })
  }
  const sitesOnly = args.droppableContainers.filter((c) => String(c.id)[0] === 's')
  const overSite = pointerWithin({ ...args, droppableContainers: sitesOnly })
  if (overSite.length) return overSite
  // Lets a card be dropped into an empty group or the blank space of another one
  const overGroup = pointerWithin({ ...args, droppableContainers: groupsOnly })
  return overGroup.length ? overGroup : closestCenter({ ...args, droppableContainers: sitesOnly })
}

/** Scroll-independent position, so that scrolling between two measurements doesn't count as movement */
const pagePosition = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect()
  return { x: rect.left + window.scrollX, y: rect.top + window.scrollY }
}

const GRID: Record<View, string> = {
  large: 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] items-start gap-3.5',
  small: 'grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] items-start gap-2.5',
  list: 'flex flex-col gap-1.5',
}

const GROUP_LAYOUT: Record<LayoutColumns, string> = {
  1: 'flex flex-col gap-9',
  2: 'grid grid-cols-1 gap-x-6 gap-y-9 md:grid-cols-2',
  3: 'grid grid-cols-1 gap-x-6 gap-y-9 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid grid-cols-1 gap-x-6 gap-y-9 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
}

interface Props {
  openInNewTab: boolean
  layoutColumns: LayoutColumns
  desktop: Desktop
  /** The desktop's groups, narrowed down while searching */
  groups: Group[]
  editing: boolean
  /** Dragging is turned off while a search filter is hiding cards */
  sortable: boolean
  matchedLinks: Set<number>
  collapsedGroupIds?: Set<number>
  onToggleGroupCollapse?: (groupId: number) => void
  onEditSite: (siteId: number) => void
  onStartEditing?: () => void
}

export function BoardView({ desktop, groups, editing, sortable, matchedLinks, collapsedGroupIds, onToggleGroupCollapse, onEditSite, onStartEditing, openInNewTab, layoutColumns }: Props) {
  const queryClient = useQueryClient()
  const act = useAct()
  const { toast, confirm } = useUi()
  const [draft, setDraft] = useState<Group[] | null>(null)
  const [activeSite, setActiveSite] = useState<Site | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; site: Site } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const dragJustEndedRef = useRef(false)

  const removeSite = useCallback(
    async (site: Site) => {
      const ok = await confirm({
        title: `删除「${site.title}」？`,
        message: site.links.length ? `卡片上的 ${site.links.length} 个链接会一并删除。` : undefined,
        confirmText: '删除',
        danger: true,
      })
      if (ok) void act(() => api.deleteSite(site.id), '卡片已删除')
    },
    [confirm, act],
  )

  const handleContextMenu = useCallback((e: React.MouseEvent, site: Site) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      site,
    })
  }, [])

  useEffect(() => {
    if (!contextMenu) return

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) {
        setContextMenu(null)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setContextMenu(null)
      }
    }
    const handleScroll = () => {
      setContextMenu(null)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [contextMenu])

  const sensors = useSensors(
    useSensor(CardPointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter finishes layout editing even when a drag handle still has focus
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter', 'Tab'] },
    }),
  )
  const view = draft ?? groups

  // Pinning moves a group across the page, so the groups glide from where they were (FLIP)
  const sectionEls = useRef(new Map<number, HTMLElement>())
  const flipFrom = useRef<Map<number, { x: number; y: number }> | null>(null)
  const registerSection = useCallback((id: number, element: HTMLElement | null) => {
    if (element) sectionEls.current.set(id, element)
    else sectionEls.current.delete(id)
  }, [])

  const togglePin = useCallback(
    async (group: Group) => {
      flipFrom.current = new Map([...sectionEls.current].map(([id, element]) => [id, pagePosition(element)]))
      await act(() => api.pinGroup(group.id, !group.pinned), group.pinned ? `已取消置顶「${group.name}」` : `已置顶「${group.name}」`)
      // A pin that moved nothing must not animate some later reorder
      setTimeout(() => {
        flipFrom.current = null
      }, 400)
    },
    [act],
  )

  const groupOrder = view.map((g) => g.id).join()
  useLayoutEffect(() => {
    const from = flipFrom.current
    flipFrom.current = null
    if (!from || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    for (const [id, element] of sectionEls.current) {
      const before = from.get(id)
      if (!before || !element.animate) continue
      const now = pagePosition(element)
      const dx = before.x - now.x
      const dy = before.y - now.y
      if (dx || dy) element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
    }
  }, [groupOrder])

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const a = ref(active.id)
    if (!over || a.type !== 's') return
    const o = ref(over.id)
    setDraft((prev) => {
      const list = prev ?? groups
      const from = groupIndexOfSite(list, a.id)
      const to = o.type === 'g' ? list.findIndex((g) => g.id === o.id) : groupIndexOfSite(list, o.id)
      if (from < 0 || to < 0 || from === to) return prev
      const site = list[from].sites.find((s) => s.id === a.id)!
      const target = list[to].sites
      const at = o.type === 'g' ? target.length : target.findIndex((s) => s.id === o.id)
      return list.map((group, index) => {
        if (index === from) return { ...group, sites: group.sites.filter((s) => s.id !== a.id) }
        if (index === to) return { ...group, sites: [...target.slice(0, at), site, ...target.slice(at)] }
        return group
      })
    })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    dragJustEndedRef.current = true
    setTimeout(() => {
      dragJustEndedRef.current = false
    }, 250)

    let next = draft ?? groups
    if (over) {
      const a = ref(active.id)
      const o = ref(over.id)
      if (a.type === 'g' && o.type === 'g') {
        const from = next.findIndex((g) => g.id === a.id)
        const to = next.findIndex((g) => g.id === o.id)
        if (from >= 0 && to >= 0 && next[from].pinned === next[to].pinned) next = arrayMove(next, from, to)
      } else if (a.type === 's' && o.type === 's') {
        const index = groupIndexOfSite(next, a.id)
        if (index >= 0 && index === groupIndexOfSite(next, o.id)) {
          const sites = next[index].sites
          const moved = arrayMove(
            sites,
            sites.findIndex((s) => s.id === a.id),
            sites.findIndex((s) => s.id === o.id),
          )
          next = next.map((group, i) => (i === index ? { ...group, sites: moved } : group))
        }
      }
    }
    setDraft(null)
    setActiveSite(null)
    if (next === groups) return

    updateBoardCache(queryClient, (page) => page.desktop.id === desktop.id ? { ...page, desktop: { ...page.desktop, groups: next } } : page)
    api
      .order({ groups: next.map((g) => g.id), sites: next.map((g) => ({ groupId: g.id, ids: g.sites.map((s) => s.id) })) })
      .catch((error: Error) => {
        toast(error.message, 'error')
        return queryClient.invalidateQueries({ queryKey: ['board'] })
      })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={({ active }) => {
        const a = ref(active.id)
        if (!editing) onStartEditing?.()
        navigator.vibrate?.(40)
        flipFrom.current = null
        setDraft(groups)
        setActiveSite(a.type === 's' ? (groups.flatMap((g) => g.sites).find((s) => s.id === a.id) ?? null) : null)
      }}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        dragJustEndedRef.current = true
        setTimeout(() => {
          dragJustEndedRef.current = false
        }, 250)
        setDraft(null)
        setActiveSite(null)
      }}
    >
      <SortableContext items={view.map((g) => `g-${g.id}`)} strategy={layoutColumns === 1 ? verticalListSortingStrategy : rectSortingStrategy}>
        <div className={GROUP_LAYOUT[layoutColumns]}>
          {view.map((group) => (
            <GroupSection
              openInNewTab={openInNewTab}
              key={group.id}
              group={group}
              view={desktop.view}
              editing={editing}
              sortable={sortable}
              matchedLinks={matchedLinks}
              collapsed={collapsedGroupIds?.has(group.id) ?? false}
              onToggleCollapse={() => onToggleGroupCollapse?.(group.id)}
              onTogglePin={togglePin}
              registerSection={registerSection}
              onEditSite={onEditSite}
              onDeleteSite={removeSite}
              onContextMenu={handleContextMenu}
              dragJustEndedRef={dragJustEndedRef}
            />
          ))}
        </div>
      </SortableContext>
      {editing && <NewGroup desktopId={desktop.id} />}
      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
        {activeSite && <SiteCard site={activeSite} view={desktop.view} openInNewTab={openInNewTab} editing lifted />}
      </DragOverlay>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            left: `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - 148))}px`,
            top: `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - 90))}px`,
          }}
          className="popover-panel fixed z-50 min-w-32 animate-rise p-1 [animation-duration:0.12s]"
        >
          <button
            className="flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-sm transition hover:bg-fg/6"
            onClick={() => {
              const id = contextMenu.site.id
              setContextMenu(null)
              onEditSite(id)
            }}
          >
            <Pencil size={14} className="text-muted" />
            <span>编辑</span>
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-sm text-danger transition hover:bg-danger/10"
            onClick={() => {
              const site = contextMenu.site
              setContextMenu(null)
              void removeSite(site)
            }}
          >
            <Trash2 size={14} />
            <span>删除</span>
          </button>
        </div>
      )}
    </DndContext>
  )
}

function GroupSection({
  openInNewTab,
  group,
  view,
  editing,
  sortable,
  matchedLinks,
  collapsed,
  onToggleCollapse,
  onTogglePin,
  registerSection,
  onEditSite,
  onDeleteSite,
  onContextMenu,
  dragJustEndedRef,
}: Omit<Props, 'groups' | 'desktop' | 'layoutColumns' | 'collapsedGroupIds' | 'onToggleGroupCollapse'> & {
  group: Group
  view: View
  collapsed: boolean
  onToggleCollapse: () => void
  onTogglePin: (group: Group) => void
  registerSection: (id: number, element: HTMLElement | null) => void
  onDeleteSite: (site: Site) => void
  onContextMenu: (e: React.MouseEvent, site: Site) => void
  dragJustEndedRef: React.RefObject<boolean>
}) {
  const act = useAct()
  const { confirm } = useUi()
  const [renaming, setRenaming] = useState(false)
  const isCollapsed = collapsed && sortable
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: `g-${group.id}`,
    data: { pinned: group.pinned },
    disabled: !sortable || !editing,
  })
  const sectionRef = useCallback(
    (element: HTMLElement | null) => {
      setNodeRef(element)
      registerSection(group.id, element)
    },
    [setNodeRef, registerSection, group.id],
  )

  const rename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    setRenaming(false)
    if (name && name !== group.name) void act(() => api.renameGroup(group.id, name))
  }

  const remove = async () => {
    const ok = await confirm({
      title: `删除分组「${group.name}」？`,
      message: group.sites.length ? `分组内的 ${group.sites.length} 张卡片及其链接会一并删除，且无法恢复。` : undefined,
      confirmText: '删除',
      danger: true,
    })
    if (ok) void act(() => api.deleteGroup(group.id), '分组已删除')
  }

  return (
    <section
      ref={sectionRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'relative z-10 min-w-0 opacity-70' : 'min-w-0'}
    >
      <header className="group/header mb-3 flex h-8 items-center gap-2 px-1">
        {renaming ? (
          <form onSubmit={rename} className="flex items-center gap-1">
            <input
              name="name"
              defaultValue={group.name}
              autoFocus
              maxLength={40}
              className="input h-8 w-44"
              onBlur={(event) => event.currentTarget.form?.requestSubmit()}
              onKeyDown={(event) => event.key === 'Escape' && setRenaming(false)}
            />
            <button className="icon-btn-sm" aria-label="保存">
              <Check size={15} />
            </button>
          </form>
        ) : (
          <div
            className="flex min-w-0 items-center gap-1.5 cursor-pointer select-none group/title"
            onClick={onToggleCollapse}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onToggleCollapse()
              }
            }}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? `展开分组「${group.name}」` : `折叠分组「${group.name}」`}
          >
            <ChevronDown
              size={15}
              className={`shrink-0 text-muted transition-transform duration-200 group-hover/title:text-fg ${isCollapsed ? '-rotate-90' : ''}`}
            />
            <h2 className="min-w-0 truncate font-display text-sm font-semibold tracking-wide text-muted group-hover/title:text-fg" title={group.name}>
              {group.name}
            </h2>
            <span className="shrink-0 rounded-pill bg-fg/6 px-1.5 font-mono text-[11px] leading-5 font-medium text-faint tabular-nums">
              {group.sites.length}
            </span>
          </div>
        )}
        {!renaming && (
          <div className="ml-1 flex shrink-0 items-center">
            {/* Outside layout editing the pin only appears on hover, and stays put once the group is pinned.
                Touch screens have no hover, so there it is a plain marker and pinning happens in layout editing */}
            <button
              className={`icon-btn-sm ${group.pinned ? '!text-accent' : ''} ${
                editing
                  ? ''
                  : group.pinned
                    ? '[@media(hover:none)]:pointer-events-none'
                    : 'opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:hidden'
              }`}
              title={group.pinned ? '取消置顶' : '置顶分组'}
              aria-label={group.pinned ? `取消置顶分组「${group.name}」` : `置顶分组「${group.name}」`}
              aria-pressed={group.pinned}
              onClick={() => onTogglePin(group)}
            >
              <Pin size={14} className={`rotate-45 ${group.pinned ? 'fill-current' : ''}`} />
            </button>
            {editing && (
              <>
                <button className="icon-btn-sm" aria-label="重命名分组" onClick={() => setRenaming(true)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-btn-sm hover:!bg-danger/10 hover:!text-danger" aria-label="删除分组" onClick={remove}>
                  <Trash2 size={14} />
                </button>
                {sortable && (
                  <button
                    className="icon-btn-sm cursor-grab touch-none active:cursor-grabbing"
                    aria-label="拖动分组排序"
                    data-drag-handle="true"
                    {...attributes}
                    {...listeners}
                  >
                    <GripVertical size={15} />
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </header>

      <SortableContext items={group.sites.map((s) => `s-${s.id}`)} strategy={view === 'list' ? verticalListSortingStrategy : rectSortingStrategy}>
        {isCollapsed ? null : group.sites.length === 0 ? (
          <div className="rounded-card border border-dashed border-line px-4 py-7 text-center text-sm text-faint">
            {editing ? '把卡片拖到这里，或点击右上角「添加」' : '这个分组还没有书签'}
          </div>
        ) : (
          // Small cards carry their edit buttons above the top edge, which needs taller row gaps
          <div className={`${GRID[view]} ${view === 'small' && editing ? 'gap-y-5 pt-1.5' : ''}`}>
            {group.sites.map((site, index) => (
              <SortableSite
                openInNewTab={openInNewTab}
                key={site.id}
                site={site}
                view={view}
                index={index}
                editing={editing}
                sortable={sortable}
                matchedLinks={matchedLinks}
                onEdit={() => onEditSite(site.id)}
                onDelete={() => onDeleteSite(site)}
                onContextMenu={onContextMenu}
                dragJustEndedRef={dragJustEndedRef}
              />
            ))}
          </div>
        )}
      </SortableContext>
    </section>
  )
}

interface SortableSiteProps {
  openInNewTab: boolean
  site: Site
  view: View
  index: number
  editing: boolean
  sortable: boolean
  matchedLinks: Set<number>
  onEdit: () => void
  onDelete: () => void
  onContextMenu: (e: React.MouseEvent, site: Site) => void
  dragJustEndedRef: React.RefObject<boolean>
}

function SortableSite({ site, view, index, editing, sortable, matchedLinks, onEdit, onDelete, onContextMenu, dragJustEndedRef, openInNewTab }: SortableSiteProps) {
  const act = useAct()
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: `s-${site.id}`, disabled: !sortable })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // An open link menu has to sit above the cards after this one
      className={`relative select-none [-webkit-touch-callout:none] has-[[data-open]]:z-20 ${isDragging ? 'opacity-30' : ''}`}
      onContextMenu={(e) => onContextMenu(e, site)}
      onClickCapture={(e) => {
        if (dragJustEndedRef.current) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      {...listeners}
    >
      {/* The entrance animation lives on an inner element so it doesn't fight the drag transform */}
      <div className="h-full animate-rise" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
        <SiteCard
          openInNewTab={openInNewTab}
          site={site}
          view={view}
          editing={editing}
          matchedLinks={matchedLinks}
          handleProps={sortable ? { ...attributes, ...listeners } : { hidden: true }}
          onEdit={onEdit}
          onDelete={onDelete}
          onDeleteLink={(linkId) => void act(() => api.deleteLink(linkId))}
        />
      </div>
    </div>
  )
}

function NewGroup({ desktopId }: { desktopId: number }) {
  const act = useAct()
  const [name, setName] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    if (await act(() => api.createGroup(desktopId, name.trim()))) setName('')
  }

  return (
    <form onSubmit={submit} className="mt-9 flex max-w-sm items-center gap-2">
      <input className="input" placeholder="新分组名称" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
      <button className="btn btn-soft" disabled={!name.trim()}>
        <Plus size={15} />
        新建分组
      </button>
    </form>
  )
}
