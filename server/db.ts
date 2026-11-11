import { isView, type Board, type Desktop, type Group, type Site } from '../shared/types'

export const MAX_ICON_BYTES = 100 * 1024
export const MAX_DESKTOPS = 20
export const DEFAULT_DESKTOP = '主桌面'
const DEFAULT_GROUP = '默认'

export async function loadBoard(db: D1Database): Promise<Board> {
  const [desktopRows, groupRows, siteRows, linkRows] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT id, name, view FROM desktops ORDER BY position, id'),
    db.prepare('SELECT id, desktop_id, name FROM groups ORDER BY position, id'),
    db.prepare('SELECT id, group_id, origin, title, icon_version, icon_url FROM sites ORDER BY position, id'),
    db.prepare('SELECT id, site_id, path, title FROM links ORDER BY position, id'),
  ])

  // The app always shows one desktop, so make sure there is one to show
  if (desktopRows.results.length === 0) {
    await db.prepare('INSERT INTO desktops (name, position, created_at) VALUES (?, 0, ?)').bind(DEFAULT_DESKTOP, Date.now()).run()
    return loadBoard(db)
  }

  const desktops = new Map<number, Desktop>()
  for (const row of desktopRows.results) {
    desktops.set(row.id as number, { id: row.id as number, name: row.name as string, view: isView(row.view) ? row.view : 'large', groups: [] })
  }
  const groups = new Map<number, Group>()
  for (const row of groupRows.results) {
    const group: Group = { id: row.id as number, name: row.name as string, sites: [] }
    groups.set(group.id, group)
    desktops.get(row.desktop_id as number)?.groups.push(group)
  }
  const sites = new Map<number, Site>()
  for (const row of siteRows.results) {
    const site: Site = {
      id: row.id as number,
      origin: row.origin as string,
      title: row.title as string,
      iconVersion: row.icon_version as number,
      iconUrl: (row.icon_url as string | null) ?? null,
      links: [],
    }
    sites.set(site.id, site)
    groups.get(row.group_id as number)?.sites.push(site)
  }
  for (const row of linkRows.results) {
    sites.get(row.site_id as number)?.links.push({
      id: row.id as number,
      path: row.path as string,
      title: row.title as string,
    })
  }
  return { desktops: [...desktops.values()] }
}

const PARENT_COLUMN = { desktops: null, groups: 'desktop_id', sites: 'group_id', links: 'site_id' } as const

/** Position that puts a new row after its siblings */
export async function nextPosition(db: D1Database, table: keyof typeof PARENT_COLUMN, parentId?: number): Promise<number> {
  const column = PARENT_COLUMN[table]
  const statement = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM ${table}${column ? ` WHERE ${column} = ?` : ''}`)
  const row = await (column ? statement.bind(parentId) : statement).first<{ next: number }>()
  return row?.next ?? 0
}

/** The requested desktop if it exists, otherwise the first one */
export async function resolveDesktopId(db: D1Database, requested: unknown): Promise<number | null> {
  if (Number.isInteger(requested)) {
    const desktop = await db.prepare('SELECT id FROM desktops WHERE id = ?').bind(requested).first<{ id: number }>()
    if (desktop) return desktop.id
  }
  const first = await db.prepare('SELECT id FROM desktops ORDER BY position, id LIMIT 1').first<{ id: number }>()
  return first?.id ?? null
}

/** The first group of a desktop, created when the desktop has none */
export async function firstGroupId(db: D1Database, desktopId: number): Promise<number> {
  const first = await db.prepare('SELECT id FROM groups WHERE desktop_id = ? ORDER BY position, id LIMIT 1').bind(desktopId).first<{ id: number }>()
  if (first) return first.id
  const created = await db
    .prepare('INSERT INTO groups (desktop_id, name, position, created_at) VALUES (?, ?, 0, ?)')
    .bind(desktopId, DEFAULT_GROUP, Date.now())
    .run()
  return created.meta.last_row_id
}

/** Stores an icon and makes it the one shown, replacing any custom icon address */
export async function saveIcon(db: D1Database, siteId: number, contentType: string, data: ArrayBuffer): Promise<void> {
  await db.batch([
    db.prepare('INSERT OR REPLACE INTO icons (site_id, content_type, data) VALUES (?, ?, ?)').bind(siteId, contentType, data),
    db.prepare('UPDATE sites SET icon_version = ?, icon_url = NULL WHERE id = ?').bind(Date.now(), siteId),
  ])
}

/** D1 returns BLOB columns as number arrays */
export function blobBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return Uint8Array.from(value as number[])
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function fromBase64(data: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}
