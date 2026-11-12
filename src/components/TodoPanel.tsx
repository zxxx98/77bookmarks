import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, Circle, CircleCheckBig, GripVertical, LoaderCircle, Plus, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MAX_TODO_LENGTH, type Todo } from '../../shared/types'
import { isPendingTodo, linkLabel, linkParts, type Todos } from '../todos'

interface Props {
  list: Todos
  open: boolean
  onToggle: () => void
  /** Changes each time the box for adding a to-do should take the focus */
  focusSignal: number
  openInNewTab: boolean
}

/** Enter as a command, not as the key that confirms an input method's suggestion */
const isEnter = (event: KeyboardEvent) => event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229

/** A dragged to-do moves up and down only, and no further than the ends of its list */
const keepInList: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (!draggingNodeRect || !containerNodeRect) return { ...transform, x: 0 }
  const highest = containerNodeRect.top - draggingNodeRect.top
  const lowest = containerNodeRect.bottom - draggingNodeRect.bottom
  return { ...transform, x: 0, y: Math.min(lowest, Math.max(highest, transform.y)) }
}

const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
// Shown when the row is pointed at or holds the focus. Touch screens can't hover, so they always show them
const rowActions = 'opacity-0 transition-opacity group-hover/todo:opacity-100 group-focus-within/todo:opacity-100 pointer-coarse:opacity-100'

/** The to-do list: a title that folds it away, a box for adding, the open to-dos and the finished ones */
export function TodoPanel({ list, open, onToggle, focusSignal, openInNewTab }: Props) {
  const { todos } = list
  const openTodos = todos?.filter((todo) => todo.doneAt === null) ?? []
  const doneTodos = todos?.filter((todo) => todo.doneAt !== null) ?? []
  const [draft, setDraft] = useState('')
  const [showDone, setShowDone] = useState(false)
  const addBox = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusSignal) addBox.current?.focus()
  }, [focusSignal])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const ids = openTodos.map((todo) => todo.id)
    list.reorder(arrayMove(ids, ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id))))
  }

  const add = () => {
    const text = draft.trim()
    if (!text) return
    list.add(text)
    setDraft('')
  }

  return (
    <section aria-label="待办">
      {/* Laid out like a group title, which it sits next to */}
      <header className="mb-3 flex h-8 items-center gap-2 px-1">
        <h2 className="min-w-0">
          <button
            type="button"
            className={`group/title flex min-w-0 items-center gap-1.5 rounded-control select-none ${focusRing}`}
            aria-expanded={open}
            title={open ? '收起待办' : '展开待办'}
            onClick={onToggle}
          >
            <ChevronDown size={15} className={`shrink-0 text-muted transition-transform duration-200 group-hover/title:text-fg ${open ? '' : '-rotate-90'}`} />
            <span className="font-display text-sm font-semibold tracking-wide text-muted group-hover/title:text-fg">待办</span>
            {todos && (
              <span className="shrink-0 rounded-pill bg-fg/6 px-1.5 font-mono text-[11px] leading-5 font-medium text-faint tabular-nums">{openTodos.length}</span>
            )}
          </button>
        </h2>
      </header>

      {open && (
        // The list scrolls inside the card, so that a long one neither outgrows the screen nor buries the bookmarks
        <div className="flex max-h-[60dvh] flex-col overflow-hidden rounded-card border-[length:var(--border-w)] border-line bg-surface shadow-card lg:max-h-[calc(100dvh-10rem)]">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 focus-within:border-accent/60">
            <Plus size={15} className="shrink-0 text-faint" />
            <input
              ref={addBox}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
              placeholder="添加待办，按回车保存"
              aria-label="添加待办"
              enterKeyHint="done"
              maxLength={MAX_TODO_LENGTH}
              disabled={!todos}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (isEnter(event)) add()
                else if (event.key === 'Escape') event.currentTarget.blur()
              }}
            />
          </div>

          <div className="min-h-0 overflow-y-auto">
            {!todos ? (
              <div className="grid place-items-center gap-2 px-3 py-6 text-sm text-muted" role="status">
                {list.failed ? <>
                  <p>待办加载失败</p>
                  <button className="btn btn-soft h-8" onClick={list.retry}>重试</button>
                </> : <LoaderCircle size={18} className="animate-spin text-faint" />}
              </div>
            ) : openTodos.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-faint">{doneTodos.length ? '都做完了' : '还没有待办'}</p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[keepInList]} onDragEnd={onDragEnd}>
                <SortableContext items={openTodos.map((todo) => todo.id)} strategy={verticalListSortingStrategy}>
                  <ul className="p-1">
                    {openTodos.map((todo) => (
                      <OpenTodo key={todo.id} todo={todo} list={list} openInNewTab={openInNewTab} />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}

            {doneTodos.length > 0 && (
              <div className="border-t border-line">
                <div className="flex items-center">
                  <button
                    type="button"
                    className={`flex flex-1 items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted hover:text-fg ${focusRing}`}
                    aria-expanded={showDone}
                    onClick={() => setShowDone(!showDone)}
                  >
                    <ChevronRight size={13} className={`transition-transform ${showDone ? 'rotate-90' : ''}`} />
                    已完成
                    <span className="font-mono text-[11px] text-faint tabular-nums">{doneTodos.length}</span>
                  </button>
                  {showDone && (
                    <button type="button" className={`mr-2 rounded-control px-1.5 py-1 text-xs text-faint hover:text-danger ${focusRing}`} onClick={list.clearDone}>
                      全部清除
                    </button>
                  )}
                </div>
                {showDone && (
                  <ul className="px-1 pb-1">
                    {doneTodos.map((todo) => (
                      <li key={todo.id} className="group/todo relative flex items-start gap-2 rounded-control px-2 py-1.5 hover:bg-fg/4">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked
                          aria-label={todo.text}
                          title="重新打开"
                          className={`mt-px shrink-0 rounded-full text-accent/70 hover:text-accent ${focusRing}`}
                          onClick={() => list.setDone(todo.id, false)}
                        >
                          <CircleCheckBig size={17} strokeWidth={1.75} />
                        </button>
                        <p className="min-w-0 flex-1 text-sm leading-5 text-faint line-through [overflow-wrap:anywhere] pointer-coarse:pr-7">{todo.text}</p>
                        <div className={`absolute top-1 right-1 flex rounded-control bg-surface ${rowActions}`}>
                          <DeleteButton todo={todo} onDelete={list.remove} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function OpenTodo({ todo, list, openInNewTab }: { todo: Todo; list: Todos; openInNewTab: boolean }) {
  // Nothing can be done to a to-do before the local store has given it an id
  const pending = isPendingTodo(todo)
  const [editing, setEditing] = useState(false)
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: todo.id, disabled: pending || editing })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group/todo relative flex items-start gap-2 rounded-control px-2 py-1.5 ${
        isDragging ? 'z-10 bg-surface shadow-card-hover' : editing ? 'bg-fg/4' : 'hover:bg-fg/4'
      } ${pending ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={false}
        aria-label={todo.text}
        title="完成"
        disabled={pending}
        className={`mt-px shrink-0 rounded-full text-faint hover:text-accent ${focusRing}`}
        onClick={() => list.setDone(todo.id, true)}
      >
        <Circle size={17} strokeWidth={1.75} />
      </button>

      {editing ? (
        <EditBox
          text={todo.text}
          onSave={(text) => {
            setEditing(false)
            list.edit(todo.id, text)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <p
            className="min-w-0 flex-1 cursor-text text-sm leading-5 [overflow-wrap:anywhere] pointer-coarse:pr-13"
            title="点击修改"
            onClick={() => !pending && setEditing(true)}
          >
            {linkParts(todo.text).map((part, index) =>
              part.href ? (
                <a
                  key={index}
                  href={part.href}
                  target={openInNewTab ? '_blank' : '_self'}
                  rel="noreferrer"
                  title={part.href}
                  className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                  // Opening the address is not a request to reword the to-do
                  onClick={(event) => event.stopPropagation()}
                >
                  {linkLabel(part.href)}
                </a>
              ) : (
                part.text
              ),
            )}
          </p>
          {!pending && (
            <div className={`absolute top-1 right-1 flex rounded-control bg-surface ${isDragging ? '' : rowActions}`}>
              <button
                type="button"
                className="icon-btn-sm size-6 cursor-grab touch-none active:cursor-grabbing"
                aria-label={`拖动排序「${todo.text}」`}
                {...attributes}
                {...listeners}
              >
                <GripVertical size={13} />
              </button>
              <DeleteButton todo={todo} onDelete={list.remove} />
            </div>
          )}
        </>
      )}
    </li>
  )
}

function DeleteButton({ todo, onDelete }: { todo: Todo; onDelete: (id: number) => void }) {
  return (
    <button type="button" className="icon-btn-sm size-6 hover:!bg-danger/10 hover:!text-danger" aria-label={`删除「${todo.text}」`} onClick={() => onDelete(todo.id)}>
      <X size={13} />
    </button>
  )
}

/** Rewords a to-do in place. Enter or leaving the box saves, Escape keeps the old wording */
function EditBox({ text, onSave, onCancel }: { text: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(text)
  const box = useRef<HTMLTextAreaElement>(null)
  // Saving unmounts the box, which can blur it and ask to save a second time
  const settled = useRef(false)

  // Grows with the text, so that a long to-do wraps the same way it does when it is only shown
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [value])

  useEffect(() => {
    const element = box.current
    element?.focus()
    element?.setSelectionRange(element.value.length, element.value.length)
  }, [])

  const finish = (save: boolean) => {
    if (settled.current) return
    settled.current = true
    const next = value.trim()
    // An emptied box means "never mind", not "delete"
    if (save && next && next !== text) onSave(next)
    else onCancel()
  }

  return (
    <textarea
      ref={box}
      rows={1}
      className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-sm leading-5 outline-none"
      aria-label="修改待办"
      maxLength={MAX_TODO_LENGTH}
      value={value}
      // A to-do is one line, however it wraps
      onChange={(event) => setValue(event.target.value.replace(/\s*\n\s*/g, ' '))}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (isEnter(event)) {
          event.preventDefault()
          finish(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(false)
        }
      }}
    />
  )
}
