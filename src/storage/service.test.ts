import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteDB } from 'idb'
import { openLocalDatabase, type LocalDatabase } from './db'
import { LocalService } from './service'
import { DEFAULT_SETTINGS } from '../../shared/settings'

const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
let db: LocalDatabase
let service: LocalService
let name: string
beforeEach(async () => {
  name = `bookmarks-test-${crypto.randomUUID()}`
  db = await openLocalDatabase(name)
  service = new LocalService(async () => db)
})
afterEach(async () => { db.close(); await deleteDB(name); vi.unstubAllGlobals() })
const boardSites = async () => (await service.board()).desktop.groups.flatMap((g) => g.sites)
const fixture = (title = 'Example') => ({ version: 2, desktops: [{ name: '导入', view: 'small', groups: [{ name: '文档', pinned: true, sites: [{ origin: 'https://example.com', title, icon: { type: 'image/png', data: ICON.split(',')[1] }, links: [{ path: '/docs', title: 'Docs' }] }] }] }] })

describe('local database persistence and atomicity', () => {
  it('initializes only once even with simultaneous connections and keeps records on reopen', async () => {
    await service.addBookmark('https://example.com')
    const [a, b] = await Promise.all([openLocalDatabase(name), openLocalDatabase(name)])
    expect(await a.count('desktops')).toBe(1)
    expect(await b.count('groups')).toBe(1)
    expect((await new LocalService(async () => a).board()).desktop.groups[0].sites).toHaveLength(1)
    a.close(); b.close()
  })
  it('deduplicates concurrent additions, counts concurrent clicks and shares data between service instances', async () => {
    const other = new LocalService(async () => db)
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? service : other).addBookmark('https://example.com/docs?utm_source=test')))
    expect(results.filter((r) => r.result === 'site_created')).toHaveLength(1)
    const site = (await boardSites())[0]
    expect(site.links).toHaveLength(1)
    await Promise.all(Array.from({ length: 20 }, () => other.recordClick({ linkId: site.links[0].id })))
    expect((await service.usage()).sites[0].links[0].clicks).toBe(20)
  })
  it('performs all operations without network access', async () => {
    const fetchMock = vi.fn(() => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetchMock)
    await service.addBookmark('http://localhost:3000/project', 1, undefined, '内网文档')
    await service.addTodo('离线待办')
    expect(await service.search('内网')).toEqual([{ desktopId: 1, count: 1 }])
    expect((await service.todos())[0].text).toBe('离线待办')
    await service.exportBackup()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rolls back every write in a transaction if a later step fails', async () => {
    const site = await service.addBookmark('https://example.com')
    await expect(service.updateSite(site.siteId, { title: '不能被保存', groupId: 9999 })).rejects.toThrow('分组不存在')
    expect((await boardSites())[0].title).toBe('example.com')
    const first = (await service.board()).desktop
    const second = await service.createDesktop('第二桌面')
    await expect(service.order({ desktops: [second.id, first.id], sites: [{ groupId: first.groups[0].id, ids: [site.siteId, site.siteId] }] })).rejects.toThrow()
    expect((await service.board()).desktops[0].id).toBe(first.id)
  })
  it('keeps stable sync identities and advances modification timestamps', async () => {
    const { siteId } = await service.addBookmark('https://example.com')
    const before = (await db.get('sites', siteId))!
    await service.updateSite(siteId, { title: 'Example' })
    const after = (await db.get('sites', siteId))!
    expect(after.syncId).toBe(before.syncId)
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt)
    expect(after.createdAt).toBe(before.createdAt)
  })
})

describe('desktops, groups, sorting and cascading deletion', () => {
  it('moves cards across desktops, rejects duplicates, and cleans descendants and icons', async () => {
    const first = (await service.board()).desktop
    const second = await service.createDesktop('工作')
    const { siteId } = await service.addBookmark('https://example.com/docs', first.id)
    await service.setIcon(siteId, { dataUrl: ICON })
    await service.updateSite(siteId, { desktopId: second.id })
    expect((await boardSites())).toHaveLength(0)
    expect((await service.board(second.id)).desktop.groups[0].sites[0].links).toHaveLength(1)
    const duplicate = await service.addBookmark('https://example.com', first.id)
    await expect(service.updateSite(duplicate.siteId, { desktopId: second.id })).rejects.toThrow('目标桌面已有')
    await service.deleteDesktop(second.id)
    expect(await service.icon(siteId)).toBeNull()
    expect(await db.count('links')).toBe(0)
    await expect(service.deleteDesktop(first.id)).rejects.toThrow('至少要保留')
  })
  it('pins and orders groups and prevents dragging a card into another desktop', async () => {
    const first = (await service.board()).desktop
    await service.createGroup(first.id, '置顶')
    const group = (await service.board()).desktop.groups[1]
    await service.pinGroup(group.id, true)
    expect((await service.board()).desktop.groups[0].id).toBe(group.id)
    const { siteId } = await service.addBookmark('https://example.com')
    await service.order({ sites: [{ groupId: group.id, ids: [siteId] }] })
    const second = await service.createDesktop('其他')
    await service.addBookmark('https://other.com', second.id)
    const foreignGroup = (await service.board(second.id)).desktop.groups[0]
    await service.order({ sites: [{ groupId: foreignGroup.id, ids: [siteId] }] })
    expect((await db.get('sites', siteId))?.groupId).toBe(group.id)
    await service.deleteGroup(group.id)
    expect(await db.get('sites', siteId)).toBeUndefined()
  })
  it('enforces desktop limits atomically during concurrent creation', async () => {
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => service.createDesktop(`桌面${i}`)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(19)
    expect(await db.count('desktops')).toBe(20)
  })
})

describe('to-dos and local icons', () => {
  it('orders, completes, restores, edits and clears to-dos without reusing deleted identifiers', async () => {
    const a = await service.addTodo('A')
    const b = await service.addTodo('B')
    await service.orderTodos([a.id, b.id])
    expect((await service.todos()).map((t) => t.text)).toEqual(['A', 'B'])
    await service.updateTodo(a.id, { done: true, text: '完成' })
    expect((await service.todos()).map((t) => t.text)).toEqual(['B', '完成'])
    await service.updateTodo(a.id, { done: false })
    expect((await service.todos())[0].id).toBe(a.id)
    await service.updateTodo(a.id, { done: true })
    await service.clearDoneTodos()
    await service.deleteTodo(b.id)
    expect((await service.addTodo('C')).id).toBeGreaterThan(b.id)
  })
  it('stores uploaded icons offline, validates size and removes icon data', async () => {
    const { siteId } = await service.addBookmark('https://example.com')
    await service.setIcon(siteId, { dataUrl: ICON })
    expect(await service.icon(siteId)).toBe(ICON)
    await expect(service.setIcon(siteId, { dataUrl: 'data:image/png;base64,!' })).rejects.toThrow()
    await expect(service.setIcon(siteId, { dataUrl: `data:image/png;base64,${btoa('a'.repeat(102401))}` })).rejects.toThrow('100 KB')
    expect(await service.icon(siteId)).toBe(ICON)
    await service.removeIcon(siteId)
    expect(await service.icon(siteId)).toBeNull()
    expect((await db.get('sites', siteId))?.iconVersion).toBe(-1)
  })
})

describe('backup compatibility and complete restoration', () => {
  it('imports existing v1/v2 exports including icons, views and pinned groups', async () => {
    const imported = await service.importBackup(fixture(), 'append')
    const page = await service.board(imported.desktopIds[0])
    expect(page.desktop.view).toBe('small')
    expect(page.desktop.groups[0].pinned).toBe(true)
    expect(await service.icon(page.desktop.groups[0].sites[0].id)).toBe(ICON)
    const legacy = { version: 1, groups: [{ name: '旧分组', sites: [] }] }
    const old = await service.importBackup(legacy, 'append')
    expect((await service.board(old.desktopIds[0])).desktop.groups[0].name).toBe('旧分组')
  })
  it('round-trips full backups with statistics, todos, settings, icons and stable identities', async () => {
    await service.importBackup(fixture(), 'replace')
    const site = (await boardSites())[0]
    const todo = await service.addTodo('保存待办')
    await service.updateTodo(todo.id, { done: true })
    await service.updateSettings({ siteName: '我的书签', openInNewTab: false, layoutColumns: 3 })
    await service.recordClick({ siteId: site.id })
    await service.recordClick({ linkId: site.links[0].id })
    const before = JSON.parse((await service.exportBackup()).json)
    expect(before.version).toBe(3)
    await service.importBackup(before, 'replace')
    const after = JSON.parse((await service.exportBackup()).json)
    expect(after.desktops).toEqual(before.desktops)
    expect(after.local).toEqual(before.local)
    expect((await service.usage()).sites[0].links[0].clicks).toBe(1)
    expect((await service.todos())[0].doneAt).not.toBeNull()
    // Auto-increment keys aren't reset by replacement, so stale tabs can't modify new records.
    expect((await boardSites())[0].id).toBeGreaterThan(site.id)
  })
  it('appends a full backup with new identities and preserves existing global settings and todos', async () => {
    await service.addBookmark('https://example.com')
    const backup = JSON.parse((await service.exportBackup()).json)
    const todo = await service.addTodo('保留')
    await service.updateSettings({ ...DEFAULT_SETTINGS, siteName: '保留名称' })
    await service.importBackup(backup, 'append')
    expect((await service.todos())[0].id).toBe(todo.id)
    expect((await service.settings()).siteName).toBe('保留名称')
    expect(new Set((await db.getAll('sites')).map((s) => s.syncId)).size).toBe(2)
  })
  it('rejects malformed full backups or icon data before touching existing records', async () => {
    const { siteId } = await service.addBookmark('https://keep.com')
    const bad = fixture(); bad.desktops[0].groups[0].sites[0].icon.data = '!'
    await expect(service.importBackup(bad, 'replace')).rejects.toThrow()
    const backup = JSON.parse((await service.exportBackup()).json)
    backup.local.todos = [{ text: '坏数据', doneAt: 'yesterday' }]
    await expect(service.importBackup(backup, 'replace')).rejects.toThrow('待办格式')
    expect((await boardSites())[0].id).toBe(siteId)
  })
  it('validates full backup identity uniqueness and leaves existing records untouched', async () => {
    const backup = JSON.parse((await service.exportBackup()).json)
    backup.desktops[0].groups[0].syncId = backup.desktops[0].syncId
    await expect(service.importBackup(backup, 'replace')).rejects.toThrow('标识重复')
    expect((await service.board()).desktop.name).toBe('主桌面')
  })
  it('exports an individual desktop in the compatible v2 format and imports Chrome in one transaction', async () => {
    const imported = await service.importChrome(fixture().desktops[0] as Parameters<LocalService['importChrome']>[0])
    const exported = JSON.parse((await service.exportBackup(imported.desktopIds[0])).json)
    expect(exported.version).toBe(2)
    expect(exported.local).toBeUndefined()
    expect(exported.desktops[0].groups[0].sites[0].syncId).toBeUndefined()
    await service.addTodo('保留待办')
    await service.importBackup(exported, 'replace')
    expect((await service.todos())[0].text).toBe('保留待办')
  })
})
