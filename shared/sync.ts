import { clickCountsOf, mergeClickCounts, parseClickCounts, totalClicks, type ClickCounts } from './counters'
import { isLayoutColumns, MAX_SITE_NAME_LENGTH, DEFAULT_SETTINGS, type SystemSettings } from './settings'
import { isView, MAX_TODO_LENGTH, type View } from './types'
import { parseBookmarkUrl } from './url'

/**
 * A sync snapshot is a flattened copy of the local database: every row carries its
 * stable syncId, and parents are referenced by syncId instead of by the local
 * auto-increment id that only exists inside one browser profile.
 *
 * Two kinds of local state are deliberately left out:
 * - icon data and `iconVersion`, which describe this device's own icon cache;
 * - the sync configuration, which contains the endpoint and its token.
 */
export const SNAPSHOT_FORMAT = '77bookmarks-sync'
export const SNAPSHOT_VERSION = 1

/**
 * The first desktop and its default group use fixed identities, so two fresh installs
 * describe the same records and merge into one desktop instead of two. They are seeded
 * with createdAt/updatedAt = 0, meaning "never touched by the user", so a real edit or
 * a seeded value from another device always wins over them.
 */
export const DEFAULT_DESKTOP_SYNC_ID = 'd-default'
export const DEFAULT_GROUP_SYNC_ID = 'g-default'
export const SEEDED_AT = 0

export const DEFAULT_DESKTOP_NAME = '主桌面'
export const DEFAULT_GROUP_NAME = '默认'

export interface SyncRow {
  syncId: string
  createdAt: number
  updatedAt: number
  position: number
}

export interface SyncDesktop extends SyncRow {
  name: string
  view: View
}

export interface SyncGroup extends SyncRow {
  desktopSyncId: string
  name: string
  pinned: boolean
}

export interface SyncSite extends SyncRow {
  groupSyncId: string
  origin: string
  title: string
  /** Address of a custom icon; the image itself stays on this device */
  iconUrl: string | null
  clicks: number
  clickCounts?: ClickCounts
  lastClickedAt: number | null
}

export interface SyncLink extends SyncRow {
  siteSyncId: string
  path: string
  title: string
  clicks: number
  clickCounts?: ClickCounts
  lastClickedAt: number | null
}

export interface SyncTodo extends SyncRow {
  text: string
  doneAt: number | null
}

export interface SyncSettings {
  value: SystemSettings
  updatedAt: number
}

export interface SyncSnapshot {
  format: typeof SNAPSHOT_FORMAT
  version: typeof SNAPSHOT_VERSION
  /** Which device wrote this snapshot; diagnostics only */
  deviceId: string
  updatedAt: number
  /** When click counting started, merged as the earliest value */
  since: number
  settings: SyncSettings
  desktops: SyncDesktop[]
  groups: SyncGroup[]
  sites: SyncSite[]
  links: SyncLink[]
  todos: SyncTodo[]
}

export interface MergeStats {
  /** Rows only the other side had */
  added: number
  /** Rows the other side changed here */
  updated: number
  /** Rows dropped here because the other side deleted them */
  deleted: number
  /** Rows kept against a delete, or where both sides changed the same field */
  conflicts: number
}

export interface MergeResult {
  snapshot: SyncSnapshot
  stats: MergeStats
}

/** Upload safety limit, shared by both transports and the worker */
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024

const LIMITS = { desktops: 100, groups: 2000, sites: 20000, links: 50000, todos: 5000, name: 200 }
const SYNC_ID = /^[a-z0-9-]{1,100}$/i
const COUNTERS = new Set(['clicks', 'clickCounts', 'lastClickedAt'])

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function stamp(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function moment(value: unknown): number | null {
  return value === null || value === undefined ? null : stamp(value)
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function syncId(value: unknown): string | null {
  return typeof value === 'string' && SYNC_ID.test(value) ? value : null
}

function row(input: Record<string, unknown>): SyncRow | null {
  const id = syncId(input.syncId)
  if (!id) return null
  return { syncId: id, createdAt: stamp(input.createdAt), updatedAt: stamp(input.updatedAt), position: typeof input.position === 'number' && Number.isSafeInteger(input.position) ? input.position : 0 }
}

function list(input: unknown, max: number): Record<string, unknown>[] {
  return Array.isArray(input) ? input.filter(isObject).slice(0, max) : []
}

/**
 * Validates a snapshot received from the network before anything uses it. Malformed rows
 * are dropped rather than failing the whole sync, and rows whose parent is missing are
 * dropped too, so a broken or hostile snapshot can never create orphan records.
 */
export function parseSnapshot(input: unknown): SyncSnapshot | null {
  if (!isObject(input) || input.format !== SNAPSHOT_FORMAT || input.version !== SNAPSHOT_VERSION) return null
  for (const key of ['desktops', 'groups', 'sites', 'links', 'todos'] as const) {
    if (!Array.isArray(input[key]) || input[key].length > LIMITS[key]) return null
    const ids = new Set<string>()
    for (const item of input[key]) {
      if (!isObject(item) || !syncId(item.syncId) || ids.has(item.syncId as string)) return null
      ids.add(item.syncId as string)
    }
  }
  if (!isObject(input.settings) || !isObject(input.settings.value)) return null
  const settings = input.settings.value
  const siteName = text(settings.siteName, MAX_SITE_NAME_LENGTH)
  if (!siteName || typeof settings.openInNewTab !== 'boolean' || !isLayoutColumns(settings.layoutColumns)) return null
  if (typeof input.since !== 'number' || !Number.isSafeInteger(input.since) || input.since < 0) return null

  const desktops: SyncDesktop[] = []
  for (const item of list(input.desktops, LIMITS.desktops)) {
    const base = row(item)
    const name = text(item.name, LIMITS.name)
    if (!base || !name) continue
    desktops.push({ ...base, name, view: isView(item.view) ? item.view : 'large' })
  }
  const desktopIds = new Set(desktops.map((desktop) => desktop.syncId))

  const groups: SyncGroup[] = []
  const desktopOf = new Map<string, string>()
  for (const item of list(input.groups, LIMITS.groups)) {
    const base = row(item)
    const name = text(item.name, LIMITS.name)
    const parent = syncId(item.desktopSyncId)
    if (!base || !name || !parent || !desktopIds.has(parent)) continue
    groups.push({ ...base, name, desktopSyncId: parent, pinned: item.pinned === true })
    desktopOf.set(base.syncId, parent)
  }

  // A card is unique per desktop, so duplicates are dropped across all groups of one desktop
  const seenOrigins = new Set<string>()
  const sites: SyncSite[] = []
  const siteIds = new Set<string>()
  for (const item of list(input.sites, LIMITS.sites)) {
    const base = row(item)
    if (item.clickCounts !== undefined) {
      const counts = parseClickCounts(item.clickCounts)
      if (!counts || totalClicks(counts) !== count(item.clicks)) return null
    }
    const group = syncId(item.groupSyncId)
    const desktop = group ? desktopOf.get(group) : undefined
    const parsed = typeof item.origin === 'string' ? parseBookmarkUrl(item.origin) : null
    const title = text(item.title, 80)
    if (!base || !group || !desktop || !parsed || !title) continue
    const key = `${desktop}\n${parsed.origin}`
    if (seenOrigins.has(key)) continue
    seenOrigins.add(key)
    siteIds.add(base.syncId)
    sites.push({
      ...base, groupSyncId: group, origin: parsed.origin, title,
      iconUrl: typeof item.iconUrl === 'string' && item.iconUrl.length <= 2000 ? item.iconUrl : null,
      clicks: count(item.clicks), clickCounts: parseClickCounts(item.clickCounts) ?? clickCountsOf({ clicks: count(item.clicks) }), lastClickedAt: moment(item.lastClickedAt),
    })
  }

  const seenPaths = new Set<string>()
  const links: SyncLink[] = []
  for (const item of list(input.links, LIMITS.links)) {
    const base = row(item)
    const parent = syncId(item.siteSyncId)
    if (item.clickCounts !== undefined) {
      const counts = parseClickCounts(item.clickCounts)
      if (!counts || totalClicks(counts) !== count(item.clicks)) return null
    }
    const path = typeof item.path === 'string' && item.path.startsWith('/') && item.path.length <= 2000 ? item.path : null
    const title = text(item.title, 80)
    if (!base || !parent || !siteIds.has(parent) || !path || !title) continue
    const key = `${parent}\n${path}`
    if (seenPaths.has(key)) continue
    seenPaths.add(key)
    links.push({ ...base, siteSyncId: parent, path, title, clicks: count(item.clicks), clickCounts: parseClickCounts(item.clickCounts) ?? clickCountsOf({ clicks: count(item.clicks) }), lastClickedAt: moment(item.lastClickedAt) })
  }

  const todos: SyncTodo[] = []
  for (const item of list(input.todos, LIMITS.todos)) {
    const base = row(item)
    const value = text(item.text, MAX_TODO_LENGTH)
    if (!base || !value) continue
    todos.push({ ...base, text: value, doneAt: moment(item.doneAt) })
  }

  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    deviceId: syncId(input.deviceId) ?? 'unknown',
    updatedAt: stamp(input.updatedAt),
    since: input.since,
    settings: {
      value: { siteName, openInNewTab: settings.openInNewTab, layoutColumns: settings.layoutColumns },
      updatedAt: stamp(input.settings.updatedAt),
    },
    desktops, groups, sites, links, todos,
  }
}

export function emptySnapshot(deviceId: string, since: number, settings: SystemSettings = DEFAULT_SETTINGS): SyncSnapshot {
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    deviceId,
    updatedAt: Date.now(),
    since,
    settings: { value: settings, updatedAt: SEEDED_AT },
    desktops: [], groups: [], sites: [], links: [], todos: [],
  }
}

/**
 * Compares two snapshots by content, ignoring the order records happen to be listed in
 * and the snapshot's own timestamp. Used to tell whether the local board still matches
 * the copy this device last synced with.
 */
export function snapshotFingerprint(snapshot: SyncSnapshot): string {
  const rows = <T extends SyncRow>(list: T[]) => [...list].sort((a, b) => (a.syncId < b.syncId ? -1 : a.syncId > b.syncId ? 1 : 0))
  const canonical = (_key: string, value: unknown): unknown => {
    if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
    return value
  }
  return JSON.stringify([
    rows(snapshot.desktops), rows(snapshot.groups), rows(snapshot.sites), rows(snapshot.links), rows(snapshot.todos),
    snapshot.settings, snapshot.since,
  ], canonical)
}

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Content of a row, ignoring the modification timestamp and the click counters.
 * Used to answer "did the user change anything here since the last sync", so that a
 * click or a locally cached icon can neither resurrect a deleted record nor count as
 * an edit.
 */
function content(value: SyncRow): string {
  const { updatedAt, clicks, clickCounts, lastClickedAt, ...rest } = value as SyncRow & { clicks?: number; clickCounts?: ClickCounts; lastClickedAt?: number | null }
  void updatedAt
  void clicks
  void clickCounts
  void lastClickedAt
  return JSON.stringify(rest)
}

function untouched(here: SyncRow, ancestor: SyncRow): boolean {
  return content(here) === content(ancestor)
}

function newest<T extends SyncRow>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  return JSON.stringify(a) <= JSON.stringify(b) ? a : b
}

function index<T extends SyncRow>(rows: T[]): Map<string, T> {
  return new Map(rows.map((entry) => [entry.syncId, entry]))
}

type Counted = SyncRow & { clicks: number; clickCounts?: ClickCounts; lastClickedAt: number | null }

/** Device counters merge by maximum, so a lost upload response cannot double count.
 * Rows without maps are accepted by the pure merge helper; network/local snapshots
 * always carry maps. Imported historical totals share the `history` component.
 */
function mergeCounters(ancestor: Counted | undefined, local: Counted, remote: Counted, firstSync: boolean) {
  const clickCounts = local.clickCounts || remote.clickCounts
    ? mergeClickCounts(clickCountsOf(local), clickCountsOf(remote), ancestor ? clickCountsOf(ancestor) : {})
    : undefined
  const clicks = clickCounts ? totalClicks(clickCounts) : ancestor
    ? Math.max(0, ancestor.clicks + (local.clicks - ancestor.clicks) + (remote.clicks - ancestor.clicks))
    : firstSync ? Math.max(local.clicks, remote.clicks) : local.clicks + remote.clicks
  return {
    clicks,
    ...(clickCounts ? { clickCounts } : {}),
    lastClickedAt: Math.max(local.lastClickedAt ?? 0, remote.lastClickedAt ?? 0, ancestor?.lastClickedAt ?? 0) || null,
  }
}

/**
 * Merges a row present in all three versions: a field only one side changed is taken from
 * that side, so a rename here and a reorder there both survive. A field both sides changed
 * falls back to the row with the newer modification time.
 */
function mergeRow<T extends SyncRow>(ancestor: T, local: T, remote: T): { row: T; conflict: boolean } {
  const winner = newest(local, remote)
  const row = { ...winner } as T
  let conflict = false
  for (const key of Object.keys(winner) as (keyof T)[]) {
    if (key === 'syncId' || key === 'createdAt' || key === 'updatedAt') continue
    const here = local[key]
    const there = remote[key]
    if (same(here, there)) continue
    if (!COUNTERS.has(key as string)) {
      if (same(here, ancestor[key])) { row[key] = there; continue }
      if (same(there, ancestor[key])) { row[key] = here; continue }
      conflict = true
    }
    row[key] = winner[key]
  }
  row.createdAt = Math.min(local.createdAt, remote.createdAt, ancestor.createdAt)
  row.updatedAt = Math.max(local.updatedAt, remote.updatedAt, ancestor.updatedAt)
  if ('clicks' in row) Object.assign(row, mergeCounters(ancestor as unknown as Counted, local as unknown as Counted, remote as unknown as Counted, false))
  return { row, conflict }
}

/** Merges a row both sides created on their own, with no common ancestor */
function mergeNew<T extends SyncRow>(local: T, remote: T, firstSync: boolean): { row: T; conflict: boolean } {
  const winner = newest(local, remote)
  const row = { ...winner } as T
  let conflict = false
  for (const key of Object.keys(winner) as (keyof T)[]) {
    if (same(local[key], remote[key])) continue
    conflict = true
    row[key] = winner[key]
  }
  row.createdAt = Math.min(local.createdAt, remote.createdAt)
  row.updatedAt = winner.updatedAt
  if ('clicks' in row) Object.assign(row, mergeCounters(undefined, local as unknown as Counted, remote as unknown as Counted, firstSync))
  return { row, conflict }
}

function mergeStore<T extends SyncRow>(
  ancestor: Map<string, T> | null,
  local: Map<string, T>,
  remote: Map<string, T>,
  stats: MergeStats,
  firstSync: boolean,
): T[] {
  const merged = new Map<string, T>()
  const ids = new Set([...local.keys(), ...remote.keys(), ...(ancestor?.keys() ?? [])])
  for (const id of ids) {
    const base = ancestor?.get(id)
    const here = local.get(id)
    const there = remote.get(id)
    if (!there) {
      if (!here) continue
      // Only this device knows it
      if (!base) { merged.set(id, here); continue }
      // The other side deleted it and nothing changed here since
      if (untouched(here, base)) { stats.deleted++; continue }
      // Changed here after being deleted there: keep the change rather than lose it
      merged.set(id, here)
      stats.conflicts++
      continue
    }
    if (!here) {
      if (!base) { merged.set(id, there); stats.added++; continue }
      if (untouched(there, base)) { stats.deleted++; continue }
      merged.set(id, there)
      stats.conflicts++
      continue
    }
    if (!base) {
      const { row, conflict } = mergeNew(here, there, firstSync)
      merged.set(id, row)
      if (!same(row, here)) stats.updated++
      if (conflict) stats.conflicts++
      continue
    }
    const { row, conflict } = mergeRow(base, here, there)
    if (conflict) stats.conflicts++
    if (!same(row, here)) stats.updated++
    merged.set(id, row)
  }
  return [...merged.values()]
}

function order<T extends SyncRow>(rows: T[]): T[] {
  return rows.sort((a, b) => a.position - b.position || (a.syncId < b.syncId ? -1 : a.syncId > b.syncId ? 1 : 0))
}

/** Dense positions in the merged order; identical on every device holding the same rows */
function renumber<T extends SyncRow>(rows: T[]): T[] {
  return order(rows).map((row, position) => ({ ...row, position }))
}

function byId<T extends SyncRow>(rows: T[] | undefined): Map<string, T> {
  return index((rows ?? []).map((row) => ({ ...row })))
}

/**
 * Restores the invariants the interface relies on after rows were merged on their own:
 * a card belongs to an existing group of an existing desktop, and a link never outlives
 * its card. A deleted parent is brought back only when a surviving child still needs it,
 * which is the same "a change beats a delete" rule applied per row.
 */
function repair(merged: SyncSnapshot, ancestor: SyncSnapshot | null): SyncSnapshot {
  const baseDesktops = byId(ancestor?.desktops)
  const baseGroups = byId(ancestor?.groups)
  const desktops = byId(merged.desktops)
  const groups = byId(merged.groups)
  const sitesById = byId(merged.sites)
  const baseSites = byId(ancestor?.sites)
  // Adding or editing a sub-link while another device deletes its card preserves
  // the child and the card it needs. Unchanged children were already deleted above.
  for (const link of merged.links) {
    const site = baseSites.get(link.siteSyncId)
    if (!sitesById.has(link.siteSyncId) && site) sitesById.set(site.syncId, site)
  }
  merged.sites = [...sitesById.values()]

  // A deleted parent survives when a card or a changed group still lives inside it
  for (const site of merged.sites) {
    const group = baseGroups.get(site.groupSyncId)
    if (!groups.has(site.groupSyncId) && group) groups.set(group.syncId, group)
  }
  for (const group of groups.values()) {
    const desktop = baseDesktops.get(group.desktopSyncId)
    if (!desktops.has(group.desktopSyncId) && desktop) desktops.set(desktop.syncId, desktop)
  }
  for (const [id, group] of groups) if (!desktops.has(group.desktopSyncId)) groups.delete(id)

  // The interface has no empty state for "no desktop at all"
  if (!desktops.size) {
    desktops.set(DEFAULT_DESKTOP_SYNC_ID, { syncId: DEFAULT_DESKTOP_SYNC_ID, createdAt: SEEDED_AT, updatedAt: SEEDED_AT, position: 0, name: DEFAULT_DESKTOP_NAME, view: 'large' })
    groups.set(DEFAULT_GROUP_SYNC_ID, { syncId: DEFAULT_GROUP_SYNC_ID, createdAt: SEEDED_AT, updatedAt: SEEDED_AT, position: 0, desktopSyncId: DEFAULT_DESKTOP_SYNC_ID, name: DEFAULT_GROUP_NAME, pinned: false })
  }
  const desktopRows = renumber([...desktops.values()])
  const firstDesktop = desktopRows[0].syncId

  // A card whose group is gone needs a home on the same desktop it used to be on
  const fallbackGroup = (): string => {
    const existing = order([...groups.values()].filter((group) => group.desktopSyncId === firstDesktop))[0]
    if (existing) return existing.syncId
    const id = `g-${firstDesktop}`.slice(0, 100)
    groups.set(id, { syncId: id, createdAt: SEEDED_AT, updatedAt: SEEDED_AT, position: 0, desktopSyncId: firstDesktop, name: DEFAULT_GROUP_NAME, pinned: false })
    return id
  }

  // Oldest identity wins when two cards cover the same website on one desktop
  const sites: SyncSite[] = []
  const liveSites = new Map<string, SyncSite>()
  const renamed = new Map<string, string>()
  for (const site of [...merged.sites].sort((a, b) => a.createdAt - b.createdAt || (a.syncId < b.syncId ? -1 : 1))) {
    const copy = { ...site }
    if (!groups.has(copy.groupSyncId)) copy.groupSyncId = fallbackGroup()
    const desktopId = groups.get(copy.groupSyncId)?.desktopSyncId ?? firstDesktop
    const key = `${desktopId}\n${copy.origin}`
    const winner = liveSites.get(key)
    if (winner) {
      if (winner.clickCounts || copy.clickCounts) {
        const counts = { ...clickCountsOf(winner) }
        for (const [device, count] of Object.entries(clickCountsOf(copy))) counts[device] = (counts[device] ?? 0) + count
        winner.clickCounts = counts
      }
      winner.clicks += copy.clicks
      winner.lastClickedAt = Math.max(winner.lastClickedAt ?? 0, copy.lastClickedAt ?? 0) || null
      winner.updatedAt = Math.max(winner.updatedAt, copy.updatedAt)
      renamed.set(copy.syncId, winner.syncId)
      continue
    }
    liveSites.set(key, copy)
    sites.push(copy)
  }

  const liveSiteIds = new Set(sites.map((site) => site.syncId))
  const links: SyncLink[] = []
  const liveLinks = new Map<string, SyncLink>()
  for (const link of [...merged.links].sort((a, b) => a.createdAt - b.createdAt || (a.syncId < b.syncId ? -1 : 1))) {
    const copy = { ...link, siteSyncId: renamed.get(link.siteSyncId) ?? link.siteSyncId }
    if (!liveSiteIds.has(copy.siteSyncId)) continue
    const key = `${copy.siteSyncId}\n${copy.path}`
    const winner = liveLinks.get(key)
    if (winner) {
      if (winner.clickCounts || copy.clickCounts) {
        const counts = { ...clickCountsOf(winner) }
        for (const [device, count] of Object.entries(clickCountsOf(copy))) counts[device] = (counts[device] ?? 0) + count
        winner.clickCounts = counts
      }
      winner.clicks += copy.clicks
      winner.lastClickedAt = Math.max(winner.lastClickedAt ?? 0, copy.lastClickedAt ?? 0) || null
      winner.updatedAt = Math.max(winner.updatedAt, copy.updatedAt)
      continue
    }
    liveLinks.set(key, copy)
    links.push(copy)
  }

  const groupRows = renumber([...groups.values()].filter((group) => desktops.has(group.desktopSyncId)))
  const siteRows: SyncSite[] = []
  for (const group of order(groupRows)) siteRows.push(...renumber(sites.filter((site) => site.groupSyncId === group.syncId)))
  const linkRows: SyncLink[] = []
  for (const site of siteRows) linkRows.push(...renumber(links.filter((link) => link.siteSyncId === site.syncId)))

  return {
    ...merged,
    desktops: desktopRows,
    groups: groupRows,
    sites: siteRows,
    links: linkRows,
    todos: renumber(merged.todos),
  }
}

/**
 * Three-way merge of the local board with the copy stored in the cloud. `ancestor` is the
 * snapshot this device last synced, which is what makes deletions recognisable without
 * keeping tombstones. With no ancestor the merge only adds: nothing is ever deleted on a
 * first sync.
 */
export function mergeSnapshots(ancestor: SyncSnapshot | null, local: SyncSnapshot, remote: SyncSnapshot): MergeResult {
  const stats: MergeStats = { added: 0, updated: 0, deleted: 0, conflicts: 0 }
  const firstSync = ancestor === null
  const merged: SyncSnapshot = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    deviceId: local.deviceId,
    updatedAt: Date.now(),
    since: Math.min(local.since, remote.since, ancestor?.since ?? Number.MAX_SAFE_INTEGER),
    settings: remote.settings.updatedAt > local.settings.updatedAt || (remote.settings.updatedAt === local.settings.updatedAt && JSON.stringify(remote.settings.value) < JSON.stringify(local.settings.value)) ? remote.settings : local.settings,
    desktops: mergeStore(ancestor && byId(ancestor.desktops), byId(local.desktops), byId(remote.desktops), stats, firstSync),
    groups: mergeStore(ancestor && byId(ancestor.groups), byId(local.groups), byId(remote.groups), stats, firstSync),
    sites: mergeStore<SyncSite>(ancestor && byId(ancestor.sites), byId(local.sites), byId(remote.sites), stats, firstSync),
    links: mergeStore<SyncLink>(ancestor && byId(ancestor.links), byId(local.links), byId(remote.links), stats, firstSync),
    todos: mergeStore(ancestor && byId(ancestor.todos), byId(local.todos), byId(remote.todos), stats, firstSync),
  }
  return { snapshot: repair(merged, ancestor), stats }
}
