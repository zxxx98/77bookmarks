import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AccessTokenStatus } from '../shared/types'
import type { SqliteStore } from './sqlite'

const COOKIE = 'bm_session'
const SESSION_SECONDS = 30 * 24 * 60 * 60
export const TOKEN_PREFIX = 'bm_'
const TOKEN_PATTERN = /^bm_[A-Za-z0-9_-]{20,}$/
/** Uses are only written back this often, so that a busy extension does not write on every request */
const TOUCH_INTERVAL = 60 * 1000
const MAX_FAILURES = 10
const FAILURE_WINDOW = 15 * 60 * 1000

const sha256 = (value: string) => createHash('sha256').update(value).digest()
/** Digests have one length, so the comparison takes the same time whatever was typed */
const same = (a: string, b: string) => timingSafeEqual(sha256(a), sha256(b))

/**
 * Who may talk to the server. There is one user: the password signs the browser in, and a
 * single access token lets the right-click extension read the board and add bookmarks.
 * Everything the server remembers for this lives in its own table, outside the data
 * service, so it never appears in a backup or a sync snapshot.
 */
export class Auth {
  private secret = ''
  private failures = new Map<string, { count: number; resetAt: number }>()

  constructor(private store: SqliteStore, private password: string) {}

  async init() {
    this.secret = await this.store.exclusive((sqlite) => {
      sqlite.exec('CREATE TABLE IF NOT EXISTS server_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      const found = sqlite.prepare("SELECT value FROM server_meta WHERE key = 'session_secret'").get() as { value: string } | undefined
      if (found) return found.value
      const secret = randomBytes(32).toString('hex')
      sqlite.prepare("INSERT INTO server_meta (key, value) VALUES ('session_secret', ?)").run(secret)
      return secret
    })
  }

  /** The password is part of the key, so changing it signs every browser out */
  private sign(expires: string) {
    return createHmac('sha256', `${this.secret}:${sha256(this.password).toString('hex')}`).update(expires).digest('hex')
  }
  private cookie(value: string, maxAge: number, secure: boolean) {
    return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  }
  sessionCookie(secure: boolean, now = Date.now()) {
    const expires = String(Math.floor(now / 1000) + SESSION_SECONDS)
    return this.cookie(`${expires}.${this.sign(expires)}`, SESSION_SECONDS, secure)
  }
  clearCookie(secure: boolean) { return this.cookie('', 0, secure) }
  hasSession(cookieHeader: string | null, now = Date.now()) {
    const match = (cookieHeader ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]{64})(?:;|$)`))
    if (!match || Number(match[1]) < now / 1000) return false
    return same(match[2], this.sign(match[1]))
  }

  /** `retryAfter` is set once an address has guessed wrong too often */
  login(input: string, client: string, now = Date.now()): { ok: boolean; retryAfter?: number } {
    for (const [key, entry] of this.failures) if (entry.resetAt <= now) this.failures.delete(key)
    const entry = this.failures.get(client)
    if (entry && entry.count >= MAX_FAILURES) return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
    if (same(input, this.password)) {
      this.failures.delete(client)
      return { ok: true }
    }
    if (entry) entry.count++
    else this.failures.set(client, { count: 1, resetAt: now + FAILURE_WINDOW })
    return { ok: false }
  }

  tokenStatus(): Promise<AccessTokenStatus | null> {
    return this.store.exclusive((sqlite) => {
      const row = sqlite.prepare("SELECT value FROM server_meta WHERE key = 'access_token'").get() as { value: string } | undefined
      if (!row) return null
      const { createdAt, lastUsedAt } = JSON.parse(row.value) as { createdAt: number; lastUsedAt: number | null }
      return { createdAt, lastUsedAt }
    })
  }
  /** Replaces the previous token, so reconnecting one browser disconnects the others */
  async createToken(now = Date.now()): Promise<{ token: string; createdAt: number }> {
    // URL-safe, so it can sit in the fragment of a connection code without escaping
    const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
    const record = JSON.stringify({ hash: sha256(token).toString('hex'), createdAt: now, lastUsedAt: null })
    await this.store.exclusive((sqlite) => {
      sqlite.prepare("INSERT INTO server_meta (key, value) VALUES ('access_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(record)
    })
    return { token, createdAt: now }
  }
  async revokeToken() {
    await this.store.exclusive((sqlite) => { sqlite.exec("DELETE FROM server_meta WHERE key = 'access_token'") })
  }
  /** Only the hash is stored: reading the database file does not reveal a usable token */
  async useToken(presented: string, now = Date.now()): Promise<boolean> {
    if (!TOKEN_PATTERN.test(presented)) return false
    return this.store.exclusive((sqlite) => {
      const row = sqlite.prepare("SELECT value FROM server_meta WHERE key = 'access_token'").get() as { value: string } | undefined
      if (!row) return false
      const record = JSON.parse(row.value) as { hash: string; createdAt: number; lastUsedAt: number | null }
      if (!timingSafeEqual(Buffer.from(record.hash, 'hex'), sha256(presented))) return false
      if (record.lastUsedAt === null || now - record.lastUsedAt >= TOUCH_INTERVAL) {
        sqlite.prepare("UPDATE server_meta SET value = ? WHERE key = 'access_token'").run(JSON.stringify({ ...record, lastUsedAt: now }))
      }
      return true
    })
  }
}
