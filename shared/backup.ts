import { isView, type View } from './types'
import { parseBookmarkUrl, parseIconUrl } from './url'

export interface BackupSite {
  origin: string
  title: string
  /** Stored icon, base64 encoded */
  icon?: { type: string; data: string }
  iconUrl?: string
  links: { path: string; title: string }[]
}

export interface BackupGroup {
  name: string
  sites: BackupSite[]
}

export interface BackupDesktop {
  name: string
  view: View
  groups: BackupGroup[]
}

/** File produced by /api/export. Version 1 files had a single list of groups and no desktops */
export interface Backup {
  version: 2
  exportedAt: string
  desktops: BackupDesktop[]
}

export interface ParsedBackup {
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

function parseGroups(input: unknown): BackupGroup[] | string {
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
        links.push({ path, title: linkTitle })
      }

      // A broken icon shouldn't make the whole backup unusable, so bad ones are just left out
      const result: BackupSite = { origin: parsed.origin, title, links }
      const icon = site.icon
      if (isObject(icon) && typeof icon.type === 'string' && icon.type.startsWith('image/') && typeof icon.data === 'string' && icon.data) {
        result.icon = { type: icon.type, data: icon.data }
      }
      const iconUrl = typeof site.iconUrl === 'string' ? parseIconUrl(site.iconUrl) : null
      if (iconUrl) result.iconUrl = iconUrl
      sites.push(result)
    }
    groups.push({ name, sites })
  }
  return groups
}

/**
 * Validates and normalizes the contents of a backup file.
 * `legacyName` names the single desktop that a version 1 backup turns into.
 */
export function parseBackup(input: unknown, legacyName = '导入的桌面'): ParsedBackup | { error: string } {
  if (!isObject(input)) return { error: '不是有效的备份文件' }

  if (input.version === 1) {
    const groups = parseGroups(input.groups)
    if (typeof groups === 'string') return { error: groups }
    return { desktops: [{ name: legacyName, view: 'large', groups }], exportedAt: null }
  }

  if (input.version !== 2 || !Array.isArray(input.desktops)) return { error: '不是有效的备份文件' }
  if (input.desktops.length === 0) return { error: '备份文件中没有桌面' }
  const desktops: BackupDesktop[] = []
  for (const desktop of input.desktops) {
    const name = isObject(desktop) ? text(desktop.name, 20) : null
    if (!isObject(desktop) || !name) return { error: '备份文件中的桌面格式有误' }
    const groups = parseGroups(desktop.groups)
    if (typeof groups === 'string') return { error: groups }
    desktops.push({ name, view: isView(desktop.view) ? desktop.view : 'large', groups })
  }
  return { desktops, exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : null }
}

export function backupStats(desktops: BackupDesktop[]): { desktops: number; sites: number; links: number } {
  const sites = desktops.flatMap((desktop) => desktop.groups.flatMap((group) => group.sites))
  return { desktops: desktops.length, sites: sites.length, links: sites.reduce((count, site) => count + site.links.length, 0) }
}
