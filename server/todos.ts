import type { Todo } from '../shared/types'

/** Position above every open to-do: new and reopened ones go to the top of the list */
const TOP = '(SELECT COALESCE(MIN(position), 1) - 1 FROM todos WHERE done_at IS NULL)'

const toTodo = (row: Record<string, unknown>): Todo => ({
  id: row.id as number,
  text: row.text as string,
  doneAt: (row.done_at as number | null) ?? null,
})

/** Open to-dos in the order they were arranged, then the finished ones, most recently finished first */
export async function listTodos(db: D1Database): Promise<Todo[]> {
  const [open, done] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT id, text, done_at FROM todos WHERE done_at IS NULL ORDER BY position, id'),
    db.prepare('SELECT id, text, done_at FROM todos WHERE done_at IS NOT NULL ORDER BY done_at DESC, id DESC'),
  ])
  return [...open.results, ...done.results].map(toTodo)
}

export async function addTodo(db: D1Database, text: string, now = Date.now()): Promise<Todo> {
  const created = await db.prepare(`INSERT INTO todos (text, position, created_at) VALUES (?, ${TOP}, ?)`).bind(text, now).run()
  return { id: created.meta.last_row_id, text, doneAt: null }
}

/** Changes the text, ticks the to-do off (`done: true`) or reopens it (`done: false`) */
export async function updateTodo(db: D1Database, id: number, patch: { text?: string; done?: boolean }, now = Date.now()): Promise<void> {
  const statements: D1PreparedStatement[] = []
  if (patch.text !== undefined) statements.push(db.prepare('UPDATE todos SET text = ? WHERE id = ?').bind(patch.text, id))
  // The guards keep a repeated request from moving the finish time or the place in the list
  if (patch.done === true) statements.push(db.prepare('UPDATE todos SET done_at = ? WHERE id = ? AND done_at IS NULL').bind(now, id))
  if (patch.done === false) statements.push(db.prepare(`UPDATE todos SET done_at = NULL, position = ${TOP} WHERE id = ? AND done_at IS NOT NULL`).bind(id))
  if (statements.length) await db.batch(statements)
}

export async function deleteTodo(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM todos WHERE id = ?').bind(id).run()
}

export async function clearDoneTodos(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM todos WHERE done_at IS NOT NULL').run()
}

/** Arranges the open to-dos in the given order. Ids of finished or deleted to-dos are ignored */
export async function orderTodos(db: D1Database, ids: number[]): Promise<void> {
  if (!ids.length) return
  await db.batch(ids.map((id, position) => db.prepare('UPDATE todos SET position = ? WHERE id = ? AND done_at IS NULL').bind(position, id)))
}
