const COOKIE = 'bm_session'
const MAX_AGE = 30 * 24 * 60 * 60

const encoder = new TextEncoder()

async function hmac(secret: string, data: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return crypto.subtle.sign('HMAC', key, encoder.encode(data))
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function cookie(value: string, maxAge: number, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`
}

export async function createSessionCookie(request: Request, secret: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE
  const signature = toHex(await hmac(secret, String(expires)))
  return cookie(`${expires}.${signature}`, MAX_AGE, request)
}

export function clearSessionCookie(request: Request): string {
  return cookie('', 0, request)
}

export async function hasValidSession(request: Request, secret: string): Promise<boolean> {
  const match = (request.headers.get('Cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]{64})`))
  if (!match) return false
  const [, expires, signature] = match
  if (Number(expires) < Date.now() / 1000) return false
  const expected = toHex(await hmac(secret, expires))
  return crypto.subtle.timingSafeEqual(encoder.encode(signature), encoder.encode(expected))
}

/** Compares digests so the check takes the same time whatever the input length */
export async function passwordMatches(input: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(input)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  return crypto.subtle.timingSafeEqual(a, b)
}
