import pkg from '../package.json' with { type: 'json' }
import type { UpdateStatus, UpdateTriggerResult } from '../shared/types'

const DEFAULT_REPO = 'zxxx98/77bookmarks'
const CHECK_TTL_MS = 60 * 60 * 1000
const CHECK_TIMEOUT_MS = 10 * 1000
const APPLY_TIMEOUT_MS = 30 * 1000

export interface UpdateServiceOptions {
  currentVersion?: string
  repo?: string
  webhookUrl?: string
  webhookToken?: string
  webhookMethod?: string
  cacheTtlMs?: number
  fetchFn?: typeof fetch
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

export class UpdateService {
  private readonly currentVersion: string
  private readonly repo: string
  private readonly webhookUrl: string | null
  private readonly webhookToken: string | null
  private readonly webhookMethod: 'GET' | 'POST'
  private readonly cacheTtlMs: number
  private readonly fetchFn: typeof fetch
  private state: UpdateStatus
  private inflight: Promise<UpdateStatus> | null = null

  constructor(options: UpdateServiceOptions = {}) {
    this.currentVersion = normalizeVersion(options.currentVersion ?? pkg.version)
    this.repo = (options.repo?.trim() || DEFAULT_REPO).replace(/^\/+|\/+$/g, '')
    this.webhookUrl = options.webhookUrl?.trim() || null
    this.webhookToken = options.webhookToken?.trim() || null
    this.webhookMethod = options.webhookMethod?.trim().toUpperCase() === 'GET' ? 'GET' : 'POST'
    this.cacheTtlMs = options.cacheTtlMs ?? CHECK_TTL_MS
    this.fetchFn = options.fetchFn ?? fetch
    this.state = {
      currentVersion: this.currentVersion,
      latestVersion: null,
      hasUpdate: false,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      checkedAt: null,
      canTriggerUpdate: Boolean(this.webhookUrl),
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
      }
      const rawTag = typeof data.tag_name === 'string' ? data.tag_name.trim() : ''
      if (!rawTag) throw new Error('Release 信息缺少版本号')
      const latestVersion = normalizeVersion(rawTag)
      this.state = {
        currentVersion: this.currentVersion,
        latestVersion,
        hasUpdate: compareVersions(latestVersion, this.currentVersion) > 0,
        releaseUrl: typeof data.html_url === 'string' ? data.html_url : null,
        releaseNotes: typeof data.body === 'string' && data.body.trim() ? data.body.trim() : null,
        publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
        checkedAt: Date.now(),
        canTriggerUpdate: Boolean(this.webhookUrl),
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
    if (!this.webhookUrl) {
      throw new Error('未配置更新 Webhook（UPDATE_WEBHOOK_URL），请使用 Docker 命令更新')
    }
    const headers: Record<string, string> = {}
    if (this.webhookToken) headers.authorization = `Bearer ${this.webhookToken}`
    let response: Response
    try {
      response = await this.fetchFn(this.webhookUrl, {
        method: this.webhookMethod,
        headers,
        signal: AbortSignal.timeout(APPLY_TIMEOUT_MS),
      })
    } catch (error) {
      throw new Error(error instanceof Error && error.message ? `触发更新失败：${error.message}` : '无法连接更新 Webhook')
    }
    if (!response.ok) {
      throw new Error(`触发更新失败（HTTP ${response.status}）`)
    }
    return {
      triggered: true,
      message: '已触发更新任务，服务即将重启…',
    }
  }
}
