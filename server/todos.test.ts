import { beforeEach, describe, expect, it } from 'vitest'
import { onRequestDelete as clearDone } from '../functions/api/todos/done'
import { onRequestDelete, onRequestPatch } from '../functions/api/todos/[id]'
import { onRequestGet, onRequestPost } from '../functions/api/todos/index'
import { onRequestPut } from '../functions/api/todos/order'
import { applyTodoOp, type TodoOp } from '../shared/todos'
import type { Todo } from '../shared/types'
import type { Fn } from './http'
import { testDatabase } from './test-db'
import { addTodo, clearDoneTodos, deleteTodo, listTodos, orderTodos, updateTodo } from './todos'

const available = (await testDatabase()) !== null

describe.skipIf(!available)('to-do list', () => {
  let db: D1Database
  const texts = async () => (await listTodos(db)).map((todo) => todo.text)
  const open = async () => (await listTodos(db)).filter((todo) => todo.doneAt === null).map((todo) => todo.text)
  /** Adds A, B and C in turn and returns them in that order */
  const seed = async () => [await addTodo(db, 'A'), await addTodo(db, 'B'), await addTodo(db, 'C')]

  beforeEach(async () => {
    db = (await testDatabase())!
  })

  it('starts empty on a database built from the migrations', async () => {
    expect(await listTodos(db)).toEqual([])
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>()
    expect(tables.results.map((table) => table.name)).toEqual(expect.arrayContaining(['access_tokens', 'desktops', 'groups', 'icons', 'links', 'settings', 'sites', 'todos']))
  })

  it('puts each new to-do above the earlier ones', async () => {
    const [a] = await seed()
    expect(a).toEqual({ id: 1, text: 'A', doneAt: null })
    expect(await texts()).toEqual(['C', 'B', 'A'])
  })

  it('lists finished to-dos after the open ones, most recently finished first', async () => {
    const [a, b, c] = await seed()
    await updateTodo(db, a.id, { done: true }, 1000)
    await updateTodo(db, c.id, { done: true }, 2000)
    expect(await listTodos(db)).toEqual([
      { id: b.id, text: 'B', doneAt: null },
      { id: c.id, text: 'C', doneAt: 2000 },
      { id: a.id, text: 'A', doneAt: 1000 },
    ])
  })

  it('returns a reopened to-do to the top of the list', async () => {
    const [a] = await seed()
    await updateTodo(db, a.id, { done: true }, 1000)
    await updateTodo(db, a.id, { done: false })
    expect(await listTodos(db)).toEqual([expect.objectContaining({ text: 'A', doneAt: null }), expect.objectContaining({ text: 'C' }), expect.objectContaining({ text: 'B' })])
  })

  it('ignores a repeated tick or reopen', async () => {
    const [a, b] = await seed()
    await updateTodo(db, a.id, { done: true }, 1000)
    await updateTodo(db, a.id, { done: true }, 9000)
    expect((await listTodos(db)).find((todo) => todo.id === a.id)?.doneAt).toBe(1000)
    // B sits in the middle; reopening an open to-do must not lift it to the top
    await updateTodo(db, b.id, { done: false })
    expect(await open()).toEqual(['C', 'B'])
  })

  it('rewords a to-do without moving it', async () => {
    const [, b] = await seed()
    await updateTodo(db, b.id, { text: 'B2' })
    expect(await texts()).toEqual(['C', 'B2', 'A'])
  })

  it('arranges the open to-dos in the given order', async () => {
    const [a, b, c] = await seed()
    await orderTodos(db, [a.id, c.id, b.id])
    expect(await texts()).toEqual(['A', 'C', 'B'])
    // A to-do added afterwards still lands on top
    await addTodo(db, 'D')
    expect(await texts()).toEqual(['D', 'A', 'C', 'B'])
  })

  it('leaves finished and unknown to-dos alone when arranging', async () => {
    const [a, b, c] = await seed()
    await updateTodo(db, b.id, { done: true }, 1000)
    await orderTodos(db, [a.id, b.id, 999, c.id])
    expect(await listTodos(db)).toEqual([
      { id: a.id, text: 'A', doneAt: null },
      { id: c.id, text: 'C', doneAt: null },
      { id: b.id, text: 'B', doneAt: 1000 },
    ])
    await orderTodos(db, [])
    expect(await open()).toEqual(['A', 'C'])
  })

  it('never hands out the id of a deleted to-do again', async () => {
    const [, , c] = await seed()
    await deleteTodo(db, c.id)
    expect((await addTodo(db, 'D')).id).toBe(c.id + 1)
  })

  it('deletes one to-do, or every finished one', async () => {
    const [a, b, c] = await seed()
    await deleteTodo(db, b.id)
    expect(await texts()).toEqual(['C', 'A'])
    await updateTodo(db, a.id, { done: true })
    await clearDoneTodos(db)
    expect(await listTodos(db)).toEqual([{ id: c.id, text: 'C', doneAt: null }])
  })

  describe('what the screen shows before the server answers', () => {
    /** Does on the server what the page sends for a change it has already drawn */
    const send = async (op: TodoOp) => {
      if (op.type === 'add') await addTodo(db, op.text)
      else if (op.type === 'edit') await updateTodo(db, op.id, { text: op.text })
      else if (op.type === 'setDone') await updateTodo(db, op.id, { done: op.done }, op.at)
      else if (op.type === 'remove') await deleteTodo(db, op.id)
      else if (op.type === 'reorder') await orderTodos(db, op.ids)
      else await clearDoneTodos(db)
    }
    // The ids are the ones the database hands out, so both sides talk about the same to-dos
    const add = (id: number): TodoOp => ({ type: 'add', tempId: id, text: `T${id}` })
    const done = (id: number, at: number): TodoOp => ({ type: 'setDone', id, done: true, at })
    const reopen = (id: number): TodoOp => ({ type: 'setDone', id, done: false, at: 0 })

    it.each<[string, TodoOp[]]>([
      ['adding', [add(1), add(2), add(3)]],
      ['finishing in any order', [add(1), add(2), add(3), done(2, 10), done(3, 20), done(1, 30)]],
      ['reopening', [add(1), add(2), add(3), done(1, 10), done(3, 20), reopen(1), reopen(3)]],
      ['arranging', [add(1), add(2), add(3), add(4), { type: 'reorder', ids: [2, 4, 1, 3] }, add(5)]],
      ['arranging around finished to-dos', [add(1), add(2), add(3), done(2, 10), { type: 'reorder', ids: [1, 3] }, reopen(2), { type: 'reorder', ids: [3, 2, 1] }]],
      ['arranging without the newest to-do', [add(1), add(2), add(3), { type: 'reorder', ids: [1, 2] }]],
      ['rewording and deleting', [add(1), add(2), add(3), { type: 'edit', id: 2, text: 'reworded' }, { type: 'remove', id: 1 }, done(3, 10)]],
      ['clearing', [add(1), add(2), add(3), done(1, 10), done(3, 20), { type: 'clearDone' }, add(4)]],
      ['repeating a tick', [add(1), add(2), done(1, 10), done(1, 99), reopen(2)]],
      ['changing a to-do that is gone', [add(1), add(2), { type: 'remove', id: 1 }, done(1, 10), { type: 'edit', id: 1, text: 'x' }, { type: 'reorder', ids: [1, 2] }]],
    ])('matches the server after %s', async (_name, ops) => {
      let screen: Todo[] = []
      for (const op of ops) {
        screen = applyTodoOp(screen, op)
        await send(op)
      }
      expect(await listTodos(db)).toEqual(screen)
    })
  })

  describe('endpoints', () => {
    const call = async (handler: Fn, options: { method?: string; body?: unknown; id?: string } = {}) => {
      const request = new Request('https://bookmarks.example/api/todos', {
        method: options.method ?? 'POST',
        body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
      })
      const response = await handler({ request, env: { DB: db }, params: { id: options.id } } as unknown as Parameters<Fn>[0])
      return { status: response.status, body: (await response.json()) as any }
    }
    const list = async () => (await call(onRequestGet, { method: 'GET' })).body as Todo[]

    it('adds a trimmed to-do and lists it', async () => {
      expect(await call(onRequestPost, { body: { text: '  续费域名  ' } })).toEqual({ status: 200, body: { id: 1, text: '续费域名', doneAt: null } })
      expect(await list()).toEqual([{ id: 1, text: '续费域名', doneAt: null }])
    })

    it('cuts a to-do off at 200 characters', async () => {
      const { body } = await call(onRequestPost, { body: { text: '长'.repeat(300) } })
      expect(body.text).toBe('长'.repeat(200))
    })

    it.each([{}, { text: '' }, { text: '   ' }, { text: 42 }, 'not json'])('refuses to add %j', async (body) => {
      expect((await call(onRequestPost, { body })).status).toBe(400)
      expect(await list()).toEqual([])
    })

    it('ticks off, rewords and reopens through one route', async () => {
      await call(onRequestPost, { body: { text: 'A' } })
      expect((await call(onRequestPatch, { method: 'PATCH', id: '1', body: { done: true, text: 'A2' } })).status).toBe(200)
      expect(await list()).toEqual([{ id: 1, text: 'A2', doneAt: expect.any(Number) }])
      await call(onRequestPatch, { method: 'PATCH', id: '1', body: { done: false } })
      expect(await list()).toEqual([{ id: 1, text: 'A2', doneAt: null }])
    })

    it.each([
      ['abc', { done: true }],
      ['0', { done: true }],
      ['1', { done: 'yes' }],
      ['1', { text: '  ' }],
      ['1', 'not json'],
    ])('refuses to change to-do %s with %j', async (id, body) => {
      await call(onRequestPost, { body: { text: 'A' } })
      expect((await call(onRequestPatch, { method: 'PATCH', id, body })).status).toBe(400)
      expect(await list()).toEqual([{ id: 1, text: 'A', doneAt: null }])
    })

    it('arranges, deletes and clears', async () => {
      for (const text of ['A', 'B', 'C']) await call(onRequestPost, { body: { text } })
      expect((await call(onRequestPut, { method: 'PUT', body: { ids: [1, 2, 3] } })).status).toBe(200)
      expect((await list()).map((todo) => todo.text)).toEqual(['A', 'B', 'C'])
      expect((await call(onRequestPut, { method: 'PUT', body: { ids: [1, 'x'] } })).status).toBe(400)
      expect((await call(onRequestPut, { method: 'PUT', body: {} })).status).toBe(400)

      await call(onRequestPatch, { method: 'PATCH', id: '1', body: { done: true } })
      await call(onRequestDelete, { method: 'DELETE', id: '2' })
      expect((await call(onRequestDelete, { method: 'DELETE', id: 'x' })).status).toBe(400)
      await call(clearDone, { method: 'DELETE' })
      expect(await list()).toEqual([{ id: 3, text: 'C', doneAt: null }])
    })
  })
})
