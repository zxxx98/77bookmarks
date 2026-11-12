import { MAX_SNAPSHOT_BYTES, parseSnapshot } from './protocol'

interface Env { DB: D1Database; SYNC_TOKEN: string }
interface Stored { version: number; body: string; created_at: number }

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type, If-Match, If-None-Match',
  'access-control-expose-headers': 'ETag',
  'cache-control': 'no-store',
}
function json(value: unknown, status = 200, version?: number): Response {
  return Response.json(value, { status, headers: { ...cors, ...(version === undefined ? {} : { etag: `"${version}"` }) } })
}

// Hashes both values to a fixed length before comparing, including non-ASCII tokens.
async function authorized(request: Request, token: string | undefined): Promise<boolean> {
  if (!token || token.length < 32) return false
  const encoder = new TextEncoder()
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  const [expected, actual] = await Promise.all([digest(`Bearer ${token}`), digest(request.headers.get('authorization') ?? '')])
  let difference = 0
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual[i]
  return difference === 0
}

async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length')) > MAX_SNAPSHOT_BYTES) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let size = 0
  let body = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_SNAPSHOT_BYTES) { await reader.cancel(); return null }
    body += decoder.decode(value, { stream: true })
  }
  return body + decoder.decode()
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (!env.SYNC_TOKEN || env.SYNC_TOKEN.length < 32) return json({ error: '请设置至少 32 字符的 SYNC_TOKEN' }, 503)
    if (!(await authorized(request, env.SYNC_TOKEN))) return json({ error: 'Unauthorized' }, 401)
    if (url.pathname !== '/v1/snapshot' && url.pathname !== '/v1/history') return json({ error: 'Not found' }, 404)
    try {
      // Provisioned D1 bindings on Deploy to Cloudflare start empty; initialize the one
      // table here too so the deployment works without a separate migration command.
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS snapshots (version INTEGER PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL)').run()
      if (url.pathname === '/v1/history') {
        if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
        const { results } = await env.DB.prepare('SELECT version, created_at FROM snapshots ORDER BY version DESC LIMIT 10').all()
        return json({ versions: results })
      }
      if (request.method === 'GET') {
        const requested = url.searchParams.get('version')
        const row = requested
          ? await env.DB.prepare('SELECT version, body, created_at FROM snapshots WHERE version = ?').bind(requested).first<Stored>()
          : await env.DB.prepare('SELECT version, body, created_at FROM snapshots ORDER BY version DESC LIMIT 1').first<Stored>()
        if (!row) return json({ error: requested ? 'Version not found' : 'Empty vault' }, 404)
        return json({ version: row.version, snapshot: JSON.parse(row.body) }, 200, row.version)
      }
      if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405)
      const expected = request.headers.get('if-match')
      const create = request.headers.get('if-none-match') === '*'
      if ((!create && !/^"[1-9][0-9]*"$/.test(expected ?? '')) || (create && expected !== null)) return json({ error: 'A version precondition is required' }, 428)
      const body = await readBody(request)
      if (body === null) return json({ error: 'Snapshot too large' }, 413)
      let input: unknown
      try { input = JSON.parse(body) } catch { return json({ error: 'Invalid JSON' }, 400) }
      const snapshot = parseSnapshot((input as { snapshot?: unknown } | null)?.snapshot)
      if (!snapshot) return json({ error: 'Invalid snapshot' }, 400)
      const version = create ? 0 : Number(expected!.slice(1, -1))
      if (!Number.isSafeInteger(version)) return json({ error: 'Invalid version' }, 400)
      // The predicate and insert are ONE SQL statement. No read-then-write race:
      // exactly one writer can advance a particular version, even across Workers.
      const result = await env.DB.prepare(`INSERT INTO snapshots (version, body, created_at)
        SELECT ?, ?, ? WHERE COALESCE((SELECT MAX(version) FROM snapshots), 0) = ?`)
        .bind(version + 1, JSON.stringify(snapshot), Date.now(), version).run()
      if (!result.meta.changes) return json({ error: 'Version conflict' }, 412)
      // Keep ten versions. A failed cleanup does not turn a committed write into a failure.
      await env.DB.prepare('DELETE FROM snapshots WHERE version <= (SELECT MAX(version) - 10 FROM snapshots)').run().catch(() => undefined)
      return json({ version: version + 1 }, 200, version + 1)
    } catch {
      return json({ error: 'Database unavailable' }, 500)
    }
  },
}
