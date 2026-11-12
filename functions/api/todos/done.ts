import { json, type Fn } from '../../../server/http'
import { clearDoneTodos } from '../../../server/todos'

/** Removes every finished to-do */
export const onRequestDelete: Fn = async ({ env }) => {
  await clearDoneTodos(env.DB)
  return json({ ok: true })
}
