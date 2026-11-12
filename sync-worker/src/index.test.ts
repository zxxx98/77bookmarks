import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import worker from './index'
import { emptySnapshot } from '../../shared/sync'

// Execute real SQLite statements behind the small D1 interface used by the Worker.
const databases: DatabaseSync[] = []
function env() {
  const sqlite = new DatabaseSync(':memory:')
  databases.push(sqlite)
  return {
    SYNC_TOKEN: 'a'.repeat(64),
    DB: {
      prepare(sql: string) {
        const statement = sqlite.prepare(sql)
        let values: (string | number)[] = []
        return {
          bind(...args: (string | number)[]) { values = args; return this },
          async run() { return { meta: { changes: Number(statement.run(...values).changes) } } },
          async first() { return statement.get(...values) ?? null },
          async all() { return { results: statement.all(...values) } },
        }
      },
    },
  } as unknown as Parameters<typeof worker.fetch>[1]
}
afterEach(() => { for (const db of databases.splice(0)) db.close() })
function request(method = 'GET', headers: Record<string, string> = {}, body?: string, path = '/v1/snapshot') {
  return new Request(`https://sync.example.com${path}`, { method, headers: { authorization: `Bearer ${'a'.repeat(64)}`, ...headers }, body })
}
const body = () => JSON.stringify({ snapshot: emptySnapshot('test-device', 1) })

it('requires authentication and answers CORS preflights', async () => {
  const environment = env()
  expect((await worker.fetch(request('OPTIONS', { authorization: '' }), environment)).status).toBe(204)
  const response = await worker.fetch(request('GET', { authorization: '' }), environment)
  expect(response.status).toBe(401)
  expect(response.headers.get('access-control-allow-origin')).toBe('*')
  expect((await worker.fetch(request(), { ...environment, SYNC_TOKEN: '' })).status).toBe(503)
})

it('initializes an empty database, validates snapshots and requires write preconditions', async () => {
  const environment = env()
  const empty = await worker.fetch(request(), environment)
  expect(empty.status).toBe(404)
  expect(await empty.json()).toEqual({ error: 'Empty vault' })
  expect((await worker.fetch(request('PUT', {}, body()), environment)).status).toBe(428)
  expect((await worker.fetch(request('PUT', { 'if-none-match': '*' }, '{}'), environment)).status).toBe(400)
  const created = await worker.fetch(request('PUT', { 'if-none-match': '*' }, body()), environment)
  expect(created.status).toBe(200)
  expect(created.headers.get('etag')).toBe('"1"')
  const pulled = await worker.fetch(request(), environment)
  expect((await pulled.json() as { version: number }).version).toBe(1)
})

it('allows only one concurrent writer for each version and keeps the last ten snapshots', async () => {
  const environment = env()
  const first = await Promise.all([1, 2].map(() => worker.fetch(request('PUT', { 'if-none-match': '*' }, body()), environment)))
  expect(first.map((response) => response.status).sort()).toEqual([200, 412])
  const next = await Promise.all([1, 2].map(() => worker.fetch(request('PUT', { 'if-match': '"1"' }, body()), environment)))
  expect(next.map((response) => response.status).sort()).toEqual([200, 412])
  for (let version = 2; version < 13; version++) expect((await worker.fetch(request('PUT', { 'if-match': `"${version}"` }, body()), environment)).status).toBe(200)
  const history = await worker.fetch(request('GET', {}, undefined, '/v1/history'), environment)
  const versions = (await history.json() as { versions: { version: number }[] }).versions.map((row) => row.version)
  expect(versions).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4])
  expect((await worker.fetch(request('GET', {}, undefined, '/v1/snapshot?version=1'), environment)).status).toBe(404)
  expect((await worker.fetch(request('GET', {}, undefined, '/v1/snapshot?version=4'), environment)).status).toBe(200)
})
