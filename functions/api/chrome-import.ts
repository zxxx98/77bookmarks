import { fail, json, readJson, text, type Fn } from '../../server/http'
import { parseBookmarkUrl } from '../../shared/url'

// A link can need two statements; 20 rows stay within the 50-query Worker limit.
const MAX_BATCH = 20

function positiveId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function position(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

type Row = {
  groupId: number
  origin: string
  title: string
  sitePosition: number
  path: string | null
  linkTitle?: string
  linkPosition?: number
}

function validRow(input: unknown, groupIds: Set<number>): input is Row {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const row = input as Record<string, unknown>
  const parsed = typeof row.origin === 'string' ? parseBookmarkUrl(row.origin) : null
  return positiveId(row.groupId) && groupIds.has(row.groupId)
    && !!parsed && parsed.origin === row.origin && parsed.path === null
    && typeof row.title === 'string' && !!row.title.trim() && row.title.length <= 80
    && position(row.sitePosition)
    && (row.path === null || (typeof row.path === 'string' && row.path.startsWith('/')
      && typeof row.linkTitle === 'string' && !!row.linkTitle.trim() && row.linkTitle.length <= 80
      && position(row.linkPosition)))
}

/** Adds a small batch to a newly created Chrome desktop. Each batch is one D1 transaction. */
export const onRequestPost: Fn = async ({ request, env }) => {
  const body = await readJson(request)
  const desktopId = body?.desktopId
  const items = body?.items
  if (!positiveId(desktopId) || !Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH) {
    return fail(400, '导入批次格式有误')
  }
  const db = env.DB
  const desktop = await db.prepare('SELECT id FROM desktops WHERE id = ?').bind(desktopId).first()
  if (!desktop) return fail(404, '导入桌面不存在')

  if (body?.kind === 'groups') {
    const offset = body.offset
    if (!position(offset) || !items.every((item) => typeof item === 'string' && !!text(item, 40) && item.length <= 40)) {
      return fail(400, '分组批次格式有误')
    }
    const now = Date.now()
    const result = await db.batch(items.map((name, index) => db.prepare('INSERT INTO groups (desktop_id, name, position, created_at) VALUES (?, ?, ?, ?)')
      .bind(desktopId, name.trim(), offset + index, now)))
    return json({ groupIds: result.map((item) => item.meta.last_row_id) })
  }

  if (body?.kind !== 'rows') return fail(400, '未知的导入批次')
  const groups = await db.prepare('SELECT id FROM groups WHERE desktop_id = ?').bind(desktopId).all<{ id: number }>()
  const groupIds = new Set(groups.results.map((group) => group.id))
  if (!items.every((item) => validRow(item, groupIds))) return fail(400, '书签批次格式有误')

  const now = Date.now()
  const statements: D1PreparedStatement[] = []
  for (const row of items as Row[]) {
    statements.push(db.prepare('INSERT OR IGNORE INTO sites (desktop_id, group_id, origin, title, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(desktopId, row.groupId, row.origin, row.title, row.sitePosition, now))
    if (row.path !== null) {
      statements.push(db.prepare('INSERT OR IGNORE INTO links (site_id, path, title, position, created_at) SELECT id, ?, ?, ?, ? FROM sites WHERE desktop_id = ? AND origin = ?')
        .bind(row.path, row.linkTitle, row.linkPosition, now, desktopId, row.origin))
    }
  }
  await db.batch(statements)
  return json({ ok: true })
}
