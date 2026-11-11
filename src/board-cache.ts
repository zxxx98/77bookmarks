import type { QueryClient } from '@tanstack/react-query'
import type { BoardPage } from '../shared/types'

/** Optimistic metadata changes must not make outdated desktop details fresh. */
export function updateBoardCache(client: QueryClient, update: (page: BoardPage) => BoardPage) {
  for (const query of client.getQueryCache().findAll({ queryKey: ['board'] })) {
    const { data, dataUpdatedAt, isInvalidated } = query.state
    if (!data) continue
    const next = update(data as BoardPage)
    if (next === data) continue
    client.setQueryData(query.queryKey, next, { updatedAt: dataUpdatedAt })
    if (isInvalidated) void client.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: 'none' })
  }
}
