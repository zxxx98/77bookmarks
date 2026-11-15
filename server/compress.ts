import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

export type Encoding = 'br' | 'gzip'

/** Below this the saving is not worth a header, let alone the work */
export const MIN_COMPRESS_BYTES = 1024
// Text, and the two picture formats that are not compressed already
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json)|image\/(svg\+xml|x-icon|vnd\.microsoft\.icon))/i
const brotli = promisify(brotliCompress)
const deflate = promisify(gzip)

export const compressible = (type: string | null | undefined) => COMPRESSIBLE.test(type ?? '')

/** The best encoding the client accepts, read from its Accept-Encoding header */
export function pickEncoding(accept: string | null | undefined): Encoding | null {
  const accepted = new Set<string>()
  for (const part of (accept ?? '').toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map((value) => value.trim())
    const q = params.find((param) => param.startsWith('q='))
    if (name && (!q || Number(q.slice(2)) > 0)) accepted.add(name)
  }
  return accepted.has('br') ? 'br' : accepted.has('gzip') ? 'gzip' : null
}

/**
 * `thorough` is for files that are compressed once and served many times; answers made
 * for one request are compressed quickly instead.
 */
export async function compress(bytes: Uint8Array, encoding: Encoding, thorough = false): Promise<Buffer> {
  if (encoding === 'gzip') return deflate(bytes, { level: thorough ? 9 : 6 })
  return brotli(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: thorough ? constants.BROTLI_MAX_QUALITY : 5,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
    },
  })
}
