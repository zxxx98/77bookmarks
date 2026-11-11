import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { BoardPage } from '../shared/types'
import { updateBoardCache } from './board-cache'

describe('desktop cache updates', () => {
  it('does not hide invalidated details when another desktop changes its view', async () => {
    const client = new QueryClient()
    const page: BoardPage = {
      desktops: [{ id: 1, name: '主桌面', view: 'large', groupCount: 0, siteCount: 0 }],
      desktop: { id: 2, name: '工作', view: 'large', groups: [] },
    }
    client.setQueryData(['board', 2], page, { updatedAt: 100 })
    // A move or import has made the inactive desktop outdated.
    await client.invalidateQueries({ queryKey: ['board'] })
    updateBoardCache(client, (cached) => ({ ...cached, desktops: cached.desktops.map((d) => ({ ...d, view: 'small' })) }))
    expect(client.getQueryData<BoardPage>(['board', 2])?.desktops[0].view).toBe('small')
    expect(client.getQueryState(['board', 2])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['board', 2])?.dataUpdatedAt).toBe(100)
    client.clear()
  })
})
