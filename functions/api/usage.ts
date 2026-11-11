import { json, type Fn } from '../../server/http'
import { loadUsage } from '../../server/usage'

export const onRequestGet: Fn = async ({ env }) => {
  return json(await loadUsage(env.DB), 200, { 'Cache-Control': 'no-store' })
}
