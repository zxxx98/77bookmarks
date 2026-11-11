import { describe, expect, it } from 'vitest'
import type { Group } from '../shared/types'
import { searchBoard } from './search'

const groups: Group[] = [{
  id: 1,
  name: '默认',
  sites: [
    { id: 10, origin: 'https://docs.example', title: 'Docs', iconVersion: 0, iconUrl: null, links: [{ id: 100, path: '/api/reference', title: 'API' }] },
    { id: 11, origin: 'https://mail.example', title: 'Mail', iconVersion: 0, iconUrl: null, links: [] },
  ],
} as Group]

describe('board search', () => {
  it('opens and counts the card itself when the card matches', () => {
    expect(searchBoard(groups, 'mail')).toMatchObject({ firstUrl: 'https://mail.example', firstTarget: { siteId: 11 } })
  })

  it('opens and counts the matching link when only a link matches', () => {
    const result = searchBoard(groups, 'reference')
    expect(result).toMatchObject({ firstUrl: 'https://docs.example/api/reference', firstTarget: { linkId: 100 } })
    expect([...result.matchedLinks]).toEqual([100])
  })

  it('has nothing to open without a query or a match', () => {
    expect(searchBoard(groups, ' ')).toMatchObject({ firstUrl: null, firstTarget: null })
    expect(searchBoard(groups, 'nothing')).toMatchObject({ firstUrl: null, firstTarget: null, groups: [] })
  })
})
