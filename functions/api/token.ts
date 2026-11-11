import { json, type Fn } from '../../server/http'
import { createAccessToken, revokeAccessTokens, tokenStatus } from '../../server/token'

/** Whether an access token exists: never the token itself, which is only shown once when created */
export const onRequestGet: Fn = async ({ env }) => {
  return json(await tokenStatus(env.DB), 200, { 'Cache-Control': 'no-store' })
}

export const onRequestPost: Fn = async ({ env }) => {
  const now = Date.now()
  return json({ token: await createAccessToken(env.DB, now), createdAt: now })
}

export const onRequestDelete: Fn = async ({ env }) => {
  await revokeAccessTokens(env.DB)
  return json({ ok: true })
}
