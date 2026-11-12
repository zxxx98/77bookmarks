import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb'
import { DEFAULT_SETTINGS, type SystemSettings } from '../../shared/settings'
import type { View } from '../../shared/types'
import { createSyncId } from './uuid'

export const DATABASE_NAME = '77bookmarks-local'
export const DATABASE_VERSION = 1
export const STORES = ['desktops', 'groups', 'sites', 'links', 'icons', 'todos', 'settings'] as const
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
  iconVersion: number; iconUrl: string | null; clicks: number; lastClickedAt: number | null
}
export interface LinkRow extends Entity { siteId: number; path: string; title: string; clicks: number; lastClickedAt: number | null }
export interface TodoRow extends Entity { text: string; doneAt: number | null }
export interface IconRow { siteId: number; dataUrl: string }
interface SettingsRow { key: string; value: SystemSettings | number }
export interface LocalSchema extends DBSchema {
  desktops: { key: number; value: DesktopRow }
  groups: { key: number; value: GroupRow; indexes: { desktopId: number } }
  sites: { key: number; value: SiteRow; indexes: { desktopId: number; groupId: number; origin: [number, string] } }
  links: { key: number; value: LinkRow; indexes: { siteId: number; path: [number, string] } }
  icons: { key: number; value: IconRow }
  todos: { key: number; value: TodoRow }
  settings: { key: string; value: SettingsRow }
}
export type LocalDatabase = IDBPDatabase<LocalSchema>
export type WriteTransaction = IDBPTransaction<LocalSchema, StoreName[], 'readwrite'>

export function entity(position = 0): Omit<Entity, 'id'> {
  const now = Date.now()
  return { syncId: createSyncId(), createdAt: now, updatedAt: now, position }
}
export function sorted<T extends { position: number; id: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.position - b.position || a.id - b.id)
}
export function changed<T extends Entity>(row: T, patch: Partial<T>): T {
  return { ...row, ...patch, updatedAt: Math.max(Date.now(), row.updatedAt + 1) }
}

export async function openLocalDatabase(name = DATABASE_NAME): Promise<LocalDatabase> {
  const db = await openDB<LocalSchema>(name, DATABASE_VERSION, {
    upgrade(db) {
      // Future schema changes belong in numbered upgrade steps; never clear user data here.
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
    },
    blocking() { db.close() },
  })
  // Initialization is transactional, including concurrent first opens from different tabs.
  const tx = db.transaction(['desktops', 'groups', 'settings'], 'readwrite')
  if (!(await tx.objectStore('settings').get('initialized'))) {
    const desktopId = await tx.objectStore('desktops').add({ ...entity(), name: '主桌面', view: 'large' } as DesktopRow)
    await tx.objectStore('groups').add({ ...entity(), desktopId, name: '默认', pinned: false } as GroupRow)
    await tx.objectStore('settings').put({ key: 'system', value: DEFAULT_SETTINGS })
    await tx.objectStore('settings').put({ key: 'since', value: Date.now() })
    await tx.objectStore('settings').put({ key: 'initialized', value: 1 })
  }
  await tx.done
  return db
}
