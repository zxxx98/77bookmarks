import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as directIcons } from '../functions/api/direct-icons'
import { saveDirectIcon } from './db'
import type { Fn } from './http'
import { testDatabase } from './test-db'

const available = (await testDatabase()) !== null

/** The pages of the sites are of no use here, but the icon address is */
function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response('', { status: 200, headers: { 'Content-Type': 'image/png' } })
        : new Response('<html><head><title>Site</title></head></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ),
  )
}

describe.skipIf(!available)('card icons', () => {
  let db: D1Database

  beforeEach(async () => {
    db = (await testDatabase())!
    await db.prepare('INSERT INTO groups (id, desktop_id, name, position, created_at) VALUES (1, 1, ?, 0, 0)').bind('默认').run()
    for (let id = 1; id <= 10; id++) {
      await db
        .prepare('INSERT INTO sites (id, desktop_id, group_id, origin, title, position, created_at) VALUES (?, 1, 1, ?, ?, 0, 0)')
        .bind(id, `https://site${id}.example`, `Site ${id}`)
        .run()
    }
  })

  afterEach(() => vi.unstubAllGlobals())

  const site = async (id: number) =>
    db.prepare('SELECT icon_version, icon_url FROM sites WHERE id = ?').bind(id).first<{ icon_version: number; icon_url: string | null }>()

  /** An image kept here, as a card that was fetched before had it */
  const storeIcon = async (id: number) => {
    await db.prepare('INSERT INTO icons (site_id, content_type, data) VALUES (?, ?, ?)').bind(id, 'image/png', new Uint8Array([1, 2, 3])).run()
    await db.prepare('UPDATE sites SET icon_version = ? WHERE id = ?').bind(1700000000000, id).run()
  }

  it('keeps the address of the site and drops the image stored here', async () => {
    await storeIcon(1)
    await saveDirectIcon(db, 1, 'https://site1.example/icon.png')
    expect(await site(1)).toEqual({ icon_version: 0, icon_url: 'https://site1.example/icon.png' })
    expect(await db.prepare('SELECT site_id FROM icons WHERE site_id = 1').first()).toBeNull()
  })

  it('keeps the image stored here when the site has no address of its own', async () => {
    await storeIcon(1)
    expect((await site(1))?.icon_version).toBeGreaterThan(0)
    expect((await site(1))?.icon_url).toBeNull()
  })

  it('moves the stored icons of every card to the addresses of their sites', async () => {
    mockFetch()
    for (let id = 1; id <= 10; id++) await storeIcon(id)

    const call = async (after: number) => {
      const request = new Request(`https://bookmarks.example/api/direct-icons?after=${after}`, { method: 'POST' })
      const context = { request, env: { DB: db } } as unknown as Parameters<Fn>[0]
      return (await directIcons(context)).json() as Promise<{ checked: number; converted: number; nextAfter: number; done: boolean }>
    }

    const first = await call(0)
    expect(first.checked).toBe(8)
    expect(first.converted).toBe(8)
    expect(first.done).toBe(false)
    expect(await site(1)).toMatchObject({ icon_version: 0, icon_url: 'https://site1.example/favicon.ico' })
    expect((await site(9))?.icon_url).toBeNull()

    const second = await call(first.nextAfter)
    expect(second.checked).toBe(2)
    expect(second.converted).toBe(2)
    expect(second.done).toBe(true)
    expect(await site(10)).toMatchObject({ icon_version: 0, icon_url: 'https://site10.example/favicon.ico' })
  })
})
