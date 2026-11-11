import { blobBytes } from '../../../server/db'
import { fail, idParam, type Fn } from '../../../server/http'

export const onRequestGet: Fn = async ({ env, params }) => {
  const id = idParam(params.siteId)
  const row = id
    ? await env.DB.prepare('SELECT content_type, data FROM icons WHERE site_id = ?').bind(id).first<{ content_type: string; data: unknown }>()
    : null
  if (!row) return fail(404, '没有图标')
  return new Response(blobBytes(row.data), {
    headers: {
      'Content-Type': row.content_type,
      // The URL carries icon_version, so a new icon always gets a new URL
      'Cache-Control': 'private, max-age=31536000, immutable',
      // Icons come from third-party sites; keep an SVG from running script if opened directly
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
