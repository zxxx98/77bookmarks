import { snapshotFingerprint } from '../../shared/sync'
import type { LocalService } from '../storage/service'
import { createTransport } from './transport'
import { SyncConflictError, type SyncConfig, type SyncOutcome, type SyncTransport } from './types'

/** How often a conflicting write is retried before giving up until the next run */
const MAX_ATTEMPTS = 3

/**
 * One sync cycle: pull the cloud copy, merge it into the local database, upload the
 * result. Merging and writing happen in a single local transaction, and the upload is
 * conditional on the version that was merged, so a device that writes in between only
 * costs another round.
 */
export class SyncEngine {
  private running: Promise<SyncOutcome> | null = null
  constructor(private service: LocalService, private transport: (config: SyncConfig) => SyncTransport = createTransport) {}

  get busy() {
    return this.running !== null
  }

  /** Runs a cycle; calls made while one is running share it instead of piling up */
  run(force = false): Promise<SyncOutcome> {
    if (this.running) return this.running
    const cycle = this.cycle(force).finally(() => { this.running = null })
    this.running = cycle
    return cycle
  }

  private async cycle(force: boolean): Promise<SyncOutcome> {
    const { config } = await this.service.syncStatus()
    if (!config.enabled) {
      if (!force) return { status: 'disabled' }
      throw new Error('请先在系统设置里启用云同步')
    }

    const transport = this.transport(config)
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const remote = await transport.pull()
        const incoming = remote?.snapshot ?? null
        const { snapshot, stats } = await this.service.mergeRemote(incoming)
        if (remote && incoming && snapshotFingerprint(snapshot) === snapshotFingerprint(incoming)) {
          // The cloud already holds everything this device has
          await this.service.recordSyncResult({ pushed: incoming, stats })
          return { status: 'synced', stats, version: remote.version }
        }
        try {
          const version = await transport.push(snapshot, remote?.version ?? null)
          await this.service.recordSyncResult({ pushed: snapshot, stats })
          return { status: 'synced', stats, version }
        } catch (error) {
          // Another device wrote first: pull its version and merge again
          if (error instanceof SyncConflictError) continue
          throw error
        }
      }
      throw new Error('云端持续被其他设备更新，请稍后再试')
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步失败'
      await this.service.recordSyncResult({ error: message }).catch(() => undefined)
      throw error
    }
  }
}
