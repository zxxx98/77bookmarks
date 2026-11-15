import { describe, expect, it } from 'vitest'
import type { BoardPage } from '../shared/types'
import { boardOf, parseSnapshot, SNAPSHOT_MAX_AGE, withBoard } from './snapshot'

const page = (id: number, ids: number[]): BoardPage => ({
  desktops: ids.map((desktop) => ({ id: desktop, name: `桌面 ${desktop}`, view: 'large', groupCount: 0, siteCount: 0 })),
  desktop: { id, name: `桌面 ${id}`, view: 'large', groups: [] },
})

describe('the pages kept from the last visit', () => {
  it('keeps one page per desktop and finds the first desktop when none is asked for', () => {
    let kept = withBoard(null, page(2, [1, 2]), 1000)
    kept = withBoard(kept, page(1, [1, 2]), 2000)
    expect(kept.savedAt).toBe(2000)
    expect(boardOf(kept, 2)?.desktop.id).toBe(2)
    expect(boardOf(kept, 0)?.desktop.id).toBe(1)
    expect(boardOf(kept, 7)).toBeUndefined()
    expect(boardOf(null, 0)).toBeUndefined()
  })
  it('drops the pages of desktops that no longer exist', () => {
    const kept = withBoard(withBoard(null, page(2, [1, 2]), 1000), page(1, [1]), 2000)
    expect(Object.keys(kept.boards)).toEqual(['1'])
  })
  it('keeps the to-do list across a newer page', () => {
    const kept = withBoard({ ...withBoard(null, page(1, [1]), 1000), todos: [{ id: 1, text: '写周报', doneAt: null }] }, page(1, [1]), 2000)
    expect(kept.todos).toHaveLength(1)
  })
  it('reads back what it wrote, and nothing else', () => {
    const kept = withBoard(null, page(1, [1]), 1000)
    expect(parseSnapshot(JSON.stringify(kept), 2000)).toEqual(kept)
    expect(parseSnapshot(JSON.stringify(kept), 1000 + SNAPSHOT_MAX_AGE + 1)).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...kept, version: 0 }), 2000)).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...kept, boards: { 1: { desktops: [] } } }), 2000)).toBeNull()
    expect(parseSnapshot('{not json', 2000)).toBeNull()
    expect(parseSnapshot(null, 2000)).toBeNull()
  })
})
