import { seedDatabase, type LocalDatabase } from './db'
import { SCHEMA, type StoreSchema } from './schema'

/**
 * The third place the data service can keep a board, after IndexedDB and SQLite: nowhere.
 * An unlocked private space lives here, in the memory of the one tab that knows its
 * password, and is gone when that tab is.
 *
 * Transactions follow the IndexedDB rules the service already obeys: one at a time, committed
 * once nothing more is asked of them, undone as a whole when a request fails or the caller
 * aborts. Records are kept as JSON text, so nothing handed out can change what is stored.
 */
type Key = string | number
type Document = Record<string, unknown>
interface Table { rows: Map<Key, string>; next: number }

/** A turn of the event loop that background tabs do not slow down, unlike a timer */
const defer: (run: () => void) => void = typeof MessageChannel === 'undefined' ? (run) => { setTimeout(run, 0) } : (run) => {
  const channel = new MessageChannel()
  channel.port1.onmessage = () => { channel.port1.close(); run() }
  channel.port2.postMessage(null)
}

class Database {
  readonly tables = new Map<string, Table>(Object.keys(SCHEMA).map((name) => [name, { rows: new Map(), next: 1 }]))
  private current: Transaction | null = null
  private waiting: Transaction[] = []
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
  /** Tables as they were before this transaction first wrote to them */
  private before = new Map<string, Table>()
  private settle!: { resolve: () => void; reject: (error: unknown) => void }

  constructor(private database: Database, stores: readonly string[]) {
    for (const store of stores) if (!SCHEMA[store]) throw new Error(`Unknown store: ${store}`)
    this.done = new Promise((resolve, reject) => { this.settle = { resolve, reject } })
    // Callers that never look at `done` must not turn a rollback into a crash
    this.done.catch(() => undefined)
    database.acquire(this)
  }
  begin() {
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
    if (error === undefined) this.settle.resolve()
    else {
      for (const [name, table] of this.before) this.database.tables.set(name, table)
      this.settle.reject(error)
    }
    this.database.release(this)
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
  /** The table to change, remembered as it was so that the change can be undone */
  writable(name: string): Table {
    const table = this.database.tables.get(name)!
    if (!this.before.has(name)) this.before.set(name, { rows: new Map(table.rows), next: table.next })
    return table
  }
  readable(name: string): Table { return this.database.tables.get(name)! }
  request<T>(run: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        if (this.state !== 'active') { reject(new DOMException('The transaction is not active', 'TransactionInactiveError')); return }
        try {
          resolve(run())
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

const ordered = (keys: Iterable<Key>) => [...keys].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0))

class Store {
  private schema: StoreSchema
  constructor(private transaction: Transaction, private name: string) {
    this.schema = SCHEMA[name]
    if (!this.schema) throw new Error(`Unknown store: ${name}`)
  }
  private read(id: Key, data: string): Document {
    const value = JSON.parse(data) as Document
    if (this.schema.auto) value[this.schema.key] = id
    return value
  }
  private all(): Document[] {
    const { rows } = this.transaction.readable(this.name)
    return ordered(rows.keys()).map((id) => this.read(id, rows.get(id)!))
  }
  private matching(index: string, key: Key | Key[]): Document[] {
    const found = this.schema.indexes[index]
    if (!found) throw new Error(`Unknown index: ${this.name}.${index}`)
    const wanted = Array.isArray(key) ? key : [key]
    return this.all().filter((row) => found.paths.every((path, position) => row[path] === wanted[position]))
  }
  private write(value: Document, replace: boolean): Key {
    const { key, auto, indexes } = this.schema
    const table = this.transaction.writable(this.name)
    let id = (value[key] ?? null) as Key | null
    if (id === null) {
      if (!auto) throw new Error(`A record of ${this.name} needs its ${key}`)
      id = table.next
    } else if (!replace && table.rows.has(id)) throw new DOMException(`A record of ${this.name} already has this key`, 'ConstraintError')
    for (const [index, { paths, unique }] of Object.entries(indexes)) {
      if (!unique) continue
      const clash = this.matching(index, paths.map((path) => value[path] as Key)).find((row) => row[key] !== id)
      if (clash) throw new DOMException(`A record of ${this.name} already has this ${index}`, 'ConstraintError')
    }
    table.rows.set(id, JSON.stringify(auto ? { ...value, [key]: undefined } : value))
    if (typeof id === 'number' && id >= table.next) table.next = id + 1
    return id
  }
  get(key: Key) {
    return this.transaction.request(() => {
      const data = this.transaction.readable(this.name).rows.get(key)
      return data === undefined ? undefined : this.read(key, data)
    })
  }
  getAll() { return this.transaction.request(() => this.all()) }
  count() { return this.transaction.request(() => this.transaction.readable(this.name).rows.size) }
  put(value: Document) { return this.transaction.request(() => this.write(value, true)) }
  add(value: Document) { return this.transaction.request(() => this.write(value, false)) }
  delete(key: Key) { return this.transaction.request(() => { this.transaction.writable(this.name).rows.delete(key) }) }
  // The counter survives, as it does in IndexedDB: a cleared store never hands out an old key
  clear() { return this.transaction.request(() => { this.transaction.writable(this.name).rows.clear() }) }
  index(index: string) {
    return {
      get: (key: Key | Key[]) => this.transaction.request(() => this.matching(index, key)[0]),
      getAll: (key: Key | Key[]) => this.transaction.request(() => this.matching(index, key)),
      count: (key: Key | Key[]) => this.transaction.request(() => this.matching(index, key).length),
    }
  }
}

/** One board held in memory; several handles may share it, as several tabs share an IndexedDB */
export class MemoryStore {
  private database = new Database()
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
  close() {}
  /** The service's view of this database */
  get local() { return this as unknown as LocalDatabase }
}

/** A fresh board in memory. `vault: false` leaves out the vault, which a private space has no use for. */
export async function openMemoryStore(options: { vault?: boolean } = {}): Promise<MemoryStore> {
  const store = new MemoryStore()
  await seedDatabase(store.local, options)
  return store
}
