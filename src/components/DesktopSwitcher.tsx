import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronLeft, ChevronRight, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Desktop, DesktopSummary } from '../../shared/types'
import { api } from '../api'
import { updateBoardCache } from '../board-cache'
import { useAct, usePopover, useUi } from '../ui'

interface Props {
  desktops: DesktopSummary[]
  active: Desktop
  onSwitch: (desktopId: number) => void
  /** Moves to the previous (-1) or next (1) desktop, wrapping around */
  onStep: (step: 1 | -1) => void
}

export function DesktopSwitcher({ desktops, active, onSwitch, onStep }: Props) {
  const act = useAct()
  const queryClient = useQueryClient()
  const { toast } = useUi()
  const menu = usePopover<HTMLDivElement>()
  const [name, setName] = useState('')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const several = desktops.length > 1
  const arrow = 'grid h-full w-7 place-items-center text-faint transition outline-none hover:text-fg focus-visible:text-accent max-sm:hidden'

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    let createdId = 0
    const ok = await act(async () => {
      createdId = (await api.createDesktop(name.trim())).id
    })
    if (!ok) return
    setName('')
    menu.setOpen(false)
    onSwitch(createdId)
  }

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over || dragged.id === over.id) return
    const next = arrayMove(
      desktops,
      desktops.findIndex((d) => d.id === dragged.id),
      desktops.findIndex((d) => d.id === over.id),
    )
    updateBoardCache(queryClient, (page) => ({ ...page, desktops: next }))
    api.order({ desktops: next.map((d) => d.id) }).catch((error: Error) => {
      toast(error.message, 'error')
      return queryClient.invalidateQueries({ queryKey: ['board'] })
    })
  }

  return (
    <div ref={menu.ref} className="relative shrink-0">
      <div
        className={`flex h-9 items-center rounded-control border-[length:var(--border-w)] border-line bg-surface transition ${
          menu.open ? 'border-accent/60' : 'hover:border-line-strong'
        }`}
        style={{ boxShadow: 'var(--btn-shadow)' }}
      >
        {several && (
          <button className={`${arrow} rounded-l-control pl-1`} aria-label="上一个桌面" title="上一个桌面（←）" onClick={() => onStep(-1)}>
            <ChevronLeft size={15} />
          </button>
        )}
        <button
          className={`flex h-full min-w-0 items-center gap-1 rounded-control text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            several ? 'px-3 sm:px-1.5' : 'px-3'
          }`}
          aria-label={`当前桌面：${active.name}`}
          aria-expanded={menu.open}
          onClick={() => menu.setOpen(!menu.open)}
        >
          <span className="max-w-20 truncate sm:max-w-32">{active.name}</span>
          <ChevronDown size={13} className={`shrink-0 text-faint transition ${menu.open ? 'rotate-180' : ''}`} />
        </button>
        {several && (
          <button className={`${arrow} rounded-r-control pr-1`} aria-label="下一个桌面" title="下一个桌面（→）" onClick={() => onStep(1)}>
            <ChevronRight size={15} />
          </button>
        )}
      </div>

      {menu.open && (
        <div className="popover-panel absolute top-11 left-0 z-10 w-64 animate-rise p-1.5 [animation-duration:0.15s]">
          <div className="flex items-center justify-between px-1.5 pt-0.5 pb-1.5 text-[11px] text-faint">
            <span className="font-medium">桌面</span>
            {several && <span className="max-sm:hidden">← → 或 Tab 切换</span>}
          </div>
          {/* Keeps the dragged row inside the list */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[({ transform }) => ({ ...transform, x: 0 })]} onDragEnd={onDragEnd}>
            <SortableContext items={desktops.map((d) => d.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
                {desktops.map((desktop, index) => (
                  <DesktopRow
                    key={desktop.id}
                    desktop={desktop}
                    index={index}
                    current={desktop.id === active.id}
                    removable={several}
                    onSwitch={() => {
                      menu.setOpen(false)
                      onSwitch(desktop.id)
                    }}
                    onClose={() => menu.setOpen(false)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <form onSubmit={create} className="mt-1.5 flex gap-1.5 border-t border-line pt-1.5">
            <input className="input h-8 px-2.5" placeholder="新桌面名称，例如 工作" maxLength={20} value={name} onChange={(event) => setName(event.target.value)} />
            <button className="btn btn-soft h-8 px-2.5" aria-label="新建桌面" disabled={!name.trim()}>
              <Plus size={15} />
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

interface RowProps {
  desktop: DesktopSummary
  index: number
  current: boolean
  removable: boolean
  onSwitch: () => void
  onClose: () => void
}

function DesktopRow({ desktop, index, current, removable, onSwitch, onClose }: RowProps) {
  const act = useAct()
  const { confirm } = useUi()
  const [renaming, setRenaming] = useState(false)
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: desktop.id })
  const siteCount = desktop.siteCount

  const rename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    setRenaming(false)
    if (name && name !== desktop.name) void act(() => api.updateDesktop(desktop.id, { name }))
  }

  const remove = async () => {
    onClose()
    const ok = await confirm({
      title: `删除桌面「${desktop.name}」？`,
      message: siteCount ? `桌面上的 ${desktop.groupCount} 个分组、${siteCount} 张卡片及其链接会一并删除，且无法恢复。` : undefined,
      confirmText: '删除',
      danger: true,
    })
    if (ok) void act(() => api.deleteDesktop(desktop.id), '桌面已删除')
  }

  // Shown on hover or keyboard focus, and always on touch screens. Otherwise the card count takes their place
  const action = 'icon-btn-sm size-6 hidden group-hover/row:inline-flex group-focus-within/row:inline-flex [@media(hover:none)]:inline-flex'
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group/row flex h-9 items-center gap-0.5 rounded-control pr-1 ${isDragging ? 'relative z-10 bg-surface-2 shadow-card' : ''} ${
        current ? 'bg-accent-soft text-accent' : 'hover:bg-fg/6'
      }`}
    >
      {renaming ? (
        <form onSubmit={rename} className="min-w-0 flex-1 pl-1">
          <input
            name="name"
            aria-label="桌面名称"
            defaultValue={desktop.name}
            autoFocus
            maxLength={20}
            className="input h-7 px-2"
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => event.currentTarget.form?.requestSubmit()}
          />
        </form>
      ) : (
        <>
          <button
            className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-control pl-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            aria-current={current}
            onClick={onSwitch}
          >
            <span className={`grid size-5 shrink-0 place-items-center rounded-pill border font-mono text-[11px] tabular-nums ${current ? 'border-accent/40' : 'border-line text-faint'}`}>
              {index < 9 ? index + 1 : '·'}
            </span>
            <span className={`truncate ${current ? 'font-medium' : ''}`}>{desktop.name}</span>
            <span className="ml-auto pr-1 font-mono text-[11px] text-faint tabular-nums group-hover/row:hidden group-focus-within/row:hidden [@media(hover:none)]:hidden">{siteCount}</span>
          </button>
          <button className={action} aria-label={`重命名桌面 ${desktop.name}`} onClick={() => setRenaming(true)}>
            <Pencil size={12} />
          </button>
          {removable && (
            <button className={`${action} hover:!bg-danger/10 hover:!text-danger`} aria-label={`删除桌面 ${desktop.name}`} onClick={remove}>
              <Trash2 size={12} />
            </button>
          )}
          {removable && (
            <button className={`${action} cursor-grab touch-none active:cursor-grabbing`} aria-label={`拖动排序 ${desktop.name}`} {...attributes} {...listeners}>
              <GripVertical size={13} />
            </button>
          )}
        </>
      )}
    </li>
  )
}
