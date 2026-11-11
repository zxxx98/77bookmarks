import type { BackupDesktop, BackupGroup, BackupSite } from '../shared/backup'
import { hostOf, parseBookmarkUrl } from '../shared/url'

export interface ChromeImport {
  desktop: BackupDesktop
  read: number
  skipped: number
}

export interface ChromeImportRow {
  groupId: number
  origin: string
  title: string
  sitePosition: number
  path: string | null
  linkTitle?: string
  linkPosition?: number
}

function folderPath(anchor: Element): string[] {
  const names: string[] = []
  for (let list = anchor.closest('dl'); list; list = list.parentElement?.closest('dl') ?? null) {
    const folder = list.parentElement
    const heading = folder?.tagName === 'DT' ? [...folder.children].find((child) => child.tagName === 'H3') : null
    const name = heading?.textContent?.trim()
    if (name) names.push(name)
  }
  return names.reverse()
}

function groupName(path: string[], taken: Set<string>): string {
  const full = path.join(' / ') || '未分类'
  let name = full.slice(0, 40)
  for (let suffix = 2; taken.has(name); suffix++) {
    const ending = ` (${suffix})`
    name = full.slice(0, 40 - ending.length) + ending
  }
  taken.add(name)
  return name
}

/** Chrome's Netscape HTML export is parsed locally; no file contents are uploaded as HTML. */
export async function parseChromeBookmarks(html: string, onProgress?: (done: number, total: number) => void): Promise<ChromeImport> {
  if (!/<!doctype\s+NETSCAPE-Bookmark-file-1\s*>/i.test(html)) throw new Error('请选择 Chrome 导出的书签 HTML 文件')
  const document = new DOMParser().parseFromString(html, 'text/html')
  const anchors = [...document.querySelectorAll('dl a[href]')]
  if (!anchors.length) throw new Error('文件中没有找到书签')

  const groups: BackupGroup[] = []
  const byPath = new Map<string, BackupGroup>()
  const takenNames = new Set<string>()
  const sites = new Map<string, BackupSite>()
  const seenLinks = new Map<string, Set<string>>()
  let skipped = 0

  for (let index = 0; index < anchors.length; index++) {
    const anchor = anchors[index]
    const href = anchor.getAttribute('href')?.trim() ?? ''
    const parsed = /^https?:\/\//i.test(href) ? parseBookmarkUrl(href) : null
    if (!parsed) {
      skipped++
    } else {
      let site = sites.get(parsed.origin)
      const bookmarkTitle = (anchor.textContent?.trim() || hostOf(parsed.origin)).slice(0, 80)
      if (!site) {
        const path = folderPath(anchor)
        const key = JSON.stringify(path)
        let group = byPath.get(key)
        if (!group) {
          group = { name: groupName(path, takenNames), sites: [] }
          byPath.set(key, group)
          groups.push(group)
        }
        site = { origin: parsed.origin, title: parsed.path ? hostOf(parsed.origin).slice(0, 80) : bookmarkTitle, links: [] }
        sites.set(parsed.origin, site)
        seenLinks.set(parsed.origin, new Set())
        group.sites.push(site)
      }
      if (parsed.path) {
        const seen = seenLinks.get(parsed.origin)!
        if (!seen.has(parsed.path)) {
          site.links.push({ path: parsed.path, title: bookmarkTitle })
          seen.add(parsed.path)
        }
      } else if (site.title === hostOf(parsed.origin).slice(0, 80)) {
        site.title = bookmarkTitle
      }
    }
    if ((index + 1) % 250 === 0 || index + 1 === anchors.length) {
      onProgress?.(index + 1, anchors.length)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
  if (!sites.size) throw new Error('文件中没有可导入的网页书签')
  return { desktop: { name: 'Chrome 书签', view: 'large', groups }, read: anchors.length, skipped }
}

export function chromeRows(desktop: BackupDesktop, groupIds: number[]): ChromeImportRow[] {
  return desktop.groups.flatMap((group, groupIndex) => group.sites.flatMap((site, sitePosition) => [
    { groupId: groupIds[groupIndex], origin: site.origin, title: site.title, sitePosition, path: null },
    ...site.links.map((link, linkPosition) => ({
      groupId: groupIds[groupIndex], origin: site.origin, title: site.title, sitePosition,
      path: link.path, linkTitle: link.title, linkPosition,
    })),
  ]))
}
