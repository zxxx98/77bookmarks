import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstChunkId, deriveKeys } from '../../shared/vault'
import type { LocalService } from '../storage/service'

// The page's side of a private space, against an ordinary board held in memory
const outer = vi.hoisted(() => ({ service: undefined as unknown as LocalService, calls: [] as string[] }))
vi.mock('../platform', () => ({
  platform: {
    call: (method: string, ...args: unknown[]) => {
      outer.calls.push(method)
      return (outer.service as unknown as Record<string, (...values: unknown[]) => Promise<unknown>>)[method](...args)
    },
  },
}))

import { call } from '../storage/client'
import { openMemoryStore } from '../storage/memory'
import { LocalService as Service } from '../storage/service'
import { privateSpace } from './session'

const sites = async () => (await call('board')).desktop.groups.flatMap((group) => group.sites.map((site) => site.origin))
const chunkCount = async () => Object.keys((await outer.service.vaultRead()).chunks).length

beforeEach(async () => {
  privateSpace.lock()
  const store = await openMemoryStore()
  outer.service = new Service(async () => store.local)
  outer.calls = []
})

describe('a private space in the page', () => {
  it('opens nothing for an unknown password and creates a space only when asked', async () => {
    const before = await outer.service.vaultRead()
    expect(await privateSpace.unlock('nothing here yet')).toBe(false)
    expect(privateSpace.active()).toBe(false)
    expect(await outer.service.vaultRead()).toEqual(before)
    await expect(privateSpace.create('short')).rejects.toThrow('至少')
    expect(await outer.service.vaultRead()).toEqual(before)
  })

  it('keeps its bookmarks out of the ordinary board and brings them back after locking', async () => {
    await call('addBookmark', 'https://public.example.com')
    const generation = privateSpace.generation()
    await privateSpace.create('first secret space')
    expect(privateSpace.active()).toBe(true)
    expect(privateSpace.generation()).toBeGreaterThan(generation)
    expect(await sites()).toEqual([])
    await call('addBookmark', 'https://secret.example.com/path', 0, undefined, '私密')
    await call('createDesktop', '第二桌面')
    await call('addTodo', '私密待办')
    expect(await sites()).toEqual(['https://secret.example.com'])
    // Settings stay those of the ordinary board
    expect((await call('settings')).siteName).toBe((await outer.service.settings()).siteName)

    privateSpace.lock()
    expect(await sites()).toEqual(['https://public.example.com'])
    expect(await call('todos')).toEqual([])
    expect(JSON.stringify(await outer.service.exportBackup())).not.toContain('secret.example.com')
    expect(JSON.stringify(await outer.service.snapshot())).not.toContain('secret.example.com')

    expect(await privateSpace.unlock('first secret space')).toBe(true)
    expect(await sites()).toEqual(['https://secret.example.com'])
    expect((await call('board')).desktops.map((desktop) => desktop.name)).toEqual(['主桌面', '第二桌面'])
    expect((await call('todos')).map((todo) => todo.text)).toEqual(['私密待办'])
    expect((await call('board')).desktop.groups[0].sites[0].links[0].title).toBe('私密')
  })

  it('holds several spaces side by side, each behind its own password', async () => {
    await privateSpace.create('password of space one')
    await call('addBookmark', 'https://one.example.com')
    privateSpace.lock()
    await privateSpace.create('password of space two')
    await call('addBookmark', 'https://two.example.com')
    privateSpace.lock()
    expect(await privateSpace.unlock('password of space one')).toBe(true)
    expect(await sites()).toEqual(['https://one.example.com'])
    expect(await privateSpace.unlock('password of space two')).toBe(true)
    expect(await sites()).toEqual(['https://two.example.com'])
    // Creating under a password that is taken opens what is there instead of replacing it
    await privateSpace.create('password of space one')
    expect(await sites()).toEqual(['https://one.example.com'])
  })

  it('moves a space to a new password and refuses one that is taken', async () => {
    await privateSpace.create('password of space one')
    privateSpace.lock()
    await privateSpace.create('the old password')
    await call('addBookmark', 'https://moved.example.com')
    await expect(privateSpace.changePassword('password of space one')).rejects.toThrow('换一个')
    await expect(privateSpace.changePassword('tiny')).rejects.toThrow('至少')
    const before = await chunkCount()
    await privateSpace.changePassword('the new password')
    await call('addBookmark', 'https://after.example.com')
    privateSpace.lock()
    expect(await privateSpace.unlock('the old password')).toBe(false)
    expect(await privateSpace.unlock('the new password')).toBe(true)
    expect(await sites()).toEqual(['https://moved.example.com', 'https://after.example.com'])
    expect(await chunkCount()).toBeGreaterThan(before)
  })

  it('destroys a space without shrinking the vault or touching the others', async () => {
    await privateSpace.create('password of space one')
    await call('addBookmark', 'https://one.example.com')
    privateSpace.lock()
    await privateSpace.create('password to destroy')
    await call('addBookmark', 'https://gone.example.com')
    const before = await chunkCount()
    await privateSpace.destroy()
    expect(privateSpace.active()).toBe(false)
    expect(await chunkCount()).toBe(before)
    expect(await privateSpace.unlock('password to destroy')).toBe(false)
    expect(await privateSpace.unlock('password of space one')).toBe(true)
    expect(await sites()).toEqual(['https://one.example.com'])
  })

  it('locks itself when the same space was saved somewhere else', async () => {
    await privateSpace.create('opened in two tabs')
    const vault = await outer.service.vaultRead()
    const id = firstChunkId(await deriveKeys('opened in two tabs', vault.salts[0]))
    const other = Object.entries(vault.chunks).find(([key]) => key !== id)![1]
    await outer.service.vaultWrite({ [id]: other })
    await expect(call('addBookmark', 'https://lost.example.com')).rejects.toThrow('别处')
    expect(privateSpace.active()).toBe(false)
    expect(privateSpace.takeNotice()).toContain('重新解锁')
    expect(privateSpace.takeNotice()).toBeNull()
  })

  it('sends the server nothing but vault reads and writes while a space is open', async () => {
    await privateSpace.create('what the server sees')
    outer.calls = []
    await call('addBookmark', 'https://secret.example.com')
    await call('board')
    await call('search', 'secret')
    await call('recordClick', { siteId: 1 })
    expect(new Set(outer.calls)).toEqual(new Set(['vaultWrite']))
  })
})
