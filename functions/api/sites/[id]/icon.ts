import { fromBase64, MAX_ICON_BYTES, saveIcon } from '../../../../server/db'
import { fail, idParam, json, readJson, type Fn } from '../../../../server/http'
import { fetchPageMeta, fetchSiteIcon, type IconData } from '../../../../server/meta'
import { parseIconUrl } from '../../../../shared/url'

const DATA_URL = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/

/**
 * Body is one of:
 * - { url } to show an image from that address. Only the address is saved and the browser loads
 *   it directly, so it also works for addresses that Cloudflare can't reach.
 * - { dataUrl } to store an uploaded image.
 * - {} to fetch the icon from the site again.
 */
export const onRequestPost: Fn = async ({ request, env, params }) => {
  const db = env.DB
  const id = idParam(params.id)
  const body = await readJson(request)
  const site = id ? await db.prepare('SELECT origin FROM sites WHERE id = ?').bind(id).first<{ origin: string }>() : null
  if (!id || !body || !site) return fail(404, '卡片不存在')

  if (typeof body.url === 'string') {
    const iconUrl = parseIconUrl(body.url)
    if (!iconUrl) return fail(400, '无效的图片地址')
    await db.prepare('UPDATE sites SET icon_url = ? WHERE id = ?').bind(iconUrl, id).run()
    return json({ ok: true })
  }

  let icon: IconData | null
  if (typeof body.dataUrl === 'string') {
    const match = body.dataUrl.match(DATA_URL)
    const bytes = match && fromBase64(match[2])
    if (!match || !bytes || bytes.byteLength === 0) return fail(400, '无效的图片')
    if (bytes.byteLength > MAX_ICON_BYTES) return fail(400, '图片不能超过 100 KB')
    icon = { contentType: match[1], data: bytes.buffer as ArrayBuffer }
  } else {
    const meta = await fetchPageMeta(site.origin)
    icon = await fetchSiteIcon(site.origin, meta.icons)
    if (!icon) return fail(422, '没有找到该网站的图标')
  }

  await saveIcon(db, id, icon.contentType, icon.data)
  return json({ ok: true })
}

/** Removes both the stored icon and the custom address, leaving the letter avatar */
export const onRequestDelete: Fn = async ({ env, params }) => {
  const id = idParam(params.id)
  if (!id) return fail(400, '无效的卡片')
  await env.DB.batch([
    env.DB.prepare('DELETE FROM icons WHERE site_id = ?').bind(id),
    env.DB.prepare('UPDATE sites SET icon_version = 0, icon_url = NULL WHERE id = ?').bind(id),
  ])
  return json({ ok: true })
}
