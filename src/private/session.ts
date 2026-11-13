import type { SyncSnapshot } from '../../shared/sync'
import type { SpaceKeys, Vault } from '../../shared/vault'
import { platform } from '../platform'
import type { LocalService, ServiceMethod } from '../storage/service'

/**
 * The private space that is open in this tab, if one is. Its password and keys exist only
 * here, in memory: closing the tab, locking or five idle minutes forget them, and nothing
 * about the space is ever written anywhere but as ciphertext into the vault.
 *
 * While a space is open the interface is the same interface, pointed at another board: a
 * second data service, running in the page on a database that is kept in memory. Every
 * change encrypts that whole board again and stores it.
 */
const SPACE_FORMAT = '77bookmarks-space'
const IDLE_MS = 5 * 60 * 1000
/** Requests that keep going to the ordinary board while a space is open */
const OUTSIDE = new Set<ServiceMethod>(['settings', 'updateSettings', 'vaultRead', 'vaultWrite'])

interface Session {
  service: LocalService
  reads: Set<ServiceMethod>
  keys: SpaceKeys
  /** The first record of the space as this tab last saw it; a difference means someone else saved */
  seen: string | null
  saving: Promise<void>
}

let session: Session | null = null
let generation = 0
let notice: string | null = null
const listeners = new Set<() => void>()
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const crypto_ = () => import('../../shared/vault')
const readVault = () => platform.call('vaultRead') as Promise<Vault>
const writeVault = (chunks: Record<string, string>, guard?: { id: string; value: string | null }) => platform.call('vaultWrite', chunks, guard)

function changed(next: Session | null, message: string | null = null) {
  session = next
  notice = message
  generation++
  lastActivity = Date.now()
  for (const listener of [...listeners]) listener()
}

async function boardFor(snapshot: SyncSnapshot | null) {
  const [{ LocalService, READ_METHODS }, { openMemoryStore }] = await Promise.all([import('../storage/service'), import('../storage/memory')])
  const store = await openMemoryStore({ vault: false })
  // Nothing of a private space may reach the network on its own, so there are no icons to fetch
  const service = new LocalService(async () => store.local, { fetchIcon: async () => null })
  if (snapshot) await service.mergeRemote(snapshot)
  return { service, reads: READ_METHODS }
}

async function pack(service: LocalService): Promise<Uint8Array> {
  const { vault: _vault, ...snapshot } = await service.snapshot()
  return encoder.encode(JSON.stringify({ format: SPACE_FORMAT, version: 1, snapshot }))
}

async function unpack(plain: Uint8Array): Promise<SyncSnapshot> {
  const { parseSnapshot } = await import('../../shared/sync')
  let parsed: { format?: unknown; snapshot?: unknown } | null = null
  try { parsed = JSON.parse(decoder.decode(plain)) } catch { /* Reported below. */ }
  const snapshot = parsed?.format === SPACE_FORMAT ? parseSnapshot(parsed.snapshot) : null
  if (!snapshot) throw new Error('这个隐私空间的数据无法识别')
  return snapshot
}

/** Encrypts the open board and stores it; saves run one after another */
function save(current: Session): Promise<void> {
  const run = async () => {
    if (session !== current) return
    const { sealSpace, firstChunkId } = await crypto_()
    const chunks = await sealSpace(current.keys, await pack(current.service))
    const id = firstChunkId(current.keys)
    try {
      await writeVault(chunks, { id, value: current.seen })
    } catch (error) {
      // Another tab or device saved this space: what is shown here is no longer the truth
      const stored = await readVault().then((vault) => vault.chunks[id] ?? null, () => current.seen)
      if (stored !== current.seen && session === current) changed(null, '这个隐私空间已在别处被修改，请重新解锁')
      throw error
    }
    current.seen = chunks[id]
  }
  const next = current.saving.then(run, run)
  current.saving = next.catch(() => undefined)
  return next
}

export const privateSpace = {
  active: () => session !== null,
  /** Changes whenever a space is opened or closed; the interface starts over when it does */
  generation: () => generation,
  /** Why the space was closed, when it was not the user who closed it */
  takeNotice() {
    const message = notice
    notice = null
    return message
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  handles: (method: ServiceMethod) => session !== null && !OUTSIDE.has(method),

  async call(method: ServiceMethod, args: unknown[]): Promise<unknown> {
    const current = session
    if (!current) throw new Error('隐私空间已锁定')
    lastActivity = Date.now()
    const run = current.service[method] as (...values: unknown[]) => Promise<unknown>
    const result = await run.apply(current.service, args)
    if (!current.reads.has(method)) await save(current)
    return result
  },

  /** Opens the space a password leads to. False when there is none, whatever the reason. */
  async unlock(password: string): Promise<boolean> {
    const { findSpace, firstChunkId } = await crypto_()
    const vault = await readVault()
    const found = await findSpace(vault, password)
    if (!found) return false
    const board = await boardFor(await unpack(found.plain))
    changed({ ...board, keys: found.keys, seen: vault.chunks[firstChunkId(found.keys)] ?? null, saving: Promise.resolve() })
    return true
  },

  /** Creates an empty space under a password, or opens the one that is already there */
  async create(password: string): Promise<void> {
    const { MIN_PASSWORD_LENGTH, decoys, deriveKeys, findSpace, firstChunkId, sealSpace } = await crypto_()
    if ([...password].length < MIN_PASSWORD_LENGTH) throw new Error(`密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符`)
    const vault = await readVault()
    if (await findSpace(vault, password)) { await this.unlock(password); return }
    const keys = await deriveKeys(password, vault.salts[0])
    const board = await boardFor(null)
    const chunks = await sealSpace(keys, await pack(board.service))
    const id = firstChunkId(keys)
    await writeVault({ ...decoys(), ...chunks }, { id, value: vault.chunks[id] ?? null })
    changed({ ...board, keys, seen: chunks[id], saving: Promise.resolve() })
  },

  lock() {
    if (session) changed(null)
  },

  /** Moves the open space under another password; the old one stops leading anywhere */
  async changePassword(password: string): Promise<void> {
    const current = session
    if (!current) throw new Error('隐私空间已锁定')
    const { MIN_PASSWORD_LENGTH, deriveKeys, eraseSpace, findSpace, firstChunkId, sealSpace } = await crypto_()
    if ([...password].length < MIN_PASSWORD_LENGTH) throw new Error(`密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符`)
    await current.saving
    const vault = await readVault()
    if (await findSpace(vault, password)) throw new Error('不能使用这个密码，请换一个')
    const keys = await deriveKeys(password, vault.salts[0])
    const chunks = await sealSpace(keys, await pack(current.service))
    await writeVault({ ...eraseSpace(vault, current.keys), ...chunks }, { id: firstChunkId(current.keys), value: current.seen })
    current.keys = keys
    current.seen = chunks[firstChunkId(keys)]
  },

  /** Overwrites the open space with random bytes; there is no way back */
  async destroy(): Promise<void> {
    const current = session
    if (!current) throw new Error('隐私空间已锁定')
    const { eraseSpace, firstChunkId } = await crypto_()
    await current.saving
    await writeVault(eraseSpace(await readVault(), current.keys), { id: firstChunkId(current.keys), value: current.seen })
    changed(null)
  },
}

let lastActivity = Date.now()
if (typeof window !== 'undefined') {
  const touch = () => { lastActivity = Date.now() }
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(type, touch, { capture: true, passive: true })
  // Checked on a slow tick and when the tab is looked at again, as timers sleep in the background
  const check = () => { if (session && Date.now() - lastActivity >= IDLE_MS) changed(null, '隐私空间闲置已久，已自动锁定') }
  setInterval(check, 15 * 1000)
  document.addEventListener('visibilitychange', check)
}
