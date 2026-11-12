import { syncFetch } from './fetch'
import { MAX_SNAPSHOT_BYTES, parseSnapshot } from '../../shared/sync'
import { SyncConflictError, type SyncConfig, type SyncTransport } from './types'

const trim = (endpoint: string) => endpoint.replace(/\/+$/, '')
const bare = (value: string | null) => value?.replace(/^W\//, '').replace(/^"|"$/g, '') || null

const MESSAGES: Record<number, string> = {
  401: '同步令牌不正确',
  403: '没有访问权限',
  404: '地址不存在，请检查 Worker 地址',
  413: '数据太大，无法上传',
  500: '云端出错，请稍后重试',
}

async function failure(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null
  return new Error(MESSAGES[response.status] ?? (typeof body?.error === 'string' ? `云端返回：${body.error}` : `同步失败（HTTP ${response.status}）`))
}

/**
 * Talks to the worker in `sync-worker/`: it stores the snapshot verbatim and guards writes
 * with a version, which is what lets several devices merge safely.
 */
export function workerTransport(config: SyncConfig): SyncTransport {
  const root = trim(config.endpoint)
  const snapshotUrl = `${root}/v1/snapshot`
  const headers = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${config.token}`, ...extra })

  const pull = async () => {
    const response = await syncFetch(snapshotUrl, { headers: headers(), cache: 'no-store' })
    if (response.status === 404) {
      const body = await response.json().catch(() => null) as { error?: unknown } | null
      if (body?.error === 'Empty vault') return null
      throw new Error('地址不存在，请检查 Worker 地址')
    }
    if (!response.ok) throw await failure(response)
    const raw = await response.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('云端数据超过 4 MB')
    let body: { version?: unknown; snapshot?: unknown } | null
    try { body = JSON.parse(raw) } catch { body = null }
    const snapshot = parseSnapshot(body?.snapshot)
    const version = bare(response.headers.get('etag')) ?? (typeof body?.version === 'number' ? String(body.version) : null)
    if (!snapshot || !version) throw new Error('云端数据无法识别，请确认地址指向本项目的同步 Worker')
    return { version, snapshot }
  }

  return {
    pull,
    async push(snapshot, version) {
      const body = JSON.stringify({ snapshot })
      if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('本地数据太大，无法上传')
      const response = await syncFetch(snapshotUrl, {
        method: 'PUT',
        headers: headers({ 'content-type': 'application/json', ...(version === null ? { 'if-none-match': '*' } : { 'if-match': `"${version}"` }) }),
        body,
      })
      if (response.status === 412) throw new SyncConflictError(bare(response.headers.get('etag')))
      if (!response.ok) throw await failure(response)
      const etag = bare(response.headers.get('etag'))
      if (etag) return etag
      const parsed = await response.json().catch(() => null) as { version?: unknown } | null
      if (typeof parsed?.version !== 'number' || !Number.isSafeInteger(parsed.version)) throw new Error('云端没有返回有效版本号')
      return String(parsed.version)
    },
    async test() {
      // Reading the snapshot also proves the token is accepted; an empty vault answers 404.
      await pull()
    },
  }
}
