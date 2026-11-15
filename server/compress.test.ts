// @vitest-environment node
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { compress, compressible, pickEncoding } from './compress'

describe('compressing answers', () => {
  it('picks the best encoding the client accepts', () => {
    expect(pickEncoding('gzip, deflate, br, zstd')).toBe('br')
    expect(pickEncoding('gzip, deflate')).toBe('gzip')
    expect(pickEncoding('br;q=0, gzip;q=0.5')).toBe('gzip')
    expect(pickEncoding('identity')).toBeNull()
    expect(pickEncoding(undefined)).toBeNull()
  })
  it('leaves alone what is compressed already', () => {
    expect(compressible('application/json')).toBe(true)
    expect(compressible('text/javascript; charset=utf-8')).toBe(true)
    expect(compressible('image/svg+xml')).toBe(true)
    expect(compressible('image/png')).toBe(false)
    expect(compressible('font/woff2')).toBe(false)
    expect(compressible(null)).toBe(false)
  })
  it('gives back the same bytes, in fewer', async () => {
    const text = Buffer.from(JSON.stringify({ value: Array.from({ length: 200 }, (_, id) => ({ id, title: '书签', origin: 'https://example.com' })) }))
    for (const thorough of [false, true]) {
      const br = await compress(text, 'br', thorough)
      const gz = await compress(text, 'gzip', thorough)
      expect(br.byteLength).toBeLessThan(text.byteLength / 4)
      expect(gz.byteLength).toBeLessThan(text.byteLength / 4)
      expect(brotliDecompressSync(br).equals(text)).toBe(true)
      expect(gunzipSync(gz).equals(text)).toBe(true)
    }
  })
})
