import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { applyTodoOp, type TodoOp } from '../shared/todos'
import type { Todo } from '../shared/types'
import { api } from './api'
import { useUi } from './ui'

/** A to-do the server hasn't stored yet. It has no real id, so it can't be changed until it does */
export const isPendingTodo = (todo: Todo) => todo.id < 0

function send(op: TodoOp): Promise<unknown> {
  switch (op.type) {
    case 'add':
      return api.addTodo(op.text)
    case 'edit':
      return api.updateTodo(op.id, { text: op.text })
    case 'setDone':
      return api.updateTodo(op.id, { done: op.done })
    case 'remove':
      return api.deleteTodo(op.id)
    case 'reorder':
      return api.orderTodos(op.ids.filter((id) => id > 0))
    case 'clearDone':
      return api.clearDoneTodos()
  }
}

export interface TextPart {
  text: string
  /** Set when this part is a web address */
  href?: string
}

// Stops at whitespace, quotes, angle brackets and CJK punctuation, none of which belong in an address someone typed
const URL_PATTERN = /https?:\/\/[^\s<>"'`，。；：！？、（）【】《》「」]+/g

/** Drops sentence punctuation that follows an address, and a closing bracket the address never opened */
function trimAddress(address: string): string {
  let end = address.length
  while (end > 0) {
    const char = address[end - 1]
    const kept = address.slice(0, end - 1)
    if ('.,;:!?'.includes(char)) end--
    else if (char === ')' && kept.split('(').length <= kept.split(')').length) end--
    else break
  }
  return address.slice(0, end)
}

function isAddress(value: string): boolean {
  try {
    return !!new URL(value).hostname
  } catch {
    return false
  }
}

/** Splits a to-do into plain text and the web addresses in it, so that the addresses can be opened */
export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const href = trimAddress(match[0])
    if (!isAddress(href)) continue
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    parts.push({ text: href, href })
    last = match.index + href.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

const MAX_LINK_LABEL = 32

/** What a to-do shows for an address in it: enough to recognise the page. The link itself keeps the whole address */
export function linkLabel(href: string): string {
  const label = [...href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')]
  return label.length > MAX_LINK_LABEL ? `${label.slice(0, MAX_LINK_LABEL - 1).join('')}…` : label.join('')
}

export const TODOS_KEY = ['todos'] as const
let nextTempId = -1

export interface Todos {
  /** undefined until the list has loaded */
  todos: Todo[] | undefined
  failed: boolean
  retry: () => void
  add: (text: string) => void
  edit: (id: number, text: string) => void
  setDone: (id: number, done: boolean) => void
  remove: (id: number) => void
  /** `ids` are the open to-dos from top to bottom */
  reorder: (ids: number[]) => void
  clearDone: () => void
}

/**
 * The to-do list and the ways to change it. A change shows at once and is then sent to the server;
 * changes are sent one at a time, in the order they were made, so that the server ends up with
 * what is on screen even when they come in quick succession.
 */
export function useTodos(): Todos {
  const queryClient = useQueryClient()
  const { toast } = useUi()
  const query = useQuery({ queryKey: TODOS_KEY, queryFn: api.todos, retry: false })
  const { mutate } = useMutation({
    mutationKey: TODOS_KEY,
    scope: { id: 'todos' },
    mutationFn: send,
    onMutate: async (op: TodoOp) => {
      // A response already on its way would put the list back to what it was before this change
      await queryClient.cancelQueries({ queryKey: TODOS_KEY })
      queryClient.setQueryData<Todo[]>(TODOS_KEY, (todos) => todos && applyTodoOp(todos, op))
    },
    onSuccess: (result, op) => {
      // The stored to-do takes the place of the provisional one, which unlocks its row
      if (op.type === 'add') {
        queryClient.setQueryData<Todo[]>(TODOS_KEY, (todos) => todos?.map((todo) => (todo.id === op.tempId ? (result as Todo) : todo)))
      }
    },
    onError: (error: Error) => toast(error.message, 'error'),
    onSettled: () => {
      // Checks against the server once nothing else is waiting: a refetch in between would briefly undo the later changes
      if (queryClient.isMutating({ mutationKey: TODOS_KEY }) === 1) return queryClient.invalidateQueries({ queryKey: TODOS_KEY })
    },
  })

  const actions = useMemo(
    () => ({
      add: (text: string) => mutate({ type: 'add', tempId: nextTempId--, text }),
      edit: (id: number, text: string) => mutate({ type: 'edit', id, text }),
      setDone: (id: number, done: boolean) => mutate({ type: 'setDone', id, done, at: Date.now() }),
      remove: (id: number) => mutate({ type: 'remove', id }),
      reorder: (ids: number[]) => mutate({ type: 'reorder', ids }),
      clearDone: () => mutate({ type: 'clearDone' }),
    }),
    [mutate],
  )
  return { todos: query.data, failed: query.isError && !query.data, retry: () => void query.refetch(), ...actions }
}
