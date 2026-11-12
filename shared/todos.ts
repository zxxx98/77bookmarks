import type { Todo } from './types'

/** One change to the list, as made on screen and then repeated on the server */
export type TodoOp =
  | { type: 'add'; tempId: number; text: string }
  | { type: 'edit'; id: number; text: string }
  | { type: 'setDone'; id: number; done: boolean; at: number }
  | { type: 'remove'; id: number }
  | { type: 'reorder'; ids: number[] }
  | { type: 'clearDone' }

const isOpen = (todo: Todo) => todo.doneAt === null

/** The list as the server will have it once `op` has gone through: open to-dos first, in order, then the finished ones */
export function applyTodoOp(todos: Todo[], op: TodoOp): Todo[] {
  switch (op.type) {
    case 'add':
      return [{ id: op.tempId, text: op.text, doneAt: null }, ...todos]
    case 'edit':
      return todos.map((todo) => (todo.id === op.id ? { ...todo, text: op.text } : todo))
    case 'setDone': {
      const todo = todos.find((item) => item.id === op.id)
      if (!todo || isOpen(todo) !== op.done) return todos
      const rest = todos.filter((item) => item.id !== op.id)
      // A reopened to-do goes back to the top; a finished one leads the finished ones
      if (!op.done) return [{ ...todo, doneAt: null }, ...rest]
      return [...rest.filter(isOpen), { ...todo, doneAt: op.at }, ...rest.filter((item) => !isOpen(item))]
    }
    case 'remove':
      return todos.filter((todo) => todo.id !== op.id)
    case 'reorder': {
      const open = new Map(todos.filter(isOpen).map((todo) => [todo.id, todo]))
      const arranged = op.ids.flatMap((id) => open.get(id) ?? [])
      // Open to-dos the order doesn't mention are ones just added, which the server keeps on top
      const unmentioned = [...open.values()].filter((todo) => !op.ids.includes(todo.id))
      return [...unmentioned, ...arranged, ...todos.filter((todo) => !isOpen(todo))]
    }
    case 'clearDone':
      return todos.filter(isOpen)
  }
}
