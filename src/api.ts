import { exportPreferences, restorePreferences } from './preferences'
import type { SystemSettings } from '../shared/settings'
import type { BackupDesktop } from '../shared/backup'
import type { ClickTarget, ImportMode, OrderInput, View } from '../shared/types'
import type { SyncConfig } from './sync/types'
import { rememberSettings } from './settings'
import { call, syncCall } from './storage/client'

/** The UI talks only to this local data boundary; future sync belongs behind it. */
export const api = {
  board: (desktopId = 0) => call('board', desktopId),
  search: (query: string) => call('search', query),
  usage: () => call('usage'),
  settings: () => call('settings').then(rememberSettings),
  updateSettings: (settings: SystemSettings) => call('updateSettings', settings).then(rememberSettings),
  addBookmark: (url: string, desktopId: number, groupId?: number) => call('addBookmark', url, desktopId, groupId),
  order: (order: OrderInput) => call('order', order),
  todos: () => call('todos'),
  addTodo: (text: string) => call('addTodo', text),
  updateTodo: (id: number, patch: { text?: string; done?: boolean }) => call('updateTodo', id, patch),
  deleteTodo: (id: number) => call('deleteTodo', id),
  clearDoneTodos: () => call('clearDoneTodos'),
  orderTodos: (ids: number[]) => call('orderTodos', ids),
  createDesktop: (name: string) => call('createDesktop', name),
  updateDesktop: (id: number, patch: { name?: string; view?: View }) => call('updateDesktop', id, patch),
  deleteDesktop: (id: number) => call('deleteDesktop', id),
  createGroup: (desktopId: number, name: string) => call('createGroup', desktopId, name),
  renameGroup: (id: number, name: string) => call('renameGroup', id, name),
  pinGroup: (id: number, pinned: boolean) => call('pinGroup', id, pinned),
  deleteGroup: (id: number) => call('deleteGroup', id),
  updateSite: (id: number, patch: { title?: string; groupId?: number; desktopId?: number }) => call('updateSite', id, patch),
  deleteSite: (id: number) => call('deleteSite', id),
  setIcon: (id: number, source: { dataUrl?: string; url?: string } = {}) => call('setIcon', id, source),
  removeIcon: (id: number) => call('removeIcon', id),
  icon: (id: number) => call('icon', id),
  renameLink: (id: number, title: string) => call('renameLink', id, title),
  deleteLink: (id: number) => call('deleteLink', id),
  recordClick: (target: ClickTarget) => call('recordClick', target),
  exportBackup: async (desktopId?: number) => {
    const { json, filename } = await call('exportBackup', desktopId)
    const backup = JSON.parse(json)
    if (desktopId === undefined) backup.local.preferences = exportPreferences()
    return { blob: new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), filename }
  },
  importBackup: async (backup: unknown, mode: ImportMode) => {
    const result = await call('importBackup', backup, mode)
    if (mode === 'replace' && backup && typeof backup === 'object' && 'local' in backup) restorePreferences((backup as { local?: { preferences?: unknown } }).local?.preferences)
    return result
  },
  importChrome: (desktop: BackupDesktop) => call('importChrome', desktop),
  // Cloud sync is optional and off until it is configured; no request is made otherwise.
  syncStatus: () => syncCall('status'),
  updateSyncConfig: (patch: Partial<SyncConfig>) => syncCall('configure', patch),
  testSync: (config: SyncConfig) => syncCall('test', config),
  syncNow: () => syncCall('now', true),
}
