/** randomUUID requires a secure context; getRandomValues also works in HTTP previews. */
export function createSyncId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const encoder = new TextEncoder()

/**
 * Identity derived from a natural key, so two devices that create the same record while
 * offline end up describing one record instead of two. Only used where a natural key
 * exists (a card is its desktop plus origin, a link is its card plus path); everything
 * else keeps a random id.
 *
 * The result must stay a valid backup identifier: `[a-z0-9-]`, at most 100 characters.
 * WebCrypto is unavailable on an insecure preview origin, and then a random id is used
 * instead: the merge folds the two identities back together, so this is an optimisation
 * and never a correctness requirement.
 */
export async function deriveSyncId(prefix: 's' | 'l', ...parts: string[]): Promise<string> {
  if (!crypto.subtle) return createSyncId()
  try {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(parts.join('\u0000')))
    const hex = Array.from(new Uint8Array(digest, 0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${prefix}-${hex}`
  } catch {
    return createSyncId()
  }
}
