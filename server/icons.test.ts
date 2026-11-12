import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as setIcon } from '../functions/api/sites/[id]/icon'
import { saveDirectIcon } from './db'
import type { Fn } from './http'
import { testDatabase } from './test-db'

const available = (await testDatabase()) !== null

/** The site answers with an image at the address every site has */
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
    await db
      .prepare('INSERT INTO sites (id, desktop_id, group_id, origin, title, position, created_at) VALUES (1, 1, 1, ?, ?, 0, 0)')
      .bind('https://site1.example', 'Site 1')
      .run()
  })

  afterEach(() => vi.unstubAllGlobals())

  const site = async (id: number) =>
    db.prepare('SELECT icon_version, icon_url FROM sites WHERE id = ?').bind(id).first<{ icon_version: number; icon_url: string | null }>()

  /** An image kept here, as a card that was fetched before had it */
  const storeIcon = async (id: number) => {
    await db.prepare('INSERT INTO icons (site_id, content_type, data) VALUES (?, ?, ?)').bind(id, 'image/png', new Uint8Array([1, 2, 3])).run()
    await db.prepare('UPDATE sites SET icon_version = ? WHERE id = ?').bind(1700000000000, id).run()
  }

  const fetchIcon = async () => {
    const request = new Request('https://bookmarks.example/api/sites/1/icon', { method: 'POST', body: '{}' })
    const context = { request, env: { DB: db }, params: { id: '1' } } as unknown as Parameters<Fn>[0]
    return (await setIcon(context)).json() as Promise<{ ok: boolean; iconUrl: string | null }>
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

  it('takes the address of the site, so that the browser loads the image itself', async () => {
    mockFetch()
    expect(await fetchIcon()).toEqual({ ok: true, iconUrl: 'https://site1.example/favicon.ico' })
    expect(await site(1)).toEqual({ icon_version: 0, icon_url: 'https://site1.example/favicon.ico' })
    expect(await db.prepare('SELECT site_id FROM icons WHERE site_id = 1').first()).toBeNull()
  })
})
