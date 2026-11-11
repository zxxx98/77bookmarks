import { loadBoard } from '../../server/db'
import { json, type Fn } from '../../server/http'

export const onRequestGet: Fn = async ({ env }) => {
  return json(await loadBoard(env.DB))
}
