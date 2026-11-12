import type { AccessTokenStatus } from '../../shared/types'
import type { LocalService, ServiceMethod } from '../storage/service'
import type { SyncMethod, SyncResults } from '../sync/control'

/** What reading a page for its title came to; `permission` means the browser has to be asked first */
export type PageHtml = { status: 'ok'; html: string | null } | { status: 'permission' }

/**
 * Everything that differs between the editions of the app. The interface and the data
 * rules are shared; an adapter only decides where the data lives and how it is reached.
 */
export interface Platform {
  kind: 'extension' | 'selfhost'
  /** Runs one method of the data service, wherever that service lives */
  call<K extends ServiceMethod>(method: K, ...args: Parameters<LocalService[K]>): Promise<Awaited<ReturnType<LocalService[K]>>>
  /** Cloud-sync requests do network work, so they travel apart from data requests */
  syncCall<K extends SyncMethod>(method: K, ...args: unknown[]): Promise<SyncResults[K]>
  /** Calls back whenever the data changed somewhere else: another tab, device or the clipper */
  onDataChanged(listener: () => void): () => void
  /** Keeps appearance preferences somewhere more durable than localStorage, where there is such a place */
  preferences: {
    hydrate(): Promise<void>
    mirror(key: string, value: string | null): void
  }
  /** Downloads the start of a page so its title can be read */
  pageHtml(url: string, origin: string, requestPermission: boolean): Promise<PageHtml>
  /** Per-site access the browser has to grant; absent where requests need no such grant */
  hostAccess?: {
    contains(origin: string): Promise<boolean>
    request(origin: string): Promise<boolean>
  }
  /** Signing in; absent where the data belongs to the browser profile itself */
  session?: {
    status(): Promise<{ authenticated: boolean; siteName: string }>
    login(password: string): Promise<void>
    logout(): Promise<void>
    /** Calls back when the server stops accepting the session */
    onExpired(listener: () => void): () => void
  }
  /** Connecting the right-click extension; absent where the app is the extension */
  clipper?: {
    status(): Promise<AccessTokenStatus | null>
    /** Replaces any earlier connection; the code is only ever shown once */
    create(): Promise<{ code: string; createdAt: number }>
    revoke(): Promise<void>
  }
}
