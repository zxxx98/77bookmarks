import { webdavTransport } from './webdav'
import { workerTransport } from './worker'
import type { SyncConfig, SyncTransport } from './types'

export function createTransport(config: SyncConfig): SyncTransport {
  return config.kind === 'webdav' ? webdavTransport(config) : workerTransport(config)
}

/** Fail-fast check used by the settings page before syncing is enabled */
export async function testTransport(config: SyncConfig): Promise<void> {
  await createTransport(config).test()
}
