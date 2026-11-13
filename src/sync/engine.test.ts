import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SyncSnapshot } from '../../shared/sync'
import { DEFAULT_SETTINGS } from '../../shared/settings'
import { openLocalDatabase, type LocalDatabase } from '../storage/db'
import { LocalService } from '../storage/service'
import { SyncEngine } from './engine'
import { SyncConflictError, type RemoteSnapshot, type SyncTransport } from './types'

/** A stand-in for the cloud that enforces the same version rule as the worker */
class FakeCloud implements SyncTransport {
  version = 0
  snapshot: SyncSnapshot | null = null
  conflict = false
  pulls = 0
  async pull(): Promise<RemoteSnapshot | null> {
    this.pulls++
    return this.snapshot ? { version: String(this.version), snapshot: structuredClone(this.snapshot) } : null
  }
  async push(snapshot: SyncSnapshot, version: string | null): Promise<string> {
    if (this.conflict) {
      this.conflict = false
      throw new SyncConflictError(String(this.version))
    }
    const expected = this.snapshot === null ? null : String(this.version)
    if (version !== expected) throw new SyncConflictError(String(this.version))
    this.snapshot = structuredClone(snapshot)
    this.version++
    return String(this.version)
  }
  async test() {}
}

const CONFIG = { enabled: true, kind: 'worker' as const, endpoint: 'https://sync.example.com', token: 'token', username: '', password: '' }

let databases: LocalDatabase[] = []
let names: string[] = []
async function device() {
  const name = `sync-test-${crypto.randomUUID()}`
  names.push(name)
  const db = await openLocalDatabase(name)
  databases.push(db)
  const service = new LocalService(async () => db)
  await service.updateSyncConfig(CONFIG)
  return { service, engine: new SyncEngine(service, () => cloud) }
}

const cloud = new FakeCloud()

beforeEach(() => {
  cloud.version = 0
  cloud.snapshot = null
  cloud.conflict = false
  cloud.pulls = 0
})
afterEach(async () => {
  for (const db of databases) db.close()
  for (const name of names) await deleteDB(name)
  databases = []
  names = []
})

const sites = async (service: LocalService) => (await service.board()).desktop.groups.flatMap((group) => group.sites)

describe('syncing a board between two devices', () => {
  it('sorts merged click counts and keeps the resulting order after disabling on another device', async () => {
    const a = await device()
    await a.service.addBookmark('https://a.example.com')
    await a.service.addBookmark('https://b.example.com/docs')
    await a.service.updateSettings({ ...DEFAULT_SETTINGS, autoSortByUsage: true })
    await a.engine.run()
    const b = await device()
    await b.engine.run()
    const card = (await sites(b.service))[1]
    await b.service.recordClick({ linkId: card.links[0].id })
    await b.engine.run()
    await a.engine.run()
    expect((await sites(a.service)).map((s) => s.origin)).toEqual(['https://b.example.com', 'https://a.example.com'])
    await a.service.updateSettings(DEFAULT_SETTINGS)
    await a.engine.run()
    await b.engine.run()
    expect((await b.service.settings()).autoSortByUsage).toBe(false)
    const other = (await sites(b.service))[1]
    await b.service.recordClick({ siteId: other.id })
    await b.service.recordClick({ siteId: other.id })
    await b.engine.run()
    await a.engine.run()
    expect((await sites(a.service)).map((s) => s.origin)).toEqual(['https://b.example.com', 'https://a.example.com'])
    const version = cloud.version
    await b.engine.run()
    await a.engine.run()
    expect(cloud.version).toBe(version)
  })

  it('merges a fresh install into the existing cloud board instead of duplicating it', async () => {
    const a = await device()
    await a.service.addBookmark('https://example.com/docs', 0, undefined, '文档')
    await a.service.addTodo('从 A 添加')
    const first = await a.engine.run()
    expect(first.status).toBe('synced')
    expect(cloud.version).toBe(1)

    const b = await device()
    await b.engine.run()
    const board = await b.service.board()
    expect(board.desktops).toHaveLength(1)
    expect(board.desktop.name).toBe('主桌面')
    expect((await sites(b.service)).map((site) => site.origin)).toEqual(['https://example.com'])
    expect((await b.service.todos()).map((todo) => todo.text)).toEqual(['从 A 添加'])
    // The board is taken as it is; the one upload adds this device's own vault records,
    // which may be private spaces for all the cloud can tell
    expect(cloud.version).toBe(2)
    expect(cloud.snapshot!.sites).toHaveLength(1)
    const [mine, merged] = [await a.service.vaultRead(), await b.service.vaultRead()]
    expect(cloud.snapshot!.vault).toEqual(merged)
    expect(merged.salts).toHaveLength(2)
    expect(merged.salts).toContain(mine.salts[0])
    expect(merged.chunks).toMatchObject(mine.chunks)
    expect(Object.keys(merged.chunks).length).toBeGreaterThan(Object.keys(mine.chunks).length)
    await b.engine.run()
    expect(cloud.version).toBe(2)
  })

  it('carries private spaces along as ciphertext, never dropping a record of either device', async () => {
    const { deriveKeys, findSpace, sealSpace } = await import('../../shared/vault')
    const a = await device()
    await a.engine.run()
    const b = await device()
    await b.engine.run()
    await a.engine.run()
    // A space created on each device, and one both know that B then changes
    const vault = await a.service.vaultRead()
    expect(await b.service.vaultRead()).toEqual(vault)
    const text = (value: string) => new TextEncoder().encode(value)
    const keys = (password: string) => deriveKeys(password, vault.salts[0], 2 ** 10)
    await a.service.vaultWrite(await sealSpace(await keys('shared space'), text('first version')))
    await a.engine.run()
    await b.engine.run()
    await a.service.vaultWrite(await sealSpace(await keys('only on a'), text('from a')))
    await b.service.vaultWrite(await sealSpace(await keys('only on b'), text('from b')))
    await b.service.vaultWrite(await sealSpace(await keys('shared space'), text('second version')))
    expect((await a.service.syncStatus()).dirty).toBe(true)
    await a.engine.run()
    await b.engine.run()
    await a.engine.run()
    const merged = await a.service.vaultRead()
    expect(await b.service.vaultRead()).toEqual(merged)
    const read = async (password: string) => new TextDecoder().decode((await findSpace(merged, password, 2 ** 10))!.plain)
    expect(await read('only on a')).toBe('from a')
    expect(await read('only on b')).toBe('from b')
    expect(await read('shared space')).toBe('second version')
    expect(JSON.stringify(cloud.snapshot)).not.toContain('second version')
    expect((await a.service.syncStatus()).dirty).toBe(false)
  })

  it('sends changes both ways and removes what one device deleted', async () => {
    const a = await device()
    await a.service.addBookmark('https://a.example.com')
    await a.engine.run()
    const b = await device()
    await b.engine.run()

    await a.service.addBookmark('https://b.example.com')
    await b.service.addBookmark('https://c.example.com')
    await a.engine.run()
    await b.engine.run()
    await a.engine.run()
    expect((await sites(a.service)).map((site) => site.origin).sort()).toEqual(['https://a.example.com', 'https://b.example.com', 'https://c.example.com'])
    expect((await sites(b.service)).map((site) => site.origin).sort()).toEqual(['https://a.example.com', 'https://b.example.com', 'https://c.example.com'])

    const removed = (await sites(a.service)).find((site) => site.origin === 'https://c.example.com')!
    await a.service.deleteSite(removed.id)
    await a.engine.run()
    await b.engine.run()
    expect((await sites(b.service)).map((site) => site.origin)).not.toContain('https://c.example.com')
    expect((await sites(a.service)).map((site) => site.origin)).not.toContain('https://c.example.com')
  })

  it('adds up clicks that happened on both devices offline', async () => {
    const a = await device()
    const added = await a.service.addBookmark('https://clicks.example.com/docs')
    await a.engine.run()
    const b = await device()
    await b.engine.run()
    const onB = (await sites(b.service))[0]

    await Promise.all([a.service.recordClick({ siteId: added.siteId }), a.service.recordClick({ siteId: added.siteId })])
    await b.service.recordClick({ siteId: onB.id })
    await b.engine.run()
    await a.engine.run()
    expect((await a.service.usage()).sites[0].clicks).toBe(3)
    await b.engine.run()
    expect((await b.service.usage()).sites[0].clicks).toBe(3)
  })

  it('keeps the same card identity when both devices add the same website offline', async () => {
    const a = await device()
    await a.engine.run()
    const b = await device()
    await b.engine.run()
    await Promise.all([a.service.addBookmark('https://same.example.com'), b.service.addBookmark('https://same.example.com')])
    await a.engine.run()
    await b.engine.run()
    expect(await a.service.board().then((board) => board.desktop.groups.flatMap((group) => group.sites))).toHaveLength(1)
    expect(cloud.snapshot?.sites).toHaveLength(1)
  })

  it('syncs todos and settings and never uploads icons or the sync token', async () => {
    const a = await device()
    const added = await a.service.addBookmark('https://icons.example.com')
    await a.service.setIcon(added.siteId, { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' })
    await a.service.addTodo('共享待办')
    await a.service.updateSettings({ siteName: '共享名称', openInNewTab: false, layoutColumns: 2, autoSortByUsage: true })
    await a.engine.run()

    const b = await device()
    await b.engine.run()
    expect((await b.service.settings()).siteName).toBe('共享名称')
    expect((await b.service.settings()).autoSortByUsage).toBe(true)
    expect((await b.service.todos()).map((todo) => todo.text)).toEqual(['共享待办'])
    expect(await b.service.icon((await sites(b.service))[0].id)).toBeNull()
    const uploaded = JSON.stringify(cloud.snapshot)
    expect(uploaded).not.toContain('data:image')
    expect(uploaded).not.toContain('token')
    expect(uploaded).not.toContain('sync.example.com')
  })

  it('retries when another device wrote first and reports failures', async () => {
    const a = await device()
    await a.service.addBookmark('https://retry.example.com')
    cloud.conflict = true
    const outcome = await a.engine.run()
    expect(outcome.status).toBe('synced')
    expect(cloud.pulls).toBe(2)
    expect((await a.service.syncStatus()).state.lastError).toBeNull()

    const b = await device()
    await b.engine.run()
    cloud.snapshot = null
    const broken = new SyncEngine(b.service, () => ({ ...cloud, pull: async () => { throw new Error('网络不可用') }, push: cloud.push.bind(cloud), test: cloud.test.bind(cloud) }))
    await expect(broken.run(true)).rejects.toThrow('网络不可用')
    expect((await b.service.syncStatus()).state.lastError).toBe('网络不可用')
  })

  it('does not recount an upload whose success response was lost, even after another device writes', async () => {
    const a = await device()
    const added = await a.service.addBookmark('https://response-lost.example.com/docs')
    await a.engine.run()
    const b = await device()
    await b.engine.run()
    await a.service.recordClick({ siteId: added.siteId })
    const link = (await a.service.board()).desktop.groups[0].sites[0].links[0]
    await a.service.recordClick({ linkId: link.id })
    const unreliable = new SyncEngine(a.service, () => ({
      pull: cloud.pull.bind(cloud), test: cloud.test.bind(cloud),
      async push(snapshot, version) {
        await cloud.push(snapshot, version)
        throw new Error('上传成功后响应丢失')
      },
    }))
    await expect(unreliable.run()).rejects.toThrow('响应丢失')
    await b.service.addTodo('另一设备更新')
    await b.engine.run()
    await a.engine.run()
    const usage = await a.service.usage()
    expect(usage.sites[0].clicks).toBe(1)
    expect(usage.sites[0].links[0].clicks).toBe(1)
    await a.engine.run()
    expect((await a.service.usage()).sites[0].clicks).toBe(1)
  })

  it('counts independent clicks made before either device first syncs', async () => {
    const a = await device()
    const b = await device()
    const addedA = await a.service.addBookmark('https://fresh-clicks.example.com')
    const addedB = await b.service.addBookmark('https://fresh-clicks.example.com')
    await a.service.recordClick({ siteId: addedA.siteId })
    await b.service.recordClick({ siteId: addedB.siteId })
    await a.engine.run()
    await b.engine.run()
    await a.engine.run()
    expect((await a.service.usage()).sites[0].clicks).toBe(2)
  })

  it('preserves counter identities in a full backup restored on another device', async () => {
    const a = await device()
    const added = await a.service.addBookmark('https://backup-clicks.example.com')
    await a.service.recordClick({ siteId: added.siteId })
    await a.engine.run()
    const backup = await a.service.exportBackup()
    const b = await device()
    await b.service.importBackup(JSON.parse(backup.json), 'replace')
    await b.engine.run()
    expect((await b.service.usage()).sites[0].clicks).toBe(1)
  })

  it('keeps all local data when the cloud file has disappeared', async () => {
    const a = await device()
    await a.service.addBookmark('https://survive.example.com/docs')
    await a.engine.run()
    cloud.snapshot = null
    cloud.version = 0
    await a.engine.run()
    expect(cloud.snapshot!.sites).toHaveLength(1)
    expect(cloud.snapshot!.links).toHaveLength(1)
    expect(await sites(a.service)).toHaveLength(1)
  })

  it('adopts a customized cloud board on a fresh install without restoring its deleted seed', async () => {
    const a = await device()
    const original = (await a.service.board()).desktop.id
    await a.service.createDesktop('我的桌面')
    await a.service.deleteDesktop(original)
    await a.service.addBookmark('https://custom.example.com')
    await a.engine.run()
    const b = await device()
    await b.engine.run()
    const board = await b.service.board()
    expect(board.desktops.map((desktop) => desktop.name)).toEqual(['我的桌面'])
    expect(board.desktop.groups.flatMap((group) => group.sites)).toHaveLength(1)
  })

  it('resets the ancestor when switching servers so unrelated cloud deletions do not remove data', async () => {
    const a = await device()
    await a.service.addBookmark('https://keep.example.com')
    await a.engine.run()
    const other = await device()
    await other.service.addBookmark('https://other.example.com')
    cloud.snapshot = null
    cloud.version = 0
    await other.engine.run()
    await a.service.updateSyncConfig({ endpoint: 'https://other-sync.example.com' })
    expect((await a.service.syncStatus()).synced).toBe(false)
    await a.engine.run()
    expect(cloud.snapshot!.sites.map((site) => site.origin).sort()).toEqual(['https://keep.example.com', 'https://other.example.com'])
  })

  it('retains numeric ids and icon caches when applying remote changes in another desktop', async () => {
    const a = await device()
    const desktop = await a.service.createDesktop('其他桌面')
    const added = await a.service.addBookmark('https://icons.example.com', desktop.id)
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
    await a.service.setIcon(added.siteId, { dataUrl })
    await a.engine.run()
    const b = await device()
    await b.engine.run()
    const onB = (await b.service.board()).desktops.find((row) => row.name === '其他桌面')!
    const siteB = (await b.service.board(onB.id)).desktop.groups[0].sites[0]
    expect(siteB.iconVersion).toBe(0)
    await b.service.updateSite(siteB.id, { title: '远程修改' })
    await b.engine.run()
    await a.engine.run()
    const siteA = (await a.service.board(desktop.id)).desktop.groups[0].sites[0]
    expect(siteA.id).toBe(added.siteId)
    expect(siteA.title).toBe('远程修改')
    expect(await a.service.icon(siteA.id)).toBe(dataUrl)
  })

  it('keeps edits made while an upload is in flight dirty for the next run', async () => {
    const a = await device()
    const engine = new SyncEngine(a.service, () => ({
      pull: cloud.pull.bind(cloud), test: cloud.test.bind(cloud),
      async push(snapshot, version) {
        await a.service.addTodo('上传期间新增')
        return cloud.push(snapshot, version)
      },
    }))
    await engine.run()
    expect((await a.service.syncStatus()).dirty).toBe(true)
    await a.engine.run()
    expect(cloud.snapshot!.todos.map((todo) => todo.text)).toContain('上传期间新增')
    expect((await a.service.syncStatus()).dirty).toBe(false)
  })

  it('does nothing while syncing is off and reports whether there is anything to send', async () => {
    const a = await device()
    await a.service.updateSyncConfig({ enabled: false })
    expect(await a.engine.run()).toEqual({ status: 'disabled' })
    await expect(a.engine.run(true)).rejects.toThrow('启用云同步')
    await a.service.updateSyncConfig(CONFIG)
    // Nothing has been uploaded yet, so the first sync still has work to do
    expect((await a.service.syncStatus()).dirty).toBe(true)
    await a.service.addBookmark('https://dirty.example.com')
    await a.engine.run(true)
    const status = await a.service.syncStatus()
    expect(status.dirty).toBe(false)
    expect(status.synced).toBe(true)
    expect(status.state.lastSyncAt).toBeGreaterThan(0)
  })
})
