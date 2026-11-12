import { DatabaseSync } from 'node:sqlite'
import { seedDatabase, type LocalDatabase } from '../src/storage/db'

/**
 * The data service is written against IndexedDB. This file gives it the same handful of
 * calls on top of a SQLite file, so the server runs the very same service as the extension:
 * every store is a table of JSON documents, and the IndexedDB indexes are expression indexes.
 *
 * Transactions follow the IndexedDB rules the service already obeys: one at a time, opened
 * for a known moment, committed once nothing more is asked of them, rolled back as a whole
 * when a request fails or the caller aborts.
 */
interface StoreSchema {
  /** Property holding the key; `auto` stores get theirs from the database */
  key: string
  auto: boolean
  indexes: Record<string, { paths: string[]; unique?: boolean }>
}

const SCHEMA: Record<string, StoreSchema> = {
  desktops: { key: 'id', auto: true, indexes: {} },
  groups: { key: 'id', auto: true, indexes: { desktopId: { paths: ['desktopId'] } } },
  sites: { key: 'id', auto: true, indexes: { desktopId: { paths: ['desktopId'] }, groupId: { paths: ['groupId'] }, origin: { paths: ['desktopId', 'origin'], unique: true } } },
  links: { key: 'id', auto: true, indexes: { siteId: { paths: ['siteId'] }, path: { paths: ['siteId', 'path'], unique: true } } },
  icons: { key: 'siteId', auto: false, indexes: {} },
  todos: { key: 'id', auto: true, indexes: {} },
  settings: { key: 'key', auto: false, indexes: {} },
  sync: { key: 'key', auto: false, indexes: {} },
}

type Key = string | number
type Row = { id: Key; data: string }
type Document = Record<string, unknown>
// Captured once: tests that fake timers must not stall the commit of an idle transaction.
const defer = setImmediate

const table = (store: string) => `"store_${store}"`
const extract = (path: string) => `json_extract(data, '$.${path}')`

class Database {
  readonly sqlite: DatabaseSync
  private current: Transaction | null = null
  private waiting: Transaction[] = []

  constructor(path: string) {
    this.sqlite = new DatabaseSync(path)
    if (path !== ':memory:') this.sqlite.exec('PRAGMA journal_mode = WAL')
    for (const [name, schema] of Object.entries(SCHEMA)) {
      this.sqlite.exec(`CREATE TABLE IF NOT EXISTS ${table(name)} (id ${schema.auto ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'PRIMARY KEY'}, data TEXT NOT NULL)`)
      for (const [index, { paths, unique }] of Object.entries(schema.indexes)) {
        this.sqlite.exec(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "index_${name}_${index}" ON ${table(name)} (${paths.map(extract).join(', ')})`)
      }
    }
  }
  acquire(transaction: Transaction) {
    if (this.current) this.waiting.push(transaction)
    else { this.current = transaction; transaction.begin() }
  }
  release(transaction: Transaction) {
    if (this.current !== transaction) return
    this.current = this.waiting.shift() ?? null
    this.current?.begin()
  }
}

class Transaction {
  readonly done: Promise<void>
  private state: 'waiting' | 'active' | 'finished' = 'waiting'
  private queued: (() => void)[] = []
  private requests = 0
  private settle!: { resolve: () => void; reject: (error: unknown) => void }

  constructor(private database: Database, stores: readonly string[]) {
    for (const store of stores) if (!SCHEMA[store]) throw new Error(`Unknown store: ${store}`)
    this.done = new Promise((resolve, reject) => { this.settle = { resolve, reject } })
    // Callers that never look at `done` must not turn a rollback into a crash
    this.done.catch(() => undefined)
    database.acquire(this)
  }
  begin() {
    this.database.sqlite.exec('BEGIN')
    this.state = 'active'
    for (const request of this.queued.splice(0)) request()
    this.idleCheck()
  }
  /** Commits unless another request arrives before the callers of the last one have run */
  private idleCheck() {
    const seen = ++this.requests
    defer(() => { if (this.state === 'active' && this.requests === seen) this.finish() })
  }
  private finish(error?: unknown) {
    if (this.state !== 'active') return
    this.state = 'finished'
    try {
      this.database.sqlite.exec(error === undefined ? 'COMMIT' : 'ROLLBACK')
      if (error === undefined) this.settle.resolve()
      else this.settle.reject(error)
    } catch (failure) {
      try { this.database.sqlite.exec('ROLLBACK') } catch { /* Nothing left to roll back. */ }
      this.settle.reject(failure)
    } finally {
      this.database.release(this)
    }
  }
  abort() {
    if (this.state === 'finished') throw new Error('The transaction has already finished')
    if (this.state === 'waiting') {
      // Never started: keep its place in line harmless and report the abort
      this.queued = []
      this.begin()
    }
    this.finish(new DOMException('The transaction was aborted', 'AbortError'))
  }
  request<T>(run: (sqlite: DatabaseSync) => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        if (this.state !== 'active') { reject(new DOMException('The transaction is not active', 'TransactionInactiveError')); return }
        try {
          resolve(run(this.database.sqlite))
          this.idleCheck()
        } catch (error) {
          // As in IndexedDB, a failed request takes the whole transaction with it
          reject(error)
          this.finish(error)
        }
      }
      if (this.state === 'waiting') this.queued.push(execute)
      else execute()
    })
  }
  objectStore(name: string) { return new Store(this, name) }
}

class Store {
  private schema: StoreSchema
  constructor(private transaction: Transaction, private name: string) {
    this.schema = SCHEMA[name]
    if (!this.schema) throw new Error(`Unknown store: ${name}`)
  }
  private read(row: Row | undefined): Document | undefined {
    if (!row) return undefined
    const value = JSON.parse(row.data) as Document
    if (this.schema.auto) value[this.schema.key] = row.id
    return value
  }
  private write(sqlite: DatabaseSync, value: Document, replace: boolean): Key {
    const { key, auto } = this.schema
    const id = (value[key] ?? null) as Key | null
    if (id === null && !auto) throw new Error(`A record of ${this.name} needs its ${key}`)
    const data = JSON.stringify(auto ? { ...value, [key]: undefined } : value)
    const sql = `INSERT INTO ${table(this.name)} (id, data) VALUES (?, ?)${replace ? ' ON CONFLICT(id) DO UPDATE SET data = excluded.data' : ''} RETURNING id`
    return (sqlite.prepare(sql).get(id, data) as { id: Key }).id
  }
  private where(index: string) {
    const found = this.schema.indexes[index]
    if (!found) throw new Error(`Unknown index: ${this.name}.${index}`)
    return found.paths.map((path) => `${extract(path)} = ?`).join(' AND ')
  }
  get(key: Key) {
    return this.transaction.request((sqlite) => this.read(sqlite.prepare(`SELECT id, data FROM ${table(this.name)} WHERE id = ?`).get(key) as Row | undefined))
  }
  getAll() {
    return this.transaction.request((sqlite) => (sqlite.prepare(`SELECT id, data FROM ${table(this.name)} ORDER BY id`).all() as Row[]).map((row) => this.read(row)!))
  }
  count() {
    return this.transaction.request((sqlite) => (sqlite.prepare(`SELECT COUNT(*) AS total FROM ${table(this.name)}`).get() as { total: number }).total)
  }
  put(value: Document) { return this.transaction.request((sqlite) => this.write(sqlite, value, true)) }
  add(value: Document) { return this.transaction.request((sqlite) => this.write(sqlite, value, false)) }
  delete(key: Key) {
    return this.transaction.request((sqlite) => { sqlite.prepare(`DELETE FROM ${table(this.name)} WHERE id = ?`).run(key) })
  }
  clear() {
    return this.transaction.request((sqlite) => { sqlite.exec(`DELETE FROM ${table(this.name)}`) })
  }
  index(index: string) {
    const where = this.where(index)
    const keys = (key: Key | Key[]) => (Array.isArray(key) ? key : [key])
    return {
      get: (key: Key | Key[]) => this.transaction.request((sqlite) => this.read(sqlite.prepare(`SELECT id, data FROM ${table(this.name)} WHERE ${where} ORDER BY id LIMIT 1`).get(...keys(key)) as Row | undefined)),
      getAll: (key: Key | Key[]) => this.transaction.request((sqlite) => (sqlite.prepare(`SELECT id, data FROM ${table(this.name)} WHERE ${where} ORDER BY id`).all(...keys(key)) as Row[]).map((row) => this.read(row)!)),
      count: (key: Key | Key[]) => this.transaction.request((sqlite) => (sqlite.prepare(`SELECT COUNT(*) AS total FROM ${table(this.name)} WHERE ${where}`).get(...keys(key)) as { total: number }).total),
    }
  }
}

/** One open database; several handles may share it, as several tabs share an IndexedDB */
export class SqliteStore {
  private database: Database
  constructor(path: string) { this.database = new Database(path) }
  transaction(stores: string | readonly string[], _mode?: 'readonly' | 'readwrite') {
    return new Transaction(this.database, typeof stores === 'string' ? [stores] : stores)
  }
  private async single<T>(store: string, run: (store: Store) => Promise<T>): Promise<T> {
    const transaction = this.transaction(store)
    const result = await run(transaction.objectStore(store))
    await transaction.done
    return result
  }
  get(store: string, key: Key) { return this.single(store, (s) => s.get(key)) }
  getAll(store: string) { return this.single(store, (s) => s.getAll()) }
  count(store: string) { return this.single(store, (s) => s.count()) }
  put(store: string, value: Document) { return this.single(store, (s) => s.put(value)) }
  getFromIndex(store: string, index: string, key: Key | Key[]) { return this.single(store, (s) => s.index(index).get(key)) }
  /**
   * Runs plain SQL in a transaction of its own, queued behind the service's transactions.
   * The server keeps its own few records (session secret, access token) this way.
   */
  async exclusive<T>(run: (sqlite: DatabaseSync) => T): Promise<T> {
    const transaction = this.transaction([])
    const result = await transaction.request(run)
    await transaction.done
    return result
  }
  /** Handles are shared; the file is closed with `destroy` when the server stops */
  close() {}
  destroy() { this.database.sqlite.close() }
  /** The service's view of this database */
  get local() { return this as unknown as LocalDatabase }
}

/** Opens (and on first use creates and seeds) the database file */
export async function openSqliteStore(path: string): Promise<SqliteStore> {
  const store = new SqliteStore(path)
  await seedDatabase(store.local)
  return store
}
