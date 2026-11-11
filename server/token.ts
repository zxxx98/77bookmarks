import type { AccessTokenStatus } from '../shared/types'

export const TOKEN_PREFIX = 'bm_'
const TOKEN_BYTES = 32
/** Uses are only written back this often, so that browsing the extension doesn't write on every request */
const TOUCH_INTERVAL = 60 * 1000

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
}

/** URL-safe so a token can be pasted into a connection code without escaping */
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
  return TOKEN_PREFIX + btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function looksLikeToken(value: string): boolean {
  return new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{20,}$`).test(value)
}

export async function tokenStatus(db: D1Database): Promise<AccessTokenStatus | null> {
  const row = await db.prepare('SELECT created_at, last_used_at FROM access_tokens ORDER BY id DESC LIMIT 1').first<{ created_at: number; last_used_at: number | null }>()
  return row ? { createdAt: row.created_at, lastUsedAt: row.last_used_at ?? null } : null
}

/** Replaces every existing token, so reconnecting one browser disconnects the others */
export async function createAccessToken(db: D1Database, now = Date.now()): Promise<string> {
  const token = randomToken()
  await db.batch([
    db.prepare('DELETE FROM access_tokens'),
    db.prepare('INSERT INTO access_tokens (token_hash, created_at) VALUES (?, ?)').bind(await hashToken(token), now),
  ])
  return token
}

export async function revokeAccessTokens(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM access_tokens').run()
}

/**
 * Checks a presented token. `touch` is the write that records the use, for the caller to keep alive
 * with `waitUntil`: it is skipped while the recorded use is still recent.
 */
export async function useToken(db: D1Database, presented: unknown, now = Date.now()): Promise<{ ok: boolean; touch: Promise<unknown> | null }> {
  if (typeof presented !== 'string' || !looksLikeToken(presented)) return { ok: false, touch: null }
  const hash = await hashToken(presented)
  const row = await db.prepare('SELECT id, last_used_at FROM access_tokens WHERE token_hash = ?').bind(hash).first<{ id: number; last_used_at: number | null }>()
  if (!row) return { ok: false, touch: null }
  if (row.last_used_at !== null && now - row.last_used_at < TOUCH_INTERVAL) return { ok: true, touch: null }
  return { ok: true, touch: db.prepare('UPDATE access_tokens SET last_used_at = ? WHERE id = ?').bind(now, row.id).run() }
}

/** Bearer token of a request, or null when the request is not using one */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null
}
