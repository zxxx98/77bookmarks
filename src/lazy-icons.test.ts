import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { BoardPage, Desktop } from '../shared/types'
import { collectLazyIconCandidates } from './lazy-icons'
import { updateBoardCache } from './board-cache'

describe('collectLazyIconCandidates', () => {
  it('selects only sites with iconVersion === 0 and no iconUrl and not attempted', () => {
    const desktop: Desktop = {
      id: 1,
      name: '测试桌面',
      view: 'large',
      groups: [
        {
          id: 10,
          name: '分组 1',
          pinned: false,
          sites: [
            { id: 101, origin: 'https://site1.com', title: 'Site 1', iconVersion: 0, iconUrl: null, links: [] },
            { id: 102, origin: 'https://site2.com', title: 'Site 2', iconVersion: 12345, iconUrl: null, links: [] },
            { id: 103, origin: 'https://site3.com', title: 'Site 3', iconVersion: 0, iconUrl: 'https://custom.png', links: [] },
            { id: 104, origin: 'https://site4.com', title: 'Site 4', iconVersion: 0, iconUrl: null, links: [] },
            { id: 105, origin: 'https://site5.com', title: 'Site 5', iconVersion: -1, iconUrl: null, links: [] },
          ],
        },
      ],
    }

    const attempted = new Set<number>([104])
    const inFlight = new Set<number>()

    const candidates = collectLazyIconCandidates(desktop, attempted, inFlight)
    expect(candidates).toEqual([101])
  })

  it('updates board cache properly when icon is fetched', () => {
    const client = new QueryClient()
    const page: BoardPage = {
      desktops: [{ id: 1, name: '桌面', view: 'large', groupCount: 1, siteCount: 2 }],
      desktop: {
        id: 1,
        name: '桌面',
        view: 'large',
        groups: [
          {
            id: 10,
            name: '分组',
            pinned: false,
            sites: [
              { id: 101, origin: 'https://site1.com', title: 'Site 1', iconVersion: 0, iconUrl: null, links: [] },
              { id: 102, origin: 'https://site2.com', title: 'Site 2', iconVersion: 0, iconUrl: null, links: [] },
            ],
          },
        ],
      },
    }
    client.setQueryData(['board', 1], page)

    // Simulate success
    const now = 99999
    updateBoardCache(client, (p) => {
      let modified = false
      const groups = p.desktop.groups.map((group) => {
        const sites = group.sites.map((s) => {
          if (s.id === 101) {
            modified = true
            return { ...s, iconVersion: now }
          }
          return s
        })
        return { ...group, sites }
      })
      return modified ? { ...p, desktop: { ...p.desktop, groups } } : p
    })

    const updated = client.getQueryData<BoardPage>(['board', 1])
    expect(updated?.desktop.groups[0].sites.find((s) => s.id === 101)?.iconVersion).toBe(now)
    expect(updated?.desktop.groups[0].sites.find((s) => s.id === 102)?.iconVersion).toBe(0)

    client.clear()
  })
})
