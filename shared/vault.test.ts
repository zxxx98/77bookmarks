import { describe, expect, it } from 'vitest'
import { CHUNK_BYTES, createVault, decoys, deriveKeys, eraseSpace, findSpace, firstChunkId, mergeVaults, openSpace, parseChunks, parseVault, restoreVault, sealSpace, type Vault } from './vault'

// Stretching at full cost takes a third of a second per guess; the tests need not wait for it
const COST = 2 ** 10
const text = (value: string) => new TextEncoder().encode(value)
const read = (bytes: Uint8Array | null) => bytes && new TextDecoder().decode(bytes)
const withChunks = (vault: Vault, ...added: Record<string, string>[]): Vault => ({ ...vault, chunks: Object.assign({}, vault.chunks, ...added) })
const keysOf = (vault: Vault, password: string) => deriveKeys(password, vault.salts[0], COST)

describe('the vault of private spaces', () => {
  it('starts out as random records of one size that parse back unchanged', () => {
    const vault = createVault()
    const count = Object.keys(vault.chunks).length
    expect(count).toBeGreaterThanOrEqual(16)
    expect(count).toBeLessThanOrEqual(48)
    for (const chunk of Object.values(vault.chunks)) expect(atob(chunk)).toHaveLength(CHUNK_BYTES)
    expect(parseVault(JSON.parse(JSON.stringify(vault)))).toEqual(vault)
    expect(createVault().salts).not.toEqual(vault.salts)
  })

  it('finds a space by its password alone and tells a wrong password from nothing', async () => {
    let vault = createVault()
    const keys = await keysOf(vault, 'correct horse')
    vault = withChunks(vault, await sealSpace(keys, text('{"hello":"世界"}')))
    expect(read((await findSpace(vault, 'correct horse', COST))!.plain)).toBe('{"hello":"世界"}')
    expect(await findSpace(vault, 'correct horsf', COST)).toBeNull()
    expect(await findSpace(createVault(), 'correct horse', COST)).toBeNull()
    // Full-width and composed forms of the same password are the same password
    expect(read((await findSpace(vault, 'ｃｏｒｒｅｃｔ horse', COST))!.plain)).toBe('{"hello":"世界"}')
  })

  it('keeps several spaces apart, each as records no different from the random ones', async () => {
    let vault = createVault()
    const before = Object.keys(vault.chunks).length
    const big = JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ origin: `https://site-${i}-${Math.random()}.example.com`, title: `站点 ${i}` })))
    const [a, b] = [await keysOf(vault, 'password-a'), await keysOf(vault, 'password-b')]
    vault = withChunks(vault, await sealSpace(a, text(big)), await sealSpace(b, text('small')))
    expect(read(await openSpace(vault, a))).toBe(big)
    expect(read(await openSpace(vault, b))).toBe('small')
    expect(Object.keys(vault.chunks).length).toBeGreaterThan(before + 5)
    for (const [id, chunk] of Object.entries(vault.chunks)) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
      expect(atob(chunk)).toHaveLength(CHUNK_BYTES)
    }
    expect(parseVault(JSON.parse(JSON.stringify(vault)))).toEqual({ ...vault, chunks: Object.fromEntries(Object.entries(vault.chunks).sort(([x], [y]) => (x < y ? -1 : 1))) })
  })

  it('never encrypts the same contents to the same records twice', async () => {
    const vault = createVault()
    const keys = await keysOf(vault, 'password-a')
    const id = firstChunkId(keys)
    expect((await sealSpace(keys, text('same')))[id]).not.toBe((await sealSpace(keys, text('same')))[id])
  })

  it('reads a space that shrank and reports one whose records were damaged', async () => {
    let vault = createVault()
    const keys = await keysOf(vault, 'password-a')
    const long = Array.from({ length: 300 }, () => Math.random().toString(36)).join('')
    vault = withChunks(vault, await sealSpace(keys, text(long)))
    const count = Object.keys(vault.chunks).length
    vault = withChunks(vault, await sealSpace(keys, text('short')))
    expect(read(await openSpace(vault, keys))).toBe('short')
    expect(Object.keys(vault.chunks).length).toBeLessThanOrEqual(count + 1)

    vault = withChunks(vault, await sealSpace(keys, text(long)))
    const [first, second] = [firstChunkId(keys), Object.keys(await sealSpace(keys, text(long))).find((id) => id !== firstChunkId(keys) && vault.chunks[id])!]
    const swapped = withChunks(vault, { [second]: vault.chunks[first] })
    await expect(openSpace(swapped, keys)).rejects.toThrow('不完整')
  })

  it('destroys a space by overwriting it, leaving the vault the size it was', async () => {
    let vault = createVault()
    const [a, b] = [await keysOf(vault, 'password-a'), await keysOf(vault, 'password-b')]
    vault = withChunks(vault, await sealSpace(a, text('a'.repeat(5000) + Math.random())), await sealSpace(b, text('keep me')))
    const erased = eraseSpace(vault, a)
    expect(Object.keys(erased).every((id) => id in vault.chunks)).toBe(true)
    const after = withChunks(vault, erased)
    expect(Object.keys(after.chunks)).toHaveLength(Object.keys(vault.chunks).length)
    expect(await openSpace(after, a)).toBeNull()
    expect(read(await openSpace(after, b))).toBe('keep me')
    // The password is free again
    expect(read(await openSpace(withChunks(after, await sealSpace(a, text('again'))), a))).toBe('again')
  })

  it('merges two copies without dropping a record, taking each space from the side that changed it', async () => {
    const base = withChunks(createVault(), decoys())
    const [a, b, c] = [await keysOf(base, 'password-a'), await keysOf(base, 'password-b'), await keysOf(base, 'password-c')]
    const shared = withChunks(base, await sealSpace(a, text('a1')), await sealSpace(b, text('b1')))
    const local = withChunks(shared, await sealSpace(a, text('a2 from here')), await sealSpace(c, text('c only here')))
    const remote = withChunks(shared, await sealSpace(b, text('b2 from there')), decoys())
    const merged = mergeVaults(shared, local, remote)!
    expect(read(await openSpace(merged, a))).toBe('a2 from here')
    expect(read(await openSpace(merged, b))).toBe('b2 from there')
    expect(read(await openSpace(merged, c))).toBe('c only here')
    expect(Object.keys(merged.chunks).sort()).toEqual([...new Set([...Object.keys(local.chunks), ...Object.keys(remote.chunks)])].sort())
    // Both sides changed the same space: the cloud's copy wins as a whole, whatever its length
    const long = Array.from({ length: 300 }, () => Math.random().toString(36)).join('')
    const here = withChunks(shared, await sealSpace(a, text(long)))
    const there = withChunks(shared, await sealSpace(a, text('theirs')))
    expect(read(await openSpace(mergeVaults(shared, here, there)!, a))).toBe('theirs')
    expect(read(await openSpace(mergeVaults(shared, there, here)!, a))).toBe(long)
    expect(read(await openSpace(mergeVaults(null, here, there)!, a))).toBe('theirs')
  })

  it('keeps the salts of both sides, and a side without a vault changes nothing', async () => {
    const [here, there] = [createVault(), createVault()]
    const keys = await deriveKeys('password-a', there.salts[0], COST)
    const remote = withChunks(there, await sealSpace(keys, text('from another device')))
    const merged = mergeVaults(null, here, remote)!
    expect(merged.salts).toEqual([here.salts[0], there.salts[0]].sort())
    expect(read((await findSpace(merged, 'password-a', COST))!.plain)).toBe('from another device')
    expect(mergeVaults(here, here, undefined)).toBe(here)
    expect(mergeVaults(null, undefined, remote)).toBe(remote)
    expect(mergeVaults(null, undefined, undefined)).toBeUndefined()
    expect(restoreVault(here, remote).chunks).toMatchObject(here.chunks)
  })

  it('rejects anything that is not a vault and drops records of the wrong shape', () => {
    const vault = createVault()
    expect(parseVault(null)).toBeNull()
    expect(parseVault({ ...vault, version: 2 })).toBeNull()
    expect(parseVault({ ...vault, salts: [] })).toBeNull()
    expect(parseVault({ ...vault, salts: ['short'] })).toBeNull()
    const [id, chunk] = Object.entries(vault.chunks)[0]
    const parsed = parseVault({ ...vault, chunks: { ...vault.chunks, 'bad id': chunk, [id]: chunk.slice(4), __proto__: chunk } })!
    expect(Object.keys(parsed.chunks)).toHaveLength(Object.keys(vault.chunks).length - 1)
    expect(parseChunks({ [id]: chunk })).toEqual({ [id]: chunk })
    expect(parseChunks({ [id]: chunk.slice(4) })).toBeNull()
    expect(parseChunks({ nope: chunk })).toBeNull()
    expect(parseChunks([chunk])).toBeNull()
  })
})
