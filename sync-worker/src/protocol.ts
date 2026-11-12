/** Keep this directory self-contained: Deploy to Cloudflare copies only sync-worker/. */
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024

/** The server stores an opaque client snapshot; the client validates every record. */
export function parseSnapshot(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as Record<string, unknown>
  if (snapshot.format !== '77bookmarks-sync' || snapshot.version !== 1) return null
  if (typeof snapshot.deviceId !== 'string' || typeof snapshot.updatedAt !== 'number' || !Number.isSafeInteger(snapshot.since) || (snapshot.since as number) < 0) return null
  if (!snapshot.settings || typeof snapshot.settings !== 'object' || Array.isArray(snapshot.settings)) return null
  for (const key of ['desktops', 'groups', 'sites', 'links', 'todos']) if (!Array.isArray(snapshot[key])) return null
  return snapshot
}
