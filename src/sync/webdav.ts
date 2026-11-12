import { MAX_SNAPSHOT_BYTES, parseSnapshot, type SyncSnapshot } from '../../shared/sync'
import { SYNC_FILENAME, SyncConflictError, type SyncConfig, type SyncTransport } from './types'
import { syncFetch } from './fetch'

const FILE_FORMAT = '77bookmarks-sync-file'
interface SyncFile { format: typeof FILE_FORMAT; version: number; snapshot: SyncSnapshot }

function credentials(config: SyncConfig): string {
  const bytes = new TextEncoder().encode(`${config.username}:${config.password}`)
  return `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`
}
function fileUrl(endpoint: string): string {
  const url = new URL(endpoint)
  if (!/\.json$/i.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/+$/, '')}/${SYNC_FILENAME}`
  return url.href
}

/** Uses standard conditional requests; refuses weak or missing ETags to avoid lost writes. */
export function webdavTransport(config: SyncConfig): SyncTransport {
  const url = fileUrl(config.endpoint)
  const headers = (extra: Record<string, string> = {}) => ({ authorization: credentials(config), ...extra })
  const read = async () => {
    const response = await syncFetch(url, { headers: headers() })
    if (response.status === 404 || response.status === 410) return null
    if (response.status === 401 || response.status === 403) throw new Error('WebDAV 账号或密码不正确')
    if (!response.ok) throw new Error(`读取云端文件失败（HTTP ${response.status}）`)
    const body = await response.text()
    if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('云端文件超过 4 MB')
    let parsed: unknown
    try { parsed = JSON.parse(body) } catch { throw new Error('云端文件不是有效的同步数据') }
    const file = parsed as Partial<SyncFile> | null
    const snapshot = file?.format === FILE_FORMAT ? parseSnapshot(file.snapshot) : null
    if (!snapshot || !Number.isSafeInteger(file?.version) || file!.version! < 1) throw new Error('云端文件无法识别，请确认同步目录里是本项目写入的文件')
    const etag = response.headers.get('etag')
    if (!etag || !/^"[^"\r\n]+"$/.test(etag)) throw new Error('此 WebDAV 未提供强 ETag，无法安全同步；请使用支持条件写入的服务器或 Cloudflare Worker')
    return { version: etag, snapshot, fileVersion: file!.version! }
  }
  return {
    pull: async () => {
      const found = await read()
      return found ? { version: found.version, snapshot: found.snapshot } : null
    },
    async push(snapshot, version) {
      const found = await read()
      if ((found?.version ?? null) !== version) throw new SyncConflictError(found?.version ?? null)
      const next: SyncFile = { format: FILE_FORMAT, version: (found?.fileVersion ?? 0) + 1, snapshot }
      const body = JSON.stringify(next)
      if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('本地数据太大，无法上传')
      const response = await syncFetch(url, {
        method: 'PUT',
        headers: headers({ 'content-type': 'application/json', ...(version === null ? { 'if-none-match': '*' } : { 'if-match': version }) }),
        body,
      })
      if (response.status === 412) throw new SyncConflictError(response.headers.get('etag'))
      if (response.status === 401 || response.status === 403) throw new Error('WebDAV 账号或密码不正确')
      if (response.status === 409) throw new Error('同步目录不存在，请先在 WebDAV 里创建它')
      if (!response.ok) throw new Error(`写入云端文件失败（HTTP ${response.status}）`)
      const written = await read()
      if (!written || JSON.stringify(written.snapshot) !== JSON.stringify(parseSnapshot(snapshot))) throw new SyncConflictError(written?.version ?? null)
      return written.version
    },
    async test() { await read() },
  }
}
