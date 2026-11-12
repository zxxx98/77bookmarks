import { clickCountsOf } from '../../shared/counters'
import { DEFAULT_SETTINGS, type SystemSettings } from '../../shared/settings'
import { SNAPSHOT_FORMAT, SNAPSHOT_VERSION, SEEDED_AT, type SyncSnapshot } from '../../shared/sync'
import { sorted, STORES, type DesktopRow, type GroupRow, type LinkRow, type LocalDatabase, type SettingsRow, type SiteRow, type SyncTransaction, type TodoRow } from './db'

interface LocalRows {
  desktops: DesktopRow[]
  groups: GroupRow[]
  sites: SiteRow[]
  links: LinkRow[]
  todos: TodoRow[]
  settings: SettingsRow[]
}

/** Reads every record of the local database; the cloud copy never contains icons or sync settings */
export async function buildSnapshot(db: LocalDatabase, deviceId: string): Promise<SyncSnapshot> {
  const tx = db.transaction([...STORES], 'readonly')
  const [desktops, groups, sites, links, todos, settings] = await Promise.all([
    tx.objectStore('desktops').getAll(), tx.objectStore('groups').getAll(), tx.objectStore('sites').getAll(),
    tx.objectStore('links').getAll(), tx.objectStore('todos').getAll(), tx.objectStore('settings').getAll(),
  ])
  await tx.done
  return snapshotOf({ desktops, groups, sites, links, todos, settings }, deviceId)
}

export function snapshotOf(rows: LocalRows, deviceId: string): SyncSnapshot {
  const desktopSync = new Map(rows.desktops.map((row) => [row.id, row.syncId]))
  const groupSync = new Map(rows.groups.map((row) => [row.id, row.syncId]))
  const siteSync = new Map(rows.sites.map((row) => [row.id, row.syncId]))
  const system = rows.settings.find((row) => row.key === 'system')
  const since = rows.settings.find((row) => row.key === 'since')?.value
  const meta = (row: { syncId: string; createdAt: number; updatedAt: number; position: number }) =>
    ({ syncId: row.syncId, createdAt: row.createdAt, updatedAt: row.updatedAt, position: row.position })

  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    deviceId,
    updatedAt: Date.now(),
    since: typeof since === 'number' ? since : Date.now(),
    settings: { value: (system?.value as SystemSettings | undefined) ?? DEFAULT_SETTINGS, updatedAt: system?.updatedAt ?? SEEDED_AT },
    desktops: sorted(rows.desktops).map((row) => ({ ...meta(row), name: row.name, view: row.view })),
    groups: sorted(rows.groups)
      .filter((row) => desktopSync.has(row.desktopId))
      .map((row) => ({ ...meta(row), desktopSyncId: desktopSync.get(row.desktopId)!, name: row.name, pinned: row.pinned })),
    sites: sorted(rows.sites)
      .filter((row) => groupSync.has(row.groupId))
      .map((row) => ({
        ...meta(row), groupSyncId: groupSync.get(row.groupId)!, origin: row.origin, title: row.title,
        iconUrl: row.iconUrl, clicks: row.clicks, clickCounts: clickCountsOf(row), lastClickedAt: row.lastClickedAt,
      })),
    links: sorted(rows.links)
      .filter((row) => siteSync.has(row.siteId))
      .map((row) => ({
        ...meta(row), siteSyncId: siteSync.get(row.siteId)!, path: row.path, title: row.title,
        clicks: row.clicks, clickCounts: clickCountsOf(row), lastClickedAt: row.lastClickedAt,
      })),
    todos: sorted(rows.todos).map((row) => ({ ...meta(row), text: row.text, doneAt: row.doneAt })),
  }
}

const syncIds = <T extends { syncId: string }>(rows: T[]) => new Set(rows.map((row) => row.syncId))

/**
 * Writes a merged snapshot back into the local database inside one transaction, so the
 * board is never left half-updated. Local record ids of surviving rows are kept: tabs
 * that are already open hold those ids in their cached board. Records dropped by the
 * merge take their icons, links and cards with them.
 */
export async function applySnapshot(tx: SyncTransaction, snapshot: SyncSnapshot) {
  const [desktops, groups, sites, links, todos] = await Promise.all([
    tx.objectStore('desktops').getAll(), tx.objectStore('groups').getAll(), tx.objectStore('sites').getAll(),
    tx.objectStore('links').getAll(), tx.objectStore('todos').getAll(),
  ])

  // Keep numeric ids and icon caches for surviving identities. Rebuild sites/links to
  // release unique keys before moves (including swapping sites between desktops).
  const existingDesktop = new Map(desktops.map((row) => [row.syncId, row]))
  const existingGroup = new Map(groups.map((row) => [row.syncId, row]))
  const existingSite = new Map(sites.map((row) => [row.syncId, row]))
  const existingLink = new Map(links.map((row) => [row.syncId, row]))
  const existingTodo = new Map(todos.map((row) => [row.syncId, row]))
  const wantedSites = syncIds(snapshot.sites)
  for (const row of sites) if (!wantedSites.has(row.syncId)) await tx.objectStore('icons').delete(row.id)
  for (const store of ['desktops', 'groups', 'sites', 'links', 'todos'] as const) await tx.objectStore(store).clear()

  const desktopId = new Map<string, number>()
  const groupId = new Map<string, number>()
  const groupDesktop = new Map<string, number>()
  const siteId = new Map<string, number>()
  for (const row of snapshot.desktops) {
    const id = existingDesktop.get(row.syncId)?.id
    desktopId.set(row.syncId, await tx.objectStore('desktops').put({ ...row, ...(id === undefined ? {} : { id }) } as DesktopRow))
  }
  for (const { desktopSyncId, ...row } of snapshot.groups) {
    const parentId = desktopId.get(desktopSyncId)
    if (parentId === undefined) throw new Error('同步分组缺少所属桌面')
    const id = existingGroup.get(row.syncId)?.id
    groupId.set(row.syncId, await tx.objectStore('groups').put({ ...row, desktopId: parentId, ...(id === undefined ? {} : { id }) } as GroupRow))
    groupDesktop.set(row.syncId, parentId)
  }
  for (const { groupSyncId, ...row } of snapshot.sites) {
    const parentId = groupId.get(groupSyncId)
    const desktopId = groupDesktop.get(groupSyncId)
    if (parentId === undefined || desktopId === undefined) throw new Error('同步卡片缺少所属分组')
    const existing = existingSite.get(row.syncId)
    const iconChanged = existing && (existing.origin !== row.origin || existing.iconUrl !== row.iconUrl)
    if (iconChanged) await tx.objectStore('icons').delete(existing.id)
    const value = { ...row, groupId: parentId, desktopId, iconVersion: iconChanged ? 0 : existing?.iconVersion ?? 0, ...(existing ? { id: existing.id } : {}) }
    siteId.set(row.syncId, await tx.objectStore('sites').put(value as SiteRow))
  }
  for (const { siteSyncId, ...row } of snapshot.links) {
    const parentId = siteId.get(siteSyncId)
    if (parentId === undefined) throw new Error('同步链接缺少所属卡片')
    const id = existingLink.get(row.syncId)?.id
    await tx.objectStore('links').put({ ...row, siteId: parentId, ...(id === undefined ? {} : { id }) } as LinkRow)
  }
  for (const row of snapshot.todos) {
    const id = existingTodo.get(row.syncId)?.id
    if (id === undefined) await tx.objectStore('todos').add({ ...row } as TodoRow)
    else await tx.objectStore('todos').put({ ...row, id } as TodoRow)
  }

  await tx.objectStore('settings').put({ key: 'system', value: snapshot.settings.value, updatedAt: snapshot.settings.updatedAt })
  await tx.objectStore('settings').put({ key: 'since', value: snapshot.since })
}
