/**
 * The stores of the database as the backends that are not IndexedDB need them described:
 * the SQLite file of the self-hosted server and the in-memory board of an unlocked private
 * space. IndexedDB declares the same in `openLocalDatabase`.
 */
export interface StoreSchema {
  /** Property holding the key; `auto` stores get theirs from the database */
  key: string
  auto: boolean
  indexes: Record<string, { paths: string[]; unique?: boolean }>
}

export const SCHEMA: Record<string, StoreSchema> = {
  desktops: { key: 'id', auto: true, indexes: {} },
  groups: { key: 'id', auto: true, indexes: { desktopId: { paths: ['desktopId'] } } },
  sites: { key: 'id', auto: true, indexes: { desktopId: { paths: ['desktopId'] }, groupId: { paths: ['groupId'] }, origin: { paths: ['desktopId', 'origin'], unique: true } } },
  links: { key: 'id', auto: true, indexes: { siteId: { paths: ['siteId'] }, path: { paths: ['siteId', 'path'], unique: true } } },
  icons: { key: 'siteId', auto: false, indexes: {} },
  todos: { key: 'id', auto: true, indexes: {} },
  settings: { key: 'key', auto: false, indexes: {} },
  sync: { key: 'key', auto: false, indexes: {} },
  vault: { key: 'key', auto: false, indexes: {} },
}
