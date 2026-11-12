import type { LocalService } from '../storage/service'
import { SyncEngine } from './engine'
import { testTransport } from './transport'
import { EMPTY_SYNC_CONFIG, type SyncConfig, type SyncOutcome, type SyncStatus } from './types'

export const SYNC_METHODS = ['status', 'configure', 'test', 'now'] as const
export type SyncMethod = typeof SYNC_METHODS[number]

/** What each request answers, so the settings page gets proper types */
export interface SyncResults {
  status: SyncStatus
  configure: SyncConfig
  test: null
  now: SyncOutcome
}

const engines = new WeakMap<LocalService, SyncEngine>()
function engineFor(service: LocalService) {
  let engine = engines.get(service)
  if (!engine) {
    engine = new SyncEngine(service)
    engines.set(service, engine)
  }
  return engine
}

export interface SyncCallResult {
  value: unknown
  /** True when the cloud copy changed local data, so open pages should refresh */
  changed: boolean
}

/**
 * The single implementation behind both the extension's background worker and the
 * browser preview: the settings page only ever sends one of these four requests.
 */
export async function runSyncMethod(service: LocalService, method: string, args: unknown[]): Promise<SyncCallResult> {
  switch (method) {
    case 'status':
      return { value: await service.syncStatus(), changed: false }
    case 'configure':
      if (engineFor(service).busy) throw new Error('正在同步，请完成后再修改连接设置')
      return { value: await service.updateSyncConfig({ ...(args[0] as Partial<SyncConfig> | undefined) }), changed: false }
    case 'test':
      // The page may test settings that have not been saved yet
      await testTransport({ ...EMPTY_SYNC_CONFIG, ...(args[0] as Partial<SyncConfig> | undefined) })
      return { value: null, changed: false }
    case 'now': {
      const outcome = await engineFor(service).run(args[0] !== false)
      return { value: outcome, changed: outcome.status === 'synced' }
    }
    default:
      throw new Error('无效的同步请求')
  }
}
