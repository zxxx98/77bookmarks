import type { BackupDesktop, BackupGroup, BackupSite } from '../shared/backup'
import { hostOf, parseBookmarkUrl } from '../shared/url'

export interface ChromeImport {
  desktop: BackupDesktop
  /** Origins that appeared as a root bookmark (path === null) in the HTML file */
  rootOrigins?: string[]
  read: number
  skipped: number
}

export interface SiteSelection {
  /** Whether the site's root bookmark (or card without sub-links) is selected */
  root: boolean
  /** Selection flags aligned with `site.links` */
  links: boolean[]
}

/** Selection state indexed by [groupIndex][siteIndex] */
export type ChromeImportSelection = SiteSelection[][]

export type CheckState = 'checked' | 'indeterminate' | 'unchecked'

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
  const rootOrigins = new Set<string>()
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
      } else {
        rootOrigins.add(parsed.origin)
        if (site.title === hostOf(parsed.origin).slice(0, 80)) {
          site.title = bookmarkTitle
        }
      }
    }
    if ((index + 1) % 250 === 0 || index + 1 === anchors.length) {
      onProgress?.(index + 1, anchors.length)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
  if (!sites.size) throw new Error('文件中没有可导入的网页书签')
  return { desktop: { name: 'Chrome 书签', view: 'large', groups }, rootOrigins: [...rootOrigins], read: anchors.length, skipped }
}

export function rootOriginSet(data: ChromeImport): Set<string> {
  return new Set(data.rootOrigins ?? [])
}

export function hasSiteRoot(site: BackupSite, rootSet: ReadonlySet<string>): boolean {
  return site.links.length === 0 || rootSet.has(site.origin)
}

export interface VisibleSite {
  site: BackupSite
  siteIndex: number
  linkIndices: number[]
}

export interface VisibleGroup {
  group: BackupGroup
  groupIndex: number
  sites: VisibleSite[]
}

/** Filters parsed groups/sites/links for display in the import preview panel while preserving original indices. */
export function filterChromePreview(groups: BackupGroup[], query: string): VisibleGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return groups.map((group, groupIndex) => ({
      group,
      groupIndex,
      sites: group.sites.map((site, siteIndex) => ({
        site,
        siteIndex,
        linkIndices: site.links.map((_, linkIndex) => linkIndex),
      })),
    }))
  }

  const visible: VisibleGroup[] = []
  groups.forEach((group, groupIndex) => {
    if (group.name.toLowerCase().includes(q)) {
      visible.push({
        group,
        groupIndex,
        sites: group.sites.map((site, siteIndex) => ({
          site,
          siteIndex,
          linkIndices: site.links.map((_, linkIndex) => linkIndex),
        })),
      })
      return
    }
    const sites: VisibleSite[] = []
    group.sites.forEach((site, siteIndex) => {
      const siteMatch = site.title.toLowerCase().includes(q) || site.origin.toLowerCase().includes(q)
      if (siteMatch) {
        sites.push({ site, siteIndex, linkIndices: site.links.map((_, linkIndex) => linkIndex) })
        return
      }
      const linkIndices: number[] = []
      site.links.forEach((link, linkIndex) => {
        if (link.title.toLowerCase().includes(q) || link.path.toLowerCase().includes(q)) linkIndices.push(linkIndex)
      })
      if (linkIndices.length > 0) sites.push({ site, siteIndex, linkIndices })
    })
    if (sites.length > 0) visible.push({ group, groupIndex, sites })
  })
  return visible
}

function combineCheckStates(states: CheckState[]): CheckState {
  if (!states.length) return 'unchecked'
  if (states.every((s) => s === 'checked')) return 'checked'
  if (states.every((s) => s === 'unchecked')) return 'unchecked'
  return 'indeterminate'
}

export function createChromeSelection(data: ChromeImport): ChromeImportSelection {
  const rootSet = rootOriginSet(data)
  return data.desktop.groups.map((group) =>
    group.sites.map((site) => ({
      root: hasSiteRoot(site, rootSet),
      links: site.links.map(() => true),
    })),
  )
}

export function isSiteSelected(siteSel: SiteSelection): boolean {
  return siteSel.root || siteSel.links.some(Boolean)
}

export function siteCheckState(site: BackupSite, siteSel: SiteSelection, rootSet: ReadonlySet<string>): CheckState {
  if (site.links.length === 0) return siteSel.root ? 'checked' : 'unchecked'
  const hasRoot = hasSiteRoot(site, rootSet)
  const allLinks = siteSel.links.every(Boolean)
  const anyLinks = siteSel.links.some(Boolean)
  if ((!hasRoot || siteSel.root) && allLinks) return 'checked'
  if ((!hasRoot || !siteSel.root) && !anyLinks) return 'unchecked'
  return 'indeterminate'
}

export function toggleSiteSelection(site: BackupSite, siteSel: SiteSelection, rootSet: ReadonlySet<string>): SiteSelection {
  const hasRoot = hasSiteRoot(site, rootSet)
  const state = siteCheckState(site, siteSel, rootSet)
  const uncheck = state === 'checked' || (state === 'indeterminate' && !siteSel.links.some(Boolean))
  if (uncheck) return { root: false, links: site.links.map(() => false) }
  return { root: hasRoot, links: site.links.map(() => true) }
}

export function toggleLinkSelection(siteSel: SiteSelection, linkIndex: number): SiteSelection {
  return { ...siteSel, links: siteSel.links.map((checked, index) => (index === linkIndex ? !checked : checked)) }
}

export function groupCheckState(group: BackupGroup, groupSel: SiteSelection[], rootSet: ReadonlySet<string>): CheckState {
  return combineCheckStates(group.sites.map((site, siteIndex) => siteCheckState(site, groupSel[siteIndex], rootSet)))
}

export function toggleGroupSelection(group: BackupGroup, groupSel: SiteSelection[], rootSet: ReadonlySet<string>): SiteSelection[] {
  const target = groupCheckState(group, groupSel, rootSet) !== 'checked'
  return group.sites.map((site) => ({
    root: target ? hasSiteRoot(site, rootSet) : false,
    links: site.links.map(() => target),
  }))
}

export function allCheckState(data: ChromeImport, selection: ChromeImportSelection, rootSet: ReadonlySet<string>): CheckState {
  return combineCheckStates(data.desktop.groups.map((group, groupIndex) => groupCheckState(group, selection[groupIndex] ?? [], rootSet)))
}

export function toggleAllSelection(data: ChromeImport, selection: ChromeImportSelection, rootSet: ReadonlySet<string>): ChromeImportSelection {
  const target = allCheckState(data, selection, rootSet) !== 'checked'
  return data.desktop.groups.map((group) =>
    group.sites.map((site) => ({
      root: target ? hasSiteRoot(site, rootSet) : false,
      links: site.links.map(() => target),
    })),
  )
}

export function countGroupSelected(group: BackupGroup, groupSel: SiteSelection[]): { sites: number; links: number } {
  let sites = 0
  let links = 0
  group.sites.forEach((_, siteIndex) => {
    const siteSel = groupSel[siteIndex]
    if (!siteSel || !isSiteSelected(siteSel)) return
    sites++
    links += siteSel.links.filter(Boolean).length
  })
  return { sites, links }
}

export function filterChromeDesktop(data: ChromeImport, selection: ChromeImportSelection): BackupDesktop {
  const groups: BackupGroup[] = []
  data.desktop.groups.forEach((group, groupIndex) => {
    const groupSel = selection[groupIndex]
    if (!groupSel) return
    const sites: BackupSite[] = []
    group.sites.forEach((site, siteIndex) => {
      const siteSel = groupSel[siteIndex]
      if (!siteSel || !isSiteSelected(siteSel)) return
      sites.push({
        ...site,
        links: site.links.filter((_, linkIndex) => siteSel.links[linkIndex]),
      })
    })
    if (sites.length > 0) groups.push({ ...group, sites })
  })
  return { ...data.desktop, groups }
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
