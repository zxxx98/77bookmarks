import { parseClickCounts, totalClicks, type ClickCounts } from './counters'
import { isView, MAX_TODO_LENGTH, type View } from './types'
import { isLayoutColumns, MAX_SITE_NAME_LENGTH, type SystemSettings } from './settings'
import { parseBookmarkUrl, parseIconUrl } from './url'

export interface BackupMetadata {
  syncId?: string
  createdAt?: number
  updatedAt?: number
  clicks?: number
  clickCounts?: ClickCounts
  lastClickedAt?: number | null
}

export interface BackupSite extends BackupMetadata {
  origin: string
  title: string
  /** Stored icon, base64 encoded */
  icon?: { type: string; data: string }
  iconUrl?: string
  links: ({ path: string; title: string } & BackupMetadata)[]
}

export interface BackupGroup extends BackupMetadata {
  name: string
  /** Absent in files written before groups could be pinned */
  pinned?: boolean
  sites: BackupSite[]
}

export interface BackupDesktop extends BackupMetadata {
  name: string
  view: View
  groups: BackupGroup[]
}

/** Legacy bookmark-only format. Version 1 had a single list of groups and no desktops. */
export interface Backup {
  version: 2
  exportedAt: string
  desktops: BackupDesktop[]
}

export interface FullBackupLocal {
  preferences?: Record<string, string>
  settings: SystemSettings
  since: number
  todos: ({ text: string; doneAt: number | null } & BackupMetadata)[]
}

export interface ParsedBackup {
  local?: FullBackupLocal
  desktops: BackupDesktop[]
  exportedAt: string | null
}

type Json = Record<string, unknown>

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function isObject(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function metadata(input: Json): BackupMetadata {
  const result: BackupMetadata = {}
  if (input.syncId !== undefined) {
    if (typeof input.syncId !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(input.syncId)) throw new Error('备份中的记录标识无效')
    result.syncId = input.syncId
  }
  for (const key of ['createdAt', 'updatedAt', 'clicks', 'lastClickedAt'] as const) {
    const value = input[key]
    if (value === undefined) continue
    if (key === 'lastClickedAt' && value === null) { result[key] = null; continue }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('备份中的统计或时间格式无效')
    result[key] = value
  }
  if (input.clickCounts !== undefined) {
    const counts = parseClickCounts(input.clickCounts)
    if (!counts || (result.clicks !== undefined && totalClicks(counts) !== result.clicks)) throw new Error('备份中的点击计数无效')
    result.clickCounts = counts
    result.clicks = totalClicks(counts)
  }
  return result
}

function parseGroups(input: unknown, full = false): BackupGroup[] | string {
  if (!Array.isArray(input)) return '备份文件中的分组格式有误'
  const groups: BackupGroup[] = []
  // A card is unique per desktop, so duplicates are dropped across all groups of one desktop
  const seenOrigins = new Set<string>()

  for (const group of input) {
    const name = isObject(group) ? text(group.name, 40) : null
    if (!isObject(group) || !name || !Array.isArray(group.sites)) return '备份文件中的分组格式有误'
    const sites: BackupSite[] = []

    for (const site of group.sites) {
      const parsed = isObject(site) && typeof site.origin === 'string' ? parseBookmarkUrl(site.origin) : null
      const title = isObject(site) ? text(site.title, 80) : null
      if (!isObject(site) || !parsed || !title || !Array.isArray(site.links)) return '备份文件中的卡片格式有误'
      if (seenOrigins.has(parsed.origin)) continue
      seenOrigins.add(parsed.origin)

      const links: BackupSite['links'] = []
      const seenPaths = new Set<string>()
      for (const link of site.links) {
        const path = isObject(link) && typeof link.path === 'string' && link.path.startsWith('/') ? link.path : null
        const linkTitle = isObject(link) ? text(link.title, 80) : null
        if (!path || !linkTitle) return '备份文件中的链接格式有误'
        if (seenPaths.has(path)) continue
        seenPaths.add(path)
        links.push({ path, title: linkTitle, ...(full ? metadata(link as Json) : {}) })
      }

      // A broken icon shouldn't make the whole backup unusable, so bad ones are just left out
      const result: BackupSite = { origin: parsed.origin, title, links, ...(full ? metadata(site) : {}) }
      const icon = site.icon
      if (isObject(icon) && typeof icon.type === 'string' && icon.type.startsWith('image/') && typeof icon.data === 'string' && icon.data) {
        result.icon = { type: icon.type, data: icon.data }
      }
      const iconUrl = typeof site.iconUrl === 'string' ? parseIconUrl(site.iconUrl) : null
      if (iconUrl) result.iconUrl = iconUrl
      sites.push(result)
    }
    groups.push({ name, ...(full ? metadata(group) : {}), ...(group.pinned === true ? { pinned: true } : {}), sites })
  }
  return groups
}

/**
 * Validates and normalizes the contents of a backup file.
 * `legacyName` names the single desktop that a version 1 backup turns into.
 */
function parseBackupContents(input: unknown, legacyName: string): ParsedBackup | { error: string } {
  if (!isObject(input)) return { error: '不是有效的备份文件' }

  if (input.version === 1) {
    const groups = parseGroups(input.groups)
    if (typeof groups === 'string') return { error: groups }
    return { desktops: [{ name: legacyName, view: 'large', groups }], exportedAt: null }
  }

  if ((input.version !== 2 && input.version !== 3) || !Array.isArray(input.desktops)) return { error: '不是有效的备份文件' }
  if (input.desktops.length === 0) return { error: '备份文件中没有桌面' }
  const desktops: BackupDesktop[] = []
  for (const desktop of input.desktops) {
    const name = isObject(desktop) ? text(desktop.name, 20) : null
    if (!isObject(desktop) || !name) return { error: '备份文件中的桌面格式有误' }
    const groups = parseGroups(desktop.groups, input.version === 3)
    if (typeof groups === 'string') return { error: groups }
    desktops.push({ name, ...(input.version === 3 ? metadata(desktop) : {}), view: isView(desktop.view) ? desktop.view : 'large', groups })
  }
  let local: FullBackupLocal | undefined
  if (input.version === 3) {
    const data = input.local
    if (!isObject(data) || !isObject(data.settings) || !Array.isArray(data.todos)) return { error: '完整备份中的设置或待办格式有误' }
    const settings = data.settings
    if (typeof settings.siteName !== 'string' || !settings.siteName.trim() || settings.siteName.length > MAX_SITE_NAME_LENGTH || typeof settings.openInNewTab !== 'boolean' || !isLayoutColumns(settings.layoutColumns)) return { error: '完整备份中的设置格式有误' }
    if (typeof data.since !== 'number' || !Number.isSafeInteger(data.since) || data.since < 0) return { error: '完整备份中的统计开始时间有误' }
    const todos: FullBackupLocal['todos'] = []
    for (const todo of data.todos) {
      if (!isObject(todo) || typeof todo.text !== 'string' || !todo.text.trim() || todo.text.length > MAX_TODO_LENGTH || (todo.doneAt !== null && (typeof todo.doneAt !== 'number' || !Number.isSafeInteger(todo.doneAt) || todo.doneAt < 0))) return { error: '完整备份中的待办格式有误' }
      todos.push({ text: todo.text.trim(), doneAt: todo.doneAt as number | null, ...metadata(todo) })
    }
    const preferences: Record<string, string> = {}
    if (isObject(data.preferences)) for (const key of ['theme', 'style', 'search_engine', 'todo-panel']) { const value = data.preferences[key]; if (typeof value === 'string' && value.length <= 100) preferences[key] = value }
    local = { preferences, settings: { siteName: settings.siteName.trim(), openInNewTab: settings.openInNewTab, layoutColumns: settings.layoutColumns }, since: data.since, todos }
    const seen = new Set<string>()
    const records: BackupMetadata[] = [...todos]
    for (const d of desktops) { records.push(d); for (const g of d.groups) { records.push(g); for (const s of g.sites) records.push(s, ...s.links) } }
    for (const record of records) if (record.syncId) { if (seen.has(record.syncId)) return { error: '备份中的记录标识重复' }; seen.add(record.syncId) }
  }
  return { desktops, exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : null, ...(local ? { local } : {}) }
}

export function backupStats(desktops: BackupDesktop[]): { desktops: number; sites: number; links: number } {
  const sites = desktops.flatMap((desktop) => desktop.groups.flatMap((group) => group.sites))
  return { desktops: desktops.length, sites: sites.length, links: sites.reduce((count, site) => count + site.links.length, 0) }
}

export function parseBackup(input: unknown, legacyName = '导入的桌面'): ParsedBackup | { error: string } {
  try { return parseBackupContents(input, legacyName) } catch (error) { return { error: error instanceof Error ? error.message : '无效的备份文件' } }
}
