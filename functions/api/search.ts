import { json, type Fn } from '../../server/http'
import { searchDesktops } from '../../server/search'

/** Search returns counts, never the other desktops' bookmark details. */
export const onRequestGet: Fn = async ({ request, env }) => {
  const query = new URL(request.url).searchParams.get('q') ?? ''
  return json(await searchDesktops(env.DB, query), 200, { 'Cache-Control': 'no-store' })
}
