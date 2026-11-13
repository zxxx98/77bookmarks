import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { scryptAsync } from '@noble/hashes/scrypt.js'
import { sha256 } from '@noble/hashes/sha2.js'

/**
 * The vault holds every private space of an installation, and is built so that nothing but
 * a password tells how many there are, or whether there are any at all.
 *
 * It is a bag of equally sized records. Some are pieces of an encrypted space, the rest are
 * random bytes, and the two cannot be told apart. There is no list of spaces: the password
 * of a space yields the key its record names are computed from, so a space is found by
 * asking for the names its password leads to. Every installation has a vault filled with
 * random records from its first start, so having one says nothing either.
 *
 * Records are only ever added or overwritten, never removed: deleting a space overwrites its
 * records with random bytes, which leaves the vault looking as it did before.
 *
 * The cryptography is plain JavaScript rather than WebCrypto, which browsers withhold from
 * pages opened over plain HTTP, as a self-hosted board on a home network often is.
 */
export const VAULT_FORMAT = '77bookmarks-vault'
export const VAULT_VERSION = 1

export interface Vault {
  format: typeof VAULT_FORMAT
  version: typeof VAULT_VERSION
  /**
   * Salts passwords are stretched with, sorted. A vault starts with one; merging the vaults
   * of two devices keeps both, since spaces may exist under either.
   */
  salts: string[]
  /** Record name → record, both base64; every record is exactly `CHUNK_BYTES` long */
  chunks: Record<string, string>
}

export const CHUNK_BYTES = 1024
const NONCE_BYTES = 24
const TAG_BYTES = 16
const BODY_BYTES = CHUNK_BYTES - NONCE_BYTES - TAG_BYTES
const ID_BYTES = 16
const SALT_BYTES = 16
/** Bytes of the stream that say how long the packed contents are */
const HEADER_BYTES = 4
/** 64 MB of memory per guess: about a third of a second here, and costly to try in bulk */
export const SCRYPT_COST = 2 ** 16
export const MIN_PASSWORD_LENGTH = 8
/** Far more than the devices of one person; merging never drops a salt, as spaces may hang on any */
export const MAX_SALTS = 64
/** What a vault may grow to; a record is about 1.4 KB once encoded */
export const MAX_CHUNKS = 2000
/** A single space: about 590 KB packed, several thousand bookmarks */
const MAX_SPACE_CHUNKS = 600
const MAX_PLAIN_BYTES = 16 * 1024 * 1024
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/
const SALT_PATTERN = /^[A-Za-z0-9_-]{22}$/

const encoder = new TextEncoder()

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  // getRandomValues fills at most 64 KB per call
  for (let offset = 0; offset < length; offset += 65536) crypto.getRandomValues(bytes.subarray(offset, Math.min(length, offset + 65536)))
  return bytes
}
function randomInt(min: number, max: number): number {
  const [value] = crypto.getRandomValues(new Uint32Array(1))
  return min + (value % (max - min + 1))
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}
function fromBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}
const toUrl = (bytes: Uint8Array) => toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const fromUrl = (text: string) => fromBase64(text.replaceAll('-', '+').replaceAll('_', '/'))

/** A record of random bytes, as stored */
const noise = () => toBase64(randomBytes(CHUNK_BYTES))
const randomId = () => toUrl(randomBytes(ID_BYTES))

function isChunk(value: unknown): value is string {
  // 1024 bytes are 1368 base64 characters, the last of them padding
  return typeof value === 'string' && value.length === 1368 && /^[A-Za-z0-9+/]{1366}[A-Za-z0-9+/=]{2}$/.test(value)
}

/** A vault for a new installation: nothing in it but random records */
export function createVault(): Vault {
  const chunks: Record<string, string> = {}
  for (let count = randomInt(16, 48); count > 0; count--) chunks[randomId()] = noise()
  return { format: VAULT_FORMAT, version: VAULT_VERSION, salts: [toUrl(randomBytes(SALT_BYTES))], chunks }
}

/** Validates a vault that arrived from a file, the cloud or another process; malformed records are dropped */
export function parseVault(input: unknown): Vault | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  if (value.format !== VAULT_FORMAT || value.version !== VAULT_VERSION) return null
  if (!Array.isArray(value.salts) || !value.chunks || typeof value.chunks !== 'object' || Array.isArray(value.chunks)) return null
  const salts = [...new Set(value.salts.filter((salt): salt is string => typeof salt === 'string' && SALT_PATTERN.test(salt)))].sort().slice(0, MAX_SALTS)
  if (!salts.length) return null
  const chunks: Record<string, string> = {}
  // Sorted, so that every device describes the same vault with the same text
  for (const id of Object.keys(value.chunks).sort().slice(0, MAX_CHUNKS * 2)) {
    const chunk = (value.chunks as Record<string, unknown>)[id]
    if (ID_PATTERN.test(id) && isChunk(chunk)) chunks[id] = chunk
  }
  return { format: VAULT_FORMAT, version: VAULT_VERSION, salts, chunks }
}

/** Checks records about to be stored, as sent by the page that encrypted them */
export function parseChunks(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const chunks: Record<string, string> = {}
  for (const [id, chunk] of Object.entries(input)) {
    if (!ID_PATTERN.test(id) || !isChunk(chunk)) return null
    chunks[id] = chunk
  }
  return chunks
}

/**
 * Brings two copies of a vault together. Nothing is ever removed, because a record that is
 * missing on one side may be a space the other side has never heard of. A record only one
 * side rewrote is taken from that side; one both rewrote is taken from `remote`.
 *
 * Whoever saves a space rewrites all of its records at once, so the records of one space
 * always come out of this from the same side.
 */
export function mergeVaults(base: Vault | null | undefined, local: Vault | null | undefined, remote: Vault | null | undefined): Vault | undefined {
  if (!local) return remote ?? undefined
  if (!remote) return local
  const chunks: Record<string, string> = {}
  for (const id of [...new Set([...Object.keys(local.chunks), ...Object.keys(remote.chunks)])].sort()) {
    const here = local.chunks[id]
    const there = remote.chunks[id]
    chunks[id] = there === undefined ? here : here === undefined || here === base?.chunks[id] ? there : there === base?.chunks[id] ? here : there
  }
  return { format: VAULT_FORMAT, version: VAULT_VERSION, salts: [...new Set([...local.salts, ...remote.salts])].sort(), chunks }
}

/** Restoring a backup: its records replace the ones stored under the same name, the rest stay */
export function restoreVault(current: Vault | null | undefined, backup: Vault): Vault {
  return mergeVaults(null, current, backup)!
}

/** The keys a password leads to under one salt of a vault */
export interface SpaceKeys {
  salt: string
  /** Names the records of the space */
  locate: Uint8Array
  /** Encrypts them */
  seal: Uint8Array
}

export async function deriveKeys(password: string, salt: string, cost = SCRYPT_COST): Promise<SpaceKeys> {
  const saltBytes = fromUrl(salt)
  if (!saltBytes) throw new Error('保险库已损坏')
  // The same password must give the same keys whatever keyboard or input method typed it
  const master = await scryptAsync(encoder.encode(password.normalize('NFKC')), saltBytes, { N: cost, r: 8, p: 1, dkLen: 32, maxmem: 2 ** 31 })
  const sub = (label: string) => hkdf(sha256, master, undefined, encoder.encode(`77bookmarks-vault/${label}`), 32)
  return { salt, locate: sub('locate'), seal: sub('seal') }
}

function chunkId(keys: SpaceKeys, index: number): string {
  const counter = new Uint8Array(4)
  new DataView(counter.buffer).setUint32(0, index)
  return toUrl(hmac(sha256, keys.locate, counter).subarray(0, ID_BYTES))
}

/** Name of the record a space starts with, which is what tells whether it was changed elsewhere */
export const firstChunkId = (keys: SpaceKeys) => chunkId(keys, 0)

function openChunk(keys: SpaceKeys, id: string, stored: string | undefined): Uint8Array | null {
  const bytes = stored === undefined ? null : fromBase64(stored)
  if (bytes?.length !== CHUNK_BYTES) return null
  try {
    // The name is authenticated with the contents, so a record cannot be moved to another place
    return xchacha20poly1305(keys.seal, bytes.subarray(0, NONCE_BYTES), encoder.encode(id)).decrypt(bytes.subarray(NONCE_BYTES))
  } catch {
    return null
  }
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader()
  const parts: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { void reader.cancel().catch(() => undefined); throw new Error('隐私空间的内容过大') }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.byteLength }
  return out
}

/**
 * Reads the space these keys lead to. Null means there is none, which is also the answer
 * for a wrong password: the two cases are the same case.
 */
export async function openSpace(vault: Vault, keys: SpaceKeys): Promise<Uint8Array | null> {
  const first = openChunk(keys, chunkId(keys, 0), vault.chunks[chunkId(keys, 0)])
  if (!first) return null
  const length = new DataView(first.buffer, first.byteOffset).getUint32(0)
  const count = Math.ceil((HEADER_BYTES + length) / BODY_BYTES)
  if (count < 1 || count > MAX_SPACE_CHUNKS) return null
  const stream = new Uint8Array(count * BODY_BYTES)
  stream.set(first)
  for (let index = 1; index < count; index++) {
    const id = chunkId(keys, index)
    const body = openChunk(keys, id, vault.chunks[id])
    // A space whose later records are gone or foreign is damaged, not absent
    if (!body) throw new Error('这个隐私空间的数据不完整，无法打开')
    stream.set(body, index * BODY_BYTES)
  }
  try {
    return await transform(stream.subarray(HEADER_BYTES, HEADER_BYTES + length), new DecompressionStream('deflate-raw'), MAX_PLAIN_BYTES)
  } catch {
    throw new Error('这个隐私空间的数据已损坏，无法打开')
  }
}

/**
 * Encrypts the contents of a space into the records to store. Every record of the space is
 * written anew each time, and now and then a random one is added, so that the growth of the
 * vault does not follow the growth of any one space.
 */
export async function sealSpace(keys: SpaceKeys, plain: Uint8Array): Promise<Record<string, string>> {
  const packed = await transform(plain, new CompressionStream('deflate-raw'), MAX_PLAIN_BYTES)
  const count = Math.ceil((HEADER_BYTES + packed.length) / BODY_BYTES)
  if (count > MAX_SPACE_CHUNKS) throw new Error('这个隐私空间的内容太多，无法保存')
  const stream = new Uint8Array(count * BODY_BYTES)
  new DataView(stream.buffer).setUint32(0, packed.length)
  stream.set(packed, HEADER_BYTES)
  const chunks: Record<string, string> = {}
  for (let index = 0; index < count; index++) {
    const id = chunkId(keys, index)
    const nonce = randomBytes(NONCE_BYTES)
    const sealed = xchacha20poly1305(keys.seal, nonce, encoder.encode(id)).encrypt(stream.subarray(index * BODY_BYTES, (index + 1) * BODY_BYTES))
    const record = new Uint8Array(CHUNK_BYTES)
    record.set(nonce)
    record.set(sealed, NONCE_BYTES)
    chunks[id] = toBase64(record)
  }
  if (randomInt(0, 3) === 0) chunks[randomId()] = noise()
  return chunks
}

/** Random records for a newly created space to arrive among */
export function decoys(): Record<string, string> {
  const chunks: Record<string, string> = {}
  for (let count = randomInt(1, 6); count > 0; count--) chunks[randomId()] = noise()
  return chunks
}

/** What to store in order to destroy a space: random bytes over every record it ever had */
export function eraseSpace(vault: Vault, keys: SpaceKeys): Record<string, string> {
  const chunks: Record<string, string> = {}
  for (let index = 0; index < MAX_SPACE_CHUNKS; index++) {
    const id = chunkId(keys, index)
    if (vault.chunks[id] === undefined) break
    chunks[id] = noise()
  }
  return chunks
}

/** Tries a password against every salt of the vault */
export async function findSpace(vault: Vault, password: string, cost = SCRYPT_COST): Promise<{ keys: SpaceKeys; plain: Uint8Array } | null> {
  for (const salt of vault.salts) {
    const keys = await deriveKeys(password, salt, cost)
    const plain = await openSpace(vault, keys)
    if (plain) return { keys, plain }
  }
  return null
}
