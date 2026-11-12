import { describe, expect, it } from 'vitest'
import { applyTodoOp } from '../shared/todos'
import type { Todo } from '../shared/types'
import { isPendingTodo, linkLabel, linkParts } from './todos'

const todo = (id: number, doneAt: number | null = null): Todo => ({ id, text: `T${id}`, doneAt })
const ids = (todos: Todo[]) => todos.map((item) => item.id)

describe('to-dos waiting for the server', () => {
  it('shows a new to-do at once, marked as not stored yet', () => {
    const list = applyTodoOp([todo(1), todo(2, 50)], { type: 'add', tempId: -1, text: 'new' })
    expect(list[0]).toEqual({ id: -1, text: 'new', doneAt: null })
    expect(list.map(isPendingTodo)).toEqual([true, false, false])
  })

  it('keeps a to-do that is still being stored on top while the others are arranged', () => {
    // The request can only name stored to-dos, and the server leaves the new one above them
    expect(ids(applyTodoOp([todo(-1), todo(1), todo(2), todo(3, 50)], { type: 'reorder', ids: [2, 1] }))).toEqual([-1, 2, 1, 3])
  })

  it('leaves the list untouched for a change that no longer applies', () => {
    const list = [todo(1), todo(2, 50)]
    expect(applyTodoOp(list, { type: 'setDone', id: 1, done: false, at: 0 })).toBe(list)
    expect(applyTodoOp(list, { type: 'setDone', id: 2, done: true, at: 99 })).toBe(list)
    expect(applyTodoOp(list, { type: 'setDone', id: 9, done: true, at: 99 })).toBe(list)
  })
})

describe('addresses in a to-do', () => {
  it('leaves plain text alone', () => {
    expect(linkParts('续费域名')).toEqual([{ text: '续费域名' }])
    expect(linkParts('')).toEqual([])
  })

  it('finds an address among the words', () => {
    expect(linkParts('看 https://github.com/a/b/pull/12 的评论')).toEqual([
      { text: '看 ' },
      { text: 'https://github.com/a/b/pull/12', href: 'https://github.com/a/b/pull/12' },
      { text: ' 的评论' },
    ])
  })

  it('finds several addresses, also at the very start and end', () => {
    expect(linkParts('http://a.example 和 https://b.example/x?y=1#z')).toEqual([
      { text: 'http://a.example', href: 'http://a.example' },
      { text: ' 和 ' },
      { text: 'https://b.example/x?y=1#z', href: 'https://b.example/x?y=1#z' },
    ])
  })

  it.each([
    ['读完 https://example.com/post.', 'https://example.com/post', '.'],
    ['(见 https://example.com/a)', 'https://example.com/a', ')'],
    ['https://example.com/a，然后回复', 'https://example.com/a', '，然后回复'],
    ['https://example.com/a?b=1!?', 'https://example.com/a?b=1', '!?'],
    ['「https://example.com/a」', 'https://example.com/a', '」'],
  ])('keeps the punctuation after the address out of it: %s', (text, href, rest) => {
    const parts = linkParts(text)
    expect(parts.find((part) => part.href)).toEqual({ text: href, href })
    expect(parts.at(-1)).toEqual({ text: rest })
  })

  it('keeps brackets that belong to the address', () => {
    const href = 'https://en.wikipedia.org/wiki/Rust_(programming_language)'
    expect(linkParts(`查 ${href}`)).toEqual([{ text: '查 ' }, { text: href, href }])
  })

  it.each(['https://', 'http:// 空的', 'ftp://example.com/file', 'example.com', 'javascript:alert(1)'])('does not make a link of %j', (text) => {
    expect(linkParts(text)).toEqual([{ text }])
  })
})

describe('how an address is shown', () => {
  it.each([
    ['https://github.com/', 'github.com'],
    ['http://www.example.com/a/b', 'example.com/a/b'],
    ['https://docs.example.com/guide?tab=1#top', 'docs.example.com/guide?tab=1#top'],
    ['http://192.168.1.2:5000/admin', '192.168.1.2:5000/admin'],
  ])('drops the scheme of %s', (href, label) => {
    expect(linkLabel(href)).toBe(label)
  })

  it('cuts a long address short', () => {
    const label = linkLabel('https://github.com/anthropics/claude-code/pull/12/files#diff-0123456789')
    expect(label).toBe('github.com/anthropics/claude-co…')
    expect([...label]).toHaveLength(32)
  })

  it('does not cut a character in half', () => {
    expect(linkLabel(`https://example.com/${'😀'.repeat(40)}`)).toBe(`example.com/${'😀'.repeat(19)}…`)
  })
})
