import type { MergeStats, SyncSnapshot } from '../../shared/sync'

/** Where the cloud copy is kept */
export type SyncKind = 'worker' | 'webdav'

export interface SyncConfig {
  enabled: boolean
  kind: SyncKind
  /** Deployed worker address, or the WebDAV folder the sync file is written to */
  endpoint: string
  /** Bearer token of the worker; unused for WebDAV */
  token: string
  /** WebDAV credentials; unused for the worker */
  username: string
  password: string
}

export const EMPTY_SYNC_CONFIG: SyncConfig = { enabled: false, kind: 'worker', endpoint: '', token: '', username: '', password: '' }

export const SYNC_FILENAME = '77bookmarks-sync.json'

export interface SyncState {
  lastSyncAt: number | null
  lastResult: MergeStats | null
  lastError: string | null
}

export const EMPTY_SYNC_STATE: SyncState = { lastSyncAt: null, lastResult: null, lastError: null }

export interface SyncStatus {
  config: SyncConfig
  state: SyncState
  deviceId: string
  /** True once this device has synced at least once, so deletions can be recognised */
  synced: boolean
  /** Local data differs from the common ancestor, i.e. there is something to upload */
  dirty: boolean
}

export const isSyncKind = (value: unknown): value is SyncKind => value === 'worker' || value === 'webdav'

/** A copy of the cloud snapshot together with the version it was read at */
export interface RemoteSnapshot {
  version: string
  snapshot: SyncSnapshot
}

/** Thrown when the cloud was written by another device in the meantime */
export class SyncConflictError extends Error {
  constructor(readonly version: string | null) {
    super('云端已被其他设备更新')
  }
}

export interface SyncTransport {
  /** Pull the current cloud copy, or null when nothing has been stored yet */
  pull(): Promise<RemoteSnapshot | null>
  /** Store a snapshot, conditional on `version`; returns the new version */
  push(snapshot: SyncSnapshot, version: string | null): Promise<string>
  /** Fail-fast check used by the settings page */
  test(): Promise<void>
}

export interface SyncOutcome {
  status: 'synced' | 'unchanged' | 'disabled' | 'busy'
  stats?: MergeStats
  version?: string
}
