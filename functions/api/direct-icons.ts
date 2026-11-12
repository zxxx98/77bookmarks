import { saveDirectIcon } from '../../server/db'
import { json, type Fn } from '../../server/http'
import { fetchPageMeta, pickDirectIcon } from '../../server/meta'

/**
 * Sites handled per call. Every one of them costs a page fetch and a few probes, and a free
 * account allows fifty outside requests per call, so the batch stays well below that.
 */
const BATCH_SIZE = 8

/**
 * Moves stored icons to the addresses of the sites themselves: the browser then loads them and
 * this project is not asked for them again. One batch per call; the caller walks the ids.
 */
export const onRequestPost: Fn = async ({ request, env }) => {
  const asked = Number(new URL(request.url).searchParams.get('after'))
  const after = Number.isFinite(asked) && asked > 0 ? asked : 0
  const db = env.DB
  const rows = await db
    .prepare('SELECT id, origin FROM sites WHERE id > ? AND icon_version > 0 AND icon_url IS NULL ORDER BY id LIMIT ?')
    .bind(after, BATCH_SIZE)
    .all<{ id: number; origin: string }>()

  // The sites of a batch are asked at the same time, so that a batch doesn't take as long as its
  // sites together
  const found = await Promise.all(
    rows.results.map(async (row) => {
      const meta = await fetchPageMeta(row.origin)
      const direct = await pickDirectIcon(row.origin, meta.icons)
      return direct ? { id: row.id, url: direct.url } : null
    }),
  )

  let converted = 0
  for (const icon of found) {
    // A site that keeps its stored icon is left alone, so nothing is lost
    if (!icon) continue
    await saveDirectIcon(db, icon.id, icon.url)
    converted++
  }

  // The cursor moves past every site of this batch, also the ones that kept their icon
  const nextAfter = rows.results.at(-1)?.id ?? after
  const left = await db
    .prepare('SELECT COUNT(*) AS count FROM sites WHERE id > ? AND icon_version > 0 AND icon_url IS NULL')
    .bind(nextAfter)
    .first<{ count: number }>()
  return json({ checked: rows.results.length, converted, nextAfter, done: (left?.count ?? 0) === 0 })
}
