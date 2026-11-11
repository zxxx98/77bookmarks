import { blobBytes, loadBoard, toBase64 } from '../../server/db'
import { fail, idParam, json, type Fn } from '../../server/http'
import type { Backup } from '../../shared/backup'

/** Downloads every desktop, or only the one named by ?desktop=ID */
export const onRequestGet: Fn = async ({ request, env }) => {
  const only = new URL(request.url).searchParams.get('desktop')
  const board = await loadBoard(env.DB)
  const desktops = only === null ? board.desktops : board.desktops.filter((desktop) => desktop.id === idParam(only))
  if (desktops.length === 0) return fail(404, '桌面不存在')

  const iconRows = await env.DB.prepare('SELECT site_id, content_type, data FROM icons').all<{
    site_id: number
    content_type: string
    data: unknown
  }>()
  const icons = new Map(iconRows.results.map((row) => [row.site_id, row]))

  const backup: Backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    desktops: desktops.map((desktop) => ({
      name: desktop.name,
      view: desktop.view,
      groups: desktop.groups.map((group) => ({
        name: group.name,
        pinned: group.pinned || undefined,
        sites: group.sites.map((site) => {
          const icon = icons.get(site.id)
          return {
            origin: site.origin,
            title: site.title,
            icon: icon && { type: icon.content_type, data: toBase64(blobBytes(icon.data)) },
            iconUrl: site.iconUrl ?? undefined,
            links: site.links.map((link) => ({ path: link.path, title: link.title })),
          }
        }),
      })),
    })),
  }

  const date = backup.exportedAt.slice(0, 10)
  // Characters that can't be part of a file name are replaced
  const scope = only === null ? '' : `-${desktops[0].name.replace(/[\\/:*?"<>|]/g, '_')}`
  const encoded = encodeURIComponent(`77bookmarks${scope}-${date}.json`).replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return json(backup, 200, {
    // The plain filename is the fallback for clients that don't understand the UTF-8 form
    'Content-Disposition': `attachment; filename="77bookmarks-${date}.json"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'no-store',
  })
}
