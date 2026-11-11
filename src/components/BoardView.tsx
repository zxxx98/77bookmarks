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
import { Check, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Board, Desktop, Group, Site, View } from '../../shared/types'
import { api } from '../api'
import { useAct, useUi } from '../ui'
import { SiteCard } from './SiteCard'

// Sortable ids are prefixed so groups and cards can share one DndContext
type Ref = { type: 'g' | 's'; id: number }
const ref = (id: UniqueIdentifier): Ref => ({ type: String(id)[0] as Ref['type'], id: Number(String(id).slice(2)) })
const groupIndexOfSite = (groups: Group[], siteId: number) => groups.findIndex((g) => g.sites.some((s) => s.id === siteId))

const collisionDetection: CollisionDetection = (args) => {
  const groupsOnly = args.droppableContainers.filter((c) => String(c.id)[0] === 'g')
  if (String(args.active.id)[0] === 'g') return closestCenter({ ...args, droppableContainers: groupsOnly })
  const sitesOnly = args.droppableContainers.filter((c) => String(c.id)[0] === 's')
  const overSite = pointerWithin({ ...args, droppableContainers: sitesOnly })
  if (overSite.length) return overSite
  // Lets a card be dropped into an empty group or the blank space of another one
  const overGroup = pointerWithin({ ...args, droppableContainers: groupsOnly })
  return overGroup.length ? overGroup : closestCenter({ ...args, droppableContainers: sitesOnly })
}

const GRID: Record<View, string> = {
  large: 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] items-start gap-3.5',
  small: 'grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] items-start gap-2.5',
  list: 'flex flex-col gap-1.5',
}

interface Props {
  desktop: Desktop
  /** The desktop's groups, narrowed down while searching */
  groups: Group[]
  editing: boolean
  /** Dragging is turned off while a search filter is hiding cards */
  sortable: boolean
  matchedLinks: Set<number>
  onEditSite: (siteId: number) => void
}

export function BoardView({ desktop, groups, editing, sortable, matchedLinks, onEditSite }: Props) {
  const queryClient = useQueryClient()
  const { toast } = useUi()
  const [draft, setDraft] = useState<Group[] | null>(null)
  const [activeSite, setActiveSite] = useState<Site | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const view = draft ?? groups

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
    let next = draft ?? groups
    if (over) {
      const a = ref(active.id)
      const o = ref(over.id)
      if (a.type === 'g' && o.type === 'g') {
        next = arrayMove(
          next,
          next.findIndex((g) => g.id === a.id),
          next.findIndex((g) => g.id === o.id),
        )
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

    queryClient.setQueryData<Board>(['board'], (board) => board && { desktops: board.desktops.map((d) => (d.id === desktop.id ? { ...d, groups: next } : d)) })
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
        setDraft(groups)
        setActiveSite(a.type === 's' ? (groups.flatMap((g) => g.sites).find((s) => s.id === a.id) ?? null) : null)
      }}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDraft(null)
        setActiveSite(null)
      }}
    >
      <SortableContext items={view.map((g) => `g-${g.id}`)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-9">
          {view.map((group) => (
            <GroupSection key={group.id} group={group} view={desktop.view} editing={editing} sortable={sortable} matchedLinks={matchedLinks} onEditSite={onEditSite} />
          ))}
        </div>
      </SortableContext>
      {editing && <NewGroup desktopId={desktop.id} />}
      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
        {activeSite && <SiteCard site={activeSite} view={desktop.view} editing lifted />}
      </DragOverlay>
    </DndContext>
  )
}

function GroupSection({ group, view, editing, sortable, matchedLinks, onEditSite }: Omit<Props, 'groups' | 'desktop'> & { group: Group; view: View }) {
  const act = useAct()
  const { confirm } = useUi()
  const [renaming, setRenaming] = useState(false)
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: `g-${group.id}`, disabled: !sortable })

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
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'relative z-10 opacity-70' : undefined}
    >
      <header className="mb-3 flex h-8 items-center gap-2 px-1">
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
          <>
            <h2 className="font-display text-sm font-semibold tracking-wide text-muted">{group.name}</h2>
            <span className="rounded-pill bg-fg/6 px-1.5 font-mono text-[11px] leading-5 font-medium text-faint tabular-nums">{group.sites.length}</span>
          </>
        )}
        {editing && !renaming && (
          <div className="ml-1 flex items-center">
            <button className="icon-btn-sm" aria-label="重命名分组" onClick={() => setRenaming(true)}>
              <Pencil size={14} />
            </button>
            <button className="icon-btn-sm hover:!bg-danger/10 hover:!text-danger" aria-label="删除分组" onClick={remove}>
              <Trash2 size={14} />
            </button>
            {sortable && (
              <button className="icon-btn-sm cursor-grab touch-none active:cursor-grabbing" aria-label="拖动分组排序" {...attributes} {...listeners}>
                <GripVertical size={15} />
              </button>
            )}
          </div>
        )}
      </header>

      <SortableContext items={group.sites.map((s) => `s-${s.id}`)} strategy={view === 'list' ? verticalListSortingStrategy : rectSortingStrategy}>
        {group.sites.length === 0 ? (
          <div className="rounded-card border border-dashed border-line px-4 py-7 text-center text-sm text-faint">
            {editing ? '把卡片拖到这里，或点击右上角「添加」' : '这个分组还没有书签'}
          </div>
        ) : (
          // Small cards carry their edit buttons above the top edge, which needs taller row gaps
          <div className={`${GRID[view]} ${view === 'small' && editing ? 'gap-y-5 pt-1.5' : ''}`}>
            {group.sites.map((site, index) => (
              <SortableSite key={site.id} site={site} view={view} index={index} editing={editing} sortable={sortable} matchedLinks={matchedLinks} onEdit={() => onEditSite(site.id)} />
            ))}
          </div>
        )}
      </SortableContext>
    </section>
  )
}

interface SortableSiteProps {
  site: Site
  view: View
  index: number
  editing: boolean
  sortable: boolean
  matchedLinks: Set<number>
  onEdit: () => void
}

function SortableSite({ site, view, index, editing, sortable, matchedLinks, onEdit }: SortableSiteProps) {
  const act = useAct()
  const { confirm } = useUi()
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: `s-${site.id}`, disabled: !sortable })

  const remove = async () => {
    const ok = await confirm({
      title: `删除「${site.title}」？`,
      message: site.links.length ? `卡片上的 ${site.links.length} 个链接会一并删除。` : undefined,
      confirmText: '删除',
      danger: true,
    })
    if (ok) void act(() => api.deleteSite(site.id), '卡片已删除')
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // An open link menu has to sit above the cards after this one
      className={`relative has-[[data-open]]:z-20 ${isDragging ? 'opacity-30' : ''}`}
    >
      {/* The entrance animation lives on an inner element so it doesn't fight the drag transform */}
      <div className="h-full animate-rise" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
        <SiteCard
          site={site}
          view={view}
          editing={editing}
          matchedLinks={matchedLinks}
          handleProps={sortable ? { ...attributes, ...listeners } : { hidden: true }}
          onEdit={onEdit}
          onDelete={remove}
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
