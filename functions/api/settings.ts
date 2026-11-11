import { fail, json, readJson, type Fn } from '../../server/http'
import { DEFAULT_SITE_NAME, MAX_SITE_NAME_LENGTH, type SystemSettings } from '../../shared/settings'

async function loadSettings(db: D1Database): Promise<SystemSettings> {
  const rows = await db.prepare("SELECT key, value FROM settings WHERE key IN ('site_name', 'open_in_new_tab')").all<{ key: string; value: string }>()
  const values = new Map(rows.results.map((row) => [row.key, row.value]))
  return {
    siteName: values.get('site_name') ?? DEFAULT_SITE_NAME,
    openInNewTab: values.get('open_in_new_tab') !== 'false',
  }
}

// These display preferences are public so the login screen can use the site name.
export const onRequestGet: Fn = async ({ env }) => {
  return json(await loadSettings(env.DB), 200, { 'Cache-Control': 'no-store' })
}

export const onRequestPut: Fn = async ({ request, env }) => {
  const body = await readJson(request)
  const siteName = typeof body?.siteName === 'string' ? body.siteName.trim() : ''
  if (!siteName || siteName.length > MAX_SITE_NAME_LENGTH) {
    return fail(400, `网站名称需为 1–${MAX_SITE_NAME_LENGTH} 个字符`)
  }
  if (body?.openInNewTab !== undefined && typeof body.openInNewTab !== 'boolean') {
    return fail(400, '打开方式必须为布尔值')
  }
  const save = (key: string, value: string) => env.DB
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
  const statements = [save('site_name', siteName)]
  if (typeof body?.openInNewTab === 'boolean') statements.push(save('open_in_new_tab', String(body.openInNewTab)))
  await env.DB.batch(statements)
  return json(await loadSettings(env.DB))
}
