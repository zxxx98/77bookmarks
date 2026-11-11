import { describe, expect, it } from 'vitest'
import { bearerToken, createAccessToken, hashToken, looksLikeToken, revokeAccessTokens, tokenStatus, useToken } from './token'

interface Row { id: number; token_hash: string; created_at: number; last_used_at: number | null }

/** Just enough of D1 for the handful of statements that touch access_tokens */
function database() {
  const rows: Row[] = []
  let nextId = 1
  const execute = (sql: string, bindings: unknown[]): Row | null => {
    if (sql.startsWith('DELETE')) rows.length = 0
    else if (sql.startsWith('INSERT')) rows.push({ id: nextId++, token_hash: bindings[0] as string, created_at: bindings[1] as number, last_used_at: null })
    else if (sql.startsWith('UPDATE')) rows.find((row) => row.id === bindings[1])!.last_used_at = bindings[0] as number
    else if (sql.includes('WHERE token_hash')) return rows.find((row) => row.token_hash === bindings[0]) ?? null
    else return rows.at(-1) ?? null
    return null
  }
  const prepare = (sql: string) => {
    const statement = {
      bindings: [] as unknown[],
      bind(...bindings: unknown[]) { statement.bindings = bindings; return statement },
      first: async () => execute(sql, statement.bindings),
      run: async () => { execute(sql, statement.bindings) },
    }
    return statement
  }
  const db = { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => { for (const statement of statements) await statement.run() } }
  return { db: db as unknown as D1Database, rows }
}

describe('access tokens', () => {
  it('stores only a hash of the token it hands out', async () => {
    const { db, rows } = database()
    const token = await createAccessToken(db, 1000)
    expect(looksLikeToken(token)).toBe(true)
    expect(rows).toEqual([{ id: 1, token_hash: await hashToken(token), created_at: 1000, last_used_at: null }])
    expect(JSON.stringify(rows)).not.toContain(token)
    expect(await tokenStatus(db)).toEqual({ createdAt: 1000, lastUsedAt: null })
  })

  it('accepts the current token and records when it was used', async () => {
    const { db, rows } = database()
    const token = await createAccessToken(db, 1000)
    const { ok, touch } = await useToken(db, token, 5000)
    expect(ok).toBe(true)
    await touch
    expect(rows[0].last_used_at).toBe(5000)
  })

  it('does not write on every request while the recorded use is recent', async () => {
    const { db, rows } = database()
    const token = await createAccessToken(db, 1000)
    await (await useToken(db, token, 5000)).touch
    expect(await useToken(db, token, 5000 + 59_000)).toEqual({ ok: true, touch: null })
    await (await useToken(db, token, 5000 + 61_000)).touch
    expect(rows[0].last_used_at).toBe(66_000)
  })

  it('rejects a token replaced by a newer one', async () => {
    const { db } = database()
    const first = await createAccessToken(db, 1000)
    const second = await createAccessToken(db, 2000)
    expect(second).not.toBe(first)
    expect((await useToken(db, first)).ok).toBe(false)
    expect((await useToken(db, second)).ok).toBe(true)
  })

  it('rejects every token once revoked', async () => {
    const { db } = database()
    const token = await createAccessToken(db)
    await revokeAccessTokens(db)
    expect((await useToken(db, token)).ok).toBe(false)
    expect(await tokenStatus(db)).toBeNull()
  })

  it.each(['', 'bm_', 'bm_short', 'password', 'bm_has spaces in it and is long enough', undefined, 42])('rejects %j without a lookup', async (value) => {
    const db = { prepare: () => { throw new Error('must not query') } } as unknown as D1Database
    expect(await useToken(db, value)).toEqual({ ok: false, touch: null })
  })
})

describe('bearer header', () => {
  const request = (authorization?: string) => new Request('https://bookmarks.example/api/board', { headers: authorization ? { Authorization: authorization } : {} })

  it('reads the token of a bearer request', () => {
    expect(bearerToken(request('Bearer bm_abc'))).toBe('bm_abc')
  })

  it.each([undefined, 'Basic dXNlcjpwYXNz', 'bm_abc'])('treats %j as a request without a token', (authorization) => {
    expect(bearerToken(request(authorization))).toBeNull()
  })
})
