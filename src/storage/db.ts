import type { ClickCounts } from '../../shared/counters'
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb'
import { DEFAULT_SETTINGS, type SystemSettings } from '../../shared/settings'
import { DEFAULT_DESKTOP_NAME, DEFAULT_DESKTOP_SYNC_ID, DEFAULT_GROUP_NAME, DEFAULT_GROUP_SYNC_ID, SEEDED_AT, type SyncSnapshot } from '../../shared/sync'
import type { View } from '../../shared/types'
import { EMPTY_SYNC_CONFIG, EMPTY_SYNC_STATE, type SyncConfig, type SyncState } from '../sync/types'
import { createSyncId } from './uuid'

export const DATABASE_NAME = '77bookmarks-local'
export const DATABASE_VERSION = 2
export const STORES = ['desktops', 'groups', 'sites', 'links', 'icons', 'todos', 'settings'] as const
/** Cloud-sync bookkeeping: kept apart from the data so backups never contain it */
export const SYNC_STORE = 'sync'
export type StoreName = typeof STORES[number]
export interface Entity {
  id: number
  syncId: string
  createdAt: number
  updatedAt: number
  position: number
}
export interface DesktopRow extends Entity { name: string; view: View }
export interface GroupRow extends Entity { desktopId: number; name: string; pinned: boolean }
export interface SiteRow extends Entity {
  desktopId: number; groupId: number; origin: string; title: string
  iconVersion: number; iconUrl: string | null; clicks: number; clickCounts?: ClickCounts; lastClickedAt: number | null
}
export interface LinkRow extends Entity { siteId: number; path: string; title: string; clicks: number; clickCounts?: ClickCounts; lastClickedAt: number | null }
export interface TodoRow extends Entity { text: string; doneAt: number | null }
export interface IconRow { siteId: number; dataUrl: string }
/** `updatedAt` is 0 for settings the user never changed, so a synced value always wins */
export interface SettingsRow { key: string; value: SystemSettings | number; updatedAt?: number }
export type SyncRecord =
  | { key: 'base'; snapshot: SyncSnapshot | null }
  | { key: 'device'; deviceId: string }
  | { key: 'config'; config: SyncConfig }
  | { key: 'state'; state: SyncState }
export interface LocalSchema extends DBSchema {
  desktops: { key: number; value: DesktopRow }
  groups: { key: number; value: GroupRow; indexes: { desktopId: number } }
  sites: { key: number; value: SiteRow; indexes: { desktopId: number; groupId: number; origin: [number, string] } }
  links: { key: number; value: LinkRow; indexes: { siteId: number; path: [number, string] } }
  icons: { key: number; value: IconRow }
  todos: { key: number; value: TodoRow }
  settings: { key: string; value: SettingsRow }
  sync: { key: string; value: SyncRecord }
}
export type LocalDatabase = IDBPDatabase<LocalSchema>
export type WriteTransaction = IDBPTransaction<LocalSchema, StoreName[], 'readwrite'>
export type SyncTransaction = IDBPTransaction<LocalSchema, [...StoreName[], typeof SYNC_STORE], 'readwrite'>

export function entity(position = 0): Omit<Entity, 'id'> {
  const now = Date.now()
  return { syncId: createSyncId(), createdAt: now, updatedAt: now, position }
}
export function sorted<T extends { position: number; syncId: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.position - b.position || (a.syncId < b.syncId ? -1 : a.syncId > b.syncId ? 1 : 0))
}
export function changed<T extends Entity>(row: T, patch: Partial<T>): T {
  return { ...row, ...patch, updatedAt: Math.max(Date.now(), row.updatedAt + 1) }
}

export async function openLocalDatabase(name = DATABASE_NAME): Promise<LocalDatabase> {
  const db = await openDB<LocalSchema>(name, DATABASE_VERSION, {
    upgrade(db, oldVersion) {
      // Future schema changes belong in numbered upgrade steps; never clear user data here.
      if (oldVersion < 1) {
        db.createObjectStore('desktops', { keyPath: 'id', autoIncrement: true })
        const groups = db.createObjectStore('groups', { keyPath: 'id', autoIncrement: true })
        groups.createIndex('desktopId', 'desktopId')
        const sites = db.createObjectStore('sites', { keyPath: 'id', autoIncrement: true })
        sites.createIndex('desktopId', 'desktopId')
        sites.createIndex('groupId', 'groupId')
        sites.createIndex('origin', ['desktopId', 'origin'], { unique: true })
        const links = db.createObjectStore('links', { keyPath: 'id', autoIncrement: true })
        links.createIndex('siteId', 'siteId')
        links.createIndex('path', ['siteId', 'path'], { unique: true })
        db.createObjectStore('icons', { keyPath: 'siteId' })
        db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
        db.createObjectStore('settings', { keyPath: 'key' })
      }
      if (oldVersion < 2) db.createObjectStore('sync', { keyPath: 'key' })
    },
    blocking() { db.close() },
  })
  // Initialization is transactional, including concurrent first opens from different tabs.
  const tx = db.transaction(['desktops', 'groups', 'settings'], 'readwrite')
  if (!(await tx.objectStore('settings').get('initialized'))) {
    const desktopId = await tx.objectStore('desktops').add({
      syncId: DEFAULT_DESKTOP_SYNC_ID, createdAt: SEEDED_AT, updatedAt: SEEDED_AT, position: 0,
      name: DEFAULT_DESKTOP_NAME, view: 'large',
    } as DesktopRow)
    await tx.objectStore('groups').add({
      syncId: DEFAULT_GROUP_SYNC_ID, createdAt: SEEDED_AT, updatedAt: SEEDED_AT, position: 0,
      desktopId, name: DEFAULT_GROUP_NAME, pinned: false,
    } as GroupRow)
    await tx.objectStore('settings').put({ key: 'system', value: DEFAULT_SETTINGS, updatedAt: SEEDED_AT })
    await tx.objectStore('settings').put({ key: 'since', value: Date.now() })
    await tx.objectStore('settings').put({ key: 'initialized', value: 1 })
  }
  await tx.done
  // Cloud sync is off until the user configures it; the device identity is created here
  // so that a snapshot always names the device that wrote it.
  const sync = db.transaction(SYNC_STORE, 'readwrite')
  const store = sync.objectStore('sync')
  if (!(await store.get('device'))) {
    await store.put({ key: 'device', deviceId: createSyncId() })
    await store.put({ key: 'config', config: EMPTY_SYNC_CONFIG })
    await store.put({ key: 'state', state: EMPTY_SYNC_STATE })
    await store.put({ key: 'base', snapshot: null })
  }
  await sync.done
  return db
}
