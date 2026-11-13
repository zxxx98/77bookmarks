import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import pkg from '../package.json' with { type: 'json' }
import type { UpdateStatus, UpdateTriggerResult } from '../shared/types'

const execFileAsync = promisify(execFile)

const DEFAULT_REPO = 'zxxx98/77bookmarks'
const CHECK_TTL_MS = 60 * 60 * 1000
const CHECK_TIMEOUT_MS = 10 * 1000
const DOWNLOAD_TIMEOUT_MS = 60 * 1000
const SELFHOST_ASSET_RE = /^77bookmarks-selfhost-v?.*\.tar\.gz$/i

export interface UpdateServiceOptions {
  currentVersion?: string
  repo?: string
  /** Directory containing `server.mjs` and `public/` when running the built self-hosted bundle */
  appDir?: string | null
  /** Called shortly after an update is applied so the process can exit cleanly and restart */
  onRestart?: () => void
  cacheTtlMs?: number
  fetchFn?: typeof fetch
  extractFn?: (archivePath: string, destDir: string) => Promise<void>
}

function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '')
}

function parseVersion(raw: string): { parts: number[]; pre: string[] } | null {
  const clean = normalizeVersion(raw)
  if (!clean) return null
  const [core, ...rest] = clean.split('-')
  const nums = core.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : NaN))
  if (nums.length === 0 || nums.some(Number.isNaN)) return null
  while (nums.length < 3) nums.push(0)
  const pre = rest.length > 0 ? rest.join('-').split('.') : []
  return { parts: nums, pre }
}

/** Returns 1 if a > b, -1 if a < b, 0 if equal */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return normalizeVersion(a).localeCompare(normalizeVersion(b))
  const len = Math.max(pa.parts.length, pb.parts.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1
  if (pb.pre.length === 0) return -1
  const preLen = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < preLen; i++) {
    const left = pa.pre[i]
    const right = pb.pre[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNum = /^\d+$/.test(left) ? Number(left) : null
    const rightNum = /^\d+$/.test(right) ? Number(right) : null
    if (leftNum !== null && rightNum !== null) {
      if (leftNum !== rightNum) return leftNum > rightNum ? 1 : -1
    } else if (leftNum !== null) {
      return -1
    } else if (rightNum !== null) {
      return 1
    } else if (left !== right) {
      return left > right ? 1 : -1
    }
  }
  return 0
}

async function exists(path: string): Promise<boolean> {
  return await stat(path).then(() => true, () => false)
}

export class UpdateService {
  private readonly currentVersion: string
  private readonly repo: string
  private readonly appDir: string | null
  private readonly onRestart?: () => void
  private readonly cacheTtlMs: number
  private readonly fetchFn: typeof fetch
  private readonly extractFn: (archivePath: string, destDir: string) => Promise<void>
  private state: UpdateStatus
  private assetUrl: string | null = null
  private inflight: Promise<UpdateStatus> | null = null
  private applying = false

  constructor(options: UpdateServiceOptions = {}) {
    this.currentVersion = normalizeVersion(options.currentVersion ?? pkg.version)
    this.repo = (options.repo?.trim() || DEFAULT_REPO).replace(/^\/+|\/+$/g, '')
    this.appDir = options.appDir ?? null
    this.onRestart = options.onRestart
    this.cacheTtlMs = options.cacheTtlMs ?? CHECK_TTL_MS
    this.fetchFn = options.fetchFn ?? fetch
    this.extractFn = options.extractFn ?? (async (archivePath, destDir) => {
      await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir])
    })
    this.state = {
      currentVersion: this.currentVersion,
      latestVersion: null,
      hasUpdate: false,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      checkedAt: null,
      canTriggerUpdate: false,
      error: null,
    }
  }

  status(): UpdateStatus {
    return { ...this.state }
  }

  async check(force = false): Promise<UpdateStatus> {
    if (!force && this.state.checkedAt !== null && !this.state.error && Date.now() - this.state.checkedAt < this.cacheTtlMs) {
      return this.status()
    }
    if (this.inflight) return this.inflight
    this.inflight = this.runCheck().finally(() => { this.inflight = null })
    return this.inflight
  }

  private async runCheck(): Promise<UpdateStatus> {
    try {
      const response = await this.fetchFn(`https://api.github.com/repos/${this.repo}/releases/latest`, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': `77bookmarks-selfhost/${this.currentVersion}`,
        },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      })
      if (response.status === 404) throw new Error('仓库暂未发布任何 Release')
      if (response.status === 403) throw new Error('GitHub API 请求受限，请稍后再试')
      if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}）`)
      const data = await response.json() as {
        tag_name?: unknown
        html_url?: unknown
        body?: unknown
        published_at?: unknown
        assets?: unknown
      }
      const rawTag = typeof data.tag_name === 'string' ? data.tag_name.trim() : ''
      if (!rawTag) throw new Error('Release 信息缺少版本号')
      const latestVersion = normalizeVersion(rawTag)
      const hasUpdate = compareVersions(latestVersion, this.currentVersion) > 0
      const assets = Array.isArray(data.assets) ? data.assets : []
      const match = assets.find((item): item is { name: string; browser_download_url: string } => (
        Boolean(item) && typeof item === 'object' &&
        typeof (item as { name?: unknown }).name === 'string' &&
        SELFHOST_ASSET_RE.test((item as { name: string }).name) &&
        typeof (item as { browser_download_url?: unknown }).browser_download_url === 'string'
      ))
      this.assetUrl = match?.browser_download_url ?? null
      this.state = {
        currentVersion: this.currentVersion,
        latestVersion,
        hasUpdate,
        releaseUrl: typeof data.html_url === 'string' ? data.html_url : null,
        releaseNotes: typeof data.body === 'string' && data.body.trim() ? data.body.trim() : null,
        publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
        checkedAt: Date.now(),
        canTriggerUpdate: Boolean(hasUpdate && this.assetUrl && this.appDir),
        error: null,
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '检查更新失败，请检查网络连接'
      this.state = {
        ...this.state,
        checkedAt: Date.now(),
        error: message,
      }
    }
    return this.status()
  }

  async apply(): Promise<UpdateTriggerResult> {
    if (this.applying) throw new Error('更新正在进行中，请稍候')
    if (!this.appDir) throw new Error('当前运行方式不支持在线更新（仅支持已打包的自部署运行环境）')
    if (!this.state.hasUpdate || !this.assetUrl) throw new Error('当前没有可用的在线更新包，请先检查更新或使用 Docker 命令升级')

    this.applying = true
    const workDir = await mkdtemp(join(tmpdir(), '77bookmarks-update-'))
    const archivePath = join(workDir, 'update.tar.gz')
    const stageDir = join(workDir, 'stage')
    try {
      const response = await this.fetchFn(this.assetUrl, {
        headers: { 'user-agent': `77bookmarks-selfhost/${this.currentVersion}` },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`下载更新包失败（HTTP ${response.status}）`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength === 0) throw new Error('下载的更新包为空')
      await writeFile(archivePath, bytes)
      await mkdir(stageDir, { recursive: true })
      await this.extractFn(archivePath, stageDir)

      const stagedServer = join(stageDir, 'server.mjs')
      const stagedPublic = join(stageDir, 'public')
      if (!(await exists(stagedServer)) || !(await exists(join(stagedPublic, 'index.html')))) {
        throw new Error('更新包内容不完整，已取消更新')
      }

      const publicDir = join(this.appDir, 'public')
      const nextPublic = join(this.appDir, 'public.new')
      const oldPublic = join(this.appDir, 'public.old')
      await rm(nextPublic, { recursive: true, force: true })
      await rm(oldPublic, { recursive: true, force: true })
      await cp(stagedPublic, nextPublic, { recursive: true })
      if (await exists(publicDir)) await rename(publicDir, oldPublic)
      await rename(nextPublic, publicDir)
      await rm(oldPublic, { recursive: true, force: true })

      const nextServer = join(this.appDir, 'server.mjs.new')
      await cp(stagedServer, nextServer)
      await rename(nextServer, join(this.appDir, 'server.mjs'))

      if (this.onRestart) {
        const timer = setTimeout(this.onRestart, 300)
        timer.unref()
      }
      return {
        triggered: true,
        message: '更新包已下载并应用，服务正在重启…',
      }
    } catch (error) {
      throw new Error(error instanceof Error && error.message ? error.message : '更新失败，请稍后重试')
    } finally {
      this.applying = false
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
