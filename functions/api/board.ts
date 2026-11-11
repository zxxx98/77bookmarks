import { loadBoardPage } from '../../server/db'
import { idParam, json, type Fn } from '../../server/http'

export const onRequestGet: Fn = async ({ request, env }) => {
  const desktopId = idParam(new URL(request.url).searchParams.get('desktop') ?? undefined)
  return json(await loadBoardPage(env.DB, desktopId), 200, { 'Cache-Control': 'no-store' })
}
