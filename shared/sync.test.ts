import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './settings'
import {
  DEFAULT_DESKTOP_SYNC_ID, DEFAULT_GROUP_SYNC_ID, SNAPSHOT_FORMAT, SNAPSHOT_VERSION,
  mergeSnapshots, parseSnapshot, snapshotFingerprint,
  type SyncSnapshot,
} from './sync'

const meta = (syncId: string, updatedAt = 1, createdAt = 1) => ({ syncId, createdAt, updatedAt, position: 0 })
const desktop = (syncId: string, extra: Record<string, unknown> = {}) => ({ ...meta(syncId), name: '桌面', view: 'large' as const, ...extra })
const group = (syncId: string, desktopSyncId: string, extra: Record<string, unknown> = {}) => ({ ...meta(syncId), desktopSyncId, name: '默认', pinned: false, ...extra })
const site = (syncId: string, groupSyncId: string, extra: Record<string, unknown> = {}) => ({
  ...meta(syncId), groupSyncId, origin: 'https://example.com', title: 'example.com', iconUrl: null, clicks: 0, lastClickedAt: null, ...extra,
})
const link = (syncId: string, siteSyncId: string, extra: Record<string, unknown> = {}) => ({
  ...meta(syncId), siteSyncId, path: '/docs', title: 'Docs', clicks: 0, lastClickedAt: null, ...extra,
})
const todo = (syncId: string, extra: Record<string, unknown> = {}) => ({ ...meta(syncId), text: '待办', doneAt: null, ...extra })

function snapshot(parts: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    deviceId: 'device-a',
    updatedAt: 1,
    since: 100,
    settings: { value: DEFAULT_SETTINGS, updatedAt: 0 },
    desktops: [desktop(DEFAULT_DESKTOP_SYNC_ID)],
    groups: [group(DEFAULT_GROUP_SYNC_ID, DEFAULT_DESKTOP_SYNC_ID)],
    sites: [], links: [], todos: [],
    ...parts,
  }
}

const ids = (rows: { syncId: string }[]) => rows.map((row) => row.syncId).sort()

describe('merging a first sync', () => {
  it('adds everything from the cloud and never removes local records', () => {
    const local = snapshot({ sites: [site('s-local', DEFAULT_GROUP_SYNC_ID)] })
    const remote = snapshot({ sites: [site('s-remote', DEFAULT_GROUP_SYNC_ID, { origin: 'https://remote.com' })] })
    const { snapshot: merged, stats } = mergeSnapshots(null, local, remote)
    expect(ids(merged.sites)).toEqual(['s-local', 's-remote'])
    expect(stats.deleted).toBe(0)
    expect(stats.added).toBe(1)
  })
  it('folds two cards for the same website on one desktop into the oldest identity', () => {
    const local = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { createdAt: 5, clicks: 2 })] })
    const remote = snapshot({ sites: [site('s-b', DEFAULT_GROUP_SYNC_ID, { createdAt: 9, clicks: 3 })] })
    const { snapshot: merged } = mergeSnapshots(null, local, remote)
    expect(merged.sites).toHaveLength(1)
    expect(merged.sites[0].syncId).toBe('s-a')
    expect(merged.sites[0].clicks).toBe(5)
  })
  it('keeps the larger click count when the same history may have been copied', () => {
    const local = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { clicks: 7 })] })
    const remote = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { clicks: 7 })] })
    expect(mergeSnapshots(null, local, remote).snapshot.sites[0].clicks).toBe(7)
  })
})

describe('merging after both devices changed something', () => {
  const ancestor = snapshot({
    sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { title: '原名', clicks: 3, lastClickedAt: 10 })],
    links: [link('l-a', 's-a')],
    todos: [todo('t-a', { text: '原待办' })],
  })

  it('keeps a rename here and a reorder there', () => {
    const local = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { title: '新名', updatedAt: 5 })] })
    const remote = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { title: '原名', position: 4, updatedAt: 6 })] })
    const merged = mergeSnapshots(ancestor, local, remote).snapshot
    expect(merged.sites[0]).toMatchObject({ title: '新名', position: 0 })
  })

  it('adds up clicks recorded on both devices', () => {
    const local = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { clicks: 5, lastClickedAt: 20 })] })
    const remote = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { clicks: 4, lastClickedAt: 30 })] })
    expect(mergeSnapshots(ancestor, local, remote).snapshot.sites[0]).toMatchObject({ clicks: 6, lastClickedAt: 30 })
  })

  it('uses the later edit when both devices rename the same card', () => {
    const local = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { title: '这里改的', updatedAt: 5, clicks: 3 })] })
    const remote = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { title: '那边改的', updatedAt: 9, clicks: 3 })] })
    const { snapshot: merged, stats } = mergeSnapshots(ancestor, local, remote)
    expect(merged.sites[0].title).toBe('那边改的')
    expect(stats.conflicts).toBe(1)
  })

  it('deletes what the other side removed and left untouched here', () => {
    const local = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { title: '原名', clicks: 3, lastClickedAt: 10 })], links: [], todos: [todo('t-a', { text: '原待办' })] })
    const { snapshot: merged, stats } = mergeSnapshots(ancestor, local, snapshot())
    expect(merged.links).toHaveLength(0)
    expect(merged.todos).toHaveLength(0)
    expect(stats.deleted).toBe(2)
  })

  it('keeps a record that was edited here after being deleted there', () => {
    const local = snapshot({
      sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { title: '改过的', updatedAt: 5, clicks: 3, lastClickedAt: 10 })],
      links: [link('l-a', 's-a')],
      todos: [todo('t-a', { text: '原待办' })],
    })
    const { snapshot: merged, stats } = mergeSnapshots(ancestor, local, snapshot({ links: [link('l-a', 's-a')], todos: [todo('t-a', { text: '原待办' })] }))
    expect(merged.sites[0].title).toBe('改过的')
    expect(stats.conflicts).toBe(1)
  })

  it('ignores a click when deciding whether a record was edited', () => {
    const local = snapshot({
      sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { title: '原名', clicks: 9, lastClickedAt: 40, updatedAt: 40 })],
      links: [link('l-a', 's-a')], todos: [todo('t-a', { text: '原待办' })],
    })
    const remote = snapshot({ todos: [todo('t-a', { text: '原待办' })] })
    const { snapshot: merged, stats } = mergeSnapshots(ancestor, local, remote)
    expect(merged.sites).toHaveLength(0)
    expect(stats.deleted).toBe(2)
  })

  it('takes the newer settings and the earliest statistics start', () => {
    const local = snapshot({ since: 100, settings: { value: { ...DEFAULT_SETTINGS, siteName: '这里' }, updatedAt: 5 } })
    const remote = snapshot({ since: 60, settings: { value: { ...DEFAULT_SETTINGS, siteName: '那边' }, updatedAt: 9 } })
    const merged = mergeSnapshots(ancestor, local, remote).snapshot
    expect(merged.settings.value.siteName).toBe('那边')
    expect(merged.since).toBe(60)
  })
})

describe('repairing the merged board', () => {
  it('brings back a group the other side deleted when a card still lives in it', () => {
    const ancestor = snapshot({ groups: [group(DEFAULT_GROUP_SYNC_ID, DEFAULT_DESKTOP_SYNC_ID), group('g-two', DEFAULT_DESKTOP_SYNC_ID)] })
    const local = snapshot({ groups: [group(DEFAULT_GROUP_SYNC_ID, DEFAULT_DESKTOP_SYNC_ID), group('g-two', DEFAULT_DESKTOP_SYNC_ID)], sites: [site('s-new', 'g-two')] })
    const remote = snapshot()
    const merged = mergeSnapshots(ancestor, local, remote).snapshot
    expect(ids(merged.groups)).toEqual(['g-default', 'g-two'])
    expect(merged.sites[0].groupSyncId).toBe('g-two')
  })

  it('keeps a new sub-link when the other device deleted its parent card', () => {
    const ancestor = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID)] })
    const local = snapshot({ sites: ancestor.sites, links: [link('l-new', 's-a')] })
    const merged = mergeSnapshots(ancestor, local, snapshot()).snapshot
    expect(merged.sites.map((row) => row.syncId)).toEqual(['s-a'])
    expect(merged.links.map((row) => row.syncId)).toEqual(['l-new'])
  })

  it('resolves identical-time conflicts identically regardless of merge direction', () => {
    const ancestor = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID)] })
    const local = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { title: 'A', updatedAt: 9 })] })
    const remote = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { title: 'B', updatedAt: 9 })] })
    expect(snapshotFingerprint(mergeSnapshots(ancestor, local, remote).snapshot))
      .toBe(snapshotFingerprint(mergeSnapshots(ancestor, remote, local).snapshot))
  })

  it('moves a card whose group is gone into a group that exists', () => {
    const ancestor = snapshot({ groups: [group(DEFAULT_GROUP_SYNC_ID, DEFAULT_DESKTOP_SYNC_ID)] })
    const local = snapshot({ groups: [], sites: [site('s-a', 'g-gone')] })
    const remote = snapshot({ groups: [group(DEFAULT_GROUP_SYNC_ID, DEFAULT_DESKTOP_SYNC_ID)] })
    const merged = mergeSnapshots(ancestor, local, remote).snapshot
    expect(merged.groups.length).toBeGreaterThan(0)
    expect(merged.groups.map((row) => row.syncId)).toContain(merged.sites[0].groupSyncId)
  })

  it('drops links whose card is gone and keeps one desktop at the least', () => {
    const local = snapshot({ desktops: [], groups: [], sites: [], links: [link('l-a', 's-gone')] })
    const merged = mergeSnapshots(snapshot(), local, snapshot()).snapshot
    expect(merged.links).toHaveLength(0)
    expect(merged.desktops).toHaveLength(1)
    expect(merged.groups).toHaveLength(1)
  })

  it('renumbers positions so every device lists the same order', () => {
    const local = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { position: 7 }), site('s-b', DEFAULT_GROUP_SYNC_ID, { origin: 'https://b.com', position: 2 })] })
    const remote = snapshot({ sites: [site('s-c', DEFAULT_GROUP_SYNC_ID, { origin: 'https://c.com', position: 9 })] })
    const once = mergeSnapshots(snapshot(), local, remote).snapshot
    const twice = mergeSnapshots(snapshot(), local, remote).snapshot
    expect(once.sites.map((row) => row.syncId)).toEqual(['s-b', 's-a', 's-c'])
    expect(once.sites.map((row) => row.position)).toEqual([0, 1, 2])
    expect(twice.sites).toEqual(once.sites)
  })

  it('changes nothing when both sides already agree', () => {
    const both = snapshot({ sites: [site('s-a', DEFAULT_GROUP_SYNC_ID)], todos: [todo('t-a')] })
    const { snapshot: merged, stats } = mergeSnapshots(both, both, both)
    expect(merged.sites).toEqual(both.sites)
    expect(stats).toEqual({ added: 0, updated: 0, deleted: 0, conflicts: 0 })
    expect(snapshotFingerprint(merged)).toBe(snapshotFingerprint(both))
  })
})

describe('reading a snapshot from the network', () => {
  it('defaults legacy snapshots to manual sorting and rejects an invalid sorting flag', () => {
    const input = JSON.parse(JSON.stringify(snapshot()))
    delete input.settings.value.autoSortByUsage
    expect(parseSnapshot(input)?.settings.value.autoSortByUsage).toBe(false)
    input.settings.value.autoSortByUsage = 'true'
    expect(parseSnapshot(input)).toBeNull()
  })

  it('rejects anything that is not a snapshot of this format', () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot({ format: 'other', version: 1 })).toBeNull()
    expect(parseSnapshot({ ...snapshot(), version: 99 })).toBeNull()
    expect(parseSnapshot({ ...snapshot(), since: -1 })).toBeNull()
  })
  it('drops records whose parent is missing instead of creating orphans', () => {
    const parsed = parseSnapshot({
      ...snapshot(),
      sites: [site('s-a', 'g-missing'), site('s-b', DEFAULT_GROUP_SYNC_ID, { origin: 'not a url' })],
      links: [link('l-a', 's-missing')],
    })
    expect(parsed?.sites).toHaveLength(0)
    expect(parsed?.links).toHaveLength(0)
  })
  it('keeps the records it understands and normalizes addresses', () => {
    const parsed = parseSnapshot({
      ...snapshot(),
      sites: [site('s-a', DEFAULT_GROUP_SYNC_ID, { origin: 'https://example.com/docs?utm_source=x' })],
    })
    expect(parsed?.sites[0]).toMatchObject({ syncId: 's-a', origin: 'https://example.com' })
  })
})
