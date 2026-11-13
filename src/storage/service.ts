import { clickCountsOf, totalClicks, type ClickCounts } from '../../shared/counters'
import { backupStats, parseBackup, type BackupDesktop, type BackupSite } from '../../shared/backup'
import { DEFAULT_SETTINGS, isLayoutColumns, MAX_SITE_NAME_LENGTH, type SystemSettings } from '../../shared/settings'
import { DEFAULT_DESKTOP_SYNC_ID, DEFAULT_GROUP_SYNC_ID, mergeSnapshots, snapshotFingerprint, type MergeStats, type SyncSnapshot } from '../../shared/sync'
import { MAX_SITE_DESCRIPTION_LENGTH, MAX_TODO_LENGTH, isView, type AddResult, type BoardPage, type ClickTarget, type Desktop, type ImportMode, type ImportResult, type OrderInput, type UsageStats, type View } from '../../shared/types'
import { fallbackLinkTitle, hostOf, parseBookmarkUrl, parseIconUrl, parseIntranetUrl } from '../../shared/url'
import { MAX_CHUNKS, parseChunks, restoreVault, type Vault } from '../../shared/vault'
import { EMPTY_SYNC_CONFIG, EMPTY_SYNC_STATE, isSyncKind, type SyncConfig, type SyncState, type SyncStatus } from '../sync/types'
import { changed, entity, openLocalDatabase, sorted, STORES, SYNC_STORE, VAULT_STORE, type DesktopRow, type Entity, type GroupRow, type LinkRow, type LocalDatabase, type SettingsRow, type SiteRow, type SyncTransaction, type TodoRow, type WriteTransaction } from './db'
import { applySnapshot, buildSnapshot, snapshotOf } from './sync-snapshot'
import { deriveSyncId } from './uuid'

const MAX_DESKTOPS = 20
const MAX_ICON_BYTES = 100 * 1024
const ok = { ok: true as const }
const nameOf = (value: string, max: number) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('名称或内容不能为空')
  return value.trim().slice(0, max)
}
const requireRow = <T>(row: T | undefined, what: string): T => {
  if (!row) throw new Error(`${what}不存在，请刷新后重试`)
  return row
}
const idsValid = (ids: number[]) => Array.isArray(ids) && ids.every((id) => Number.isInteger(id) && id > 0) && new Set(ids).size === ids.length
const stats = () => ({ clicks: 0, lastClickedAt: null })

export function validateIcon(dataUrl: string): string {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]*={0,2})$/i.exec(dataUrl)
  if (!match) throw new Error('无效的图片文件')
  let size: number
  try { size = atob(match[2]).length } catch { throw new Error('无效的图片文件') }
  if (!size || size > MAX_ICON_BYTES) throw new Error('图片不能为空或超过 100 KB')
  return dataUrl
}

/** Chrome's own favicon cache needs no access to arbitrary websites. */
async function cachedFavicon(origin: string): Promise<string | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return null
  const favicon = new URL(chrome.runtime.getURL('/_favicon/'))
  favicon.searchParams.set('pageUrl', origin)
  favicon.searchParams.set('size', '64')
  const response = await fetch(favicon)
  if (!response.ok) return null
  const bytes = new Uint8Array(await response.arrayBuffer())
  return bytes.length && bytes.length <= MAX_ICON_BYTES ? `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}` : null
}

export interface ServiceOptions {
  /** Finds a site's own icon as a data URL; where it looks is up to the edition running the service */
  fetchIcon: (origin: string) => Promise<string | null>
}

/** All writes are atomic database transactions, with no network work inside a transaction. */
export class LocalService {
  private database: Promise<LocalDatabase> | undefined
  constructor(private open: () => Promise<LocalDatabase> = openLocalDatabase, private options: ServiceOptions = { fetchIcon: cachedFavicon }) {}
  private db() { return this.database ??= this.open().catch((error) => { this.database = undefined; throw error }) }
  private async write<T>(run: (tx: WriteTransaction) => Promise<T>): Promise<T> {
    const db = await this.db()
    const tx = db.transaction([...STORES], 'readwrite')
    const settled = tx.done.catch(() => undefined)
    try {
      const result = await run(tx)
      await this.sortSitesByUsage(tx)
      await tx.done
      return result
    } catch (error) {
      try { tx.abort() } catch { /* Already aborted. */ }
      await settled
      throw error
    }
  }
  /** Same as write(), plus the store holding the sync ancestor and the cloud settings */
  private async writeSync<T>(run: (tx: SyncTransaction) => Promise<T>): Promise<T> {
    const db = await this.db()
    const tx = db.transaction([...STORES, SYNC_STORE, VAULT_STORE] as [...typeof STORES, typeof SYNC_STORE, typeof VAULT_STORE], 'readwrite')
    const settled = tx.done.catch(() => undefined)
    try {
      const result = await run(tx)
      await tx.done
      return result
    } catch (error) {
      try { tx.abort() } catch { /* Already aborted. */ }
      await settled
      throw error
    }
  }
  /** Updates the existing positions, so turning this off simply keeps the latest order. */
  private async sortSitesByUsage(tx: Pick<WriteTransaction, 'objectStore'>) {
    const settings = (await tx.objectStore('settings').get('system'))?.value as SystemSettings | undefined
    if (!settings?.autoSortByUsage) return
    const [sites, links] = await Promise.all([tx.objectStore('sites').getAll(), tx.objectStore('links').getAll()])
    const clicks = new Map(sites.map((s) => [s.id, s.clicks]))
    for (const link of links) clicks.set(link.siteId, (clicks.get(link.siteId) ?? 0) + link.clicks)
    const groups = new Map<number, SiteRow[]>()
    for (const site of sorted(sites)) {
      const group = groups.get(site.groupId) ?? []
      group.push(site)
      groups.set(site.groupId, group)
    }
    for (const group of groups.values()) {
      const ordered = [...group].sort((a, b) => clicks.get(b.id)! - clicks.get(a.id)!)
      if (ordered.every((s, index) => s.id === group[index].id)) continue
      for (const [position, site] of ordered.entries()) {
        if (site.position !== position) await tx.objectStore('sites').put(changed(site, { position }))
      }
    }
  }
  private async syncRecords() {
    const tx = (await this.db()).transaction(SYNC_STORE, 'readonly')
    const [device, config, state, base] = await Promise.all([
      tx.objectStore('sync').get('device'), tx.objectStore('sync').get('config'),
      tx.objectStore('sync').get('state'), tx.objectStore('sync').get('base'),
    ])
    await tx.done
    return {
      deviceId: (device as { deviceId?: string } | undefined)?.deviceId ?? '',
      config: (config as { config?: SyncConfig } | undefined)?.config ?? EMPTY_SYNC_CONFIG,
      state: (state as { state?: SyncState } | undefined)?.state ?? EMPTY_SYNC_STATE,
      base: (base as { snapshot?: SyncSnapshot | null } | undefined)?.snapshot ?? null,
    }
  }
  /** The desktop a new bookmark lands in, resolved before the write starts */
  private async targetDesktop(id: number): Promise<DesktopRow> {
    const desktops = sorted(await (await this.db()).getAll('desktops'))
    return requireRow(desktops.find((row) => row.id === id) ?? desktops[0], '桌面')
  }
  private async rows() {
    const db = await this.db()
    const tx = db.transaction(['desktops', 'groups', 'sites', 'links', 'todos', 'settings'], 'readonly')
    const [desktops, groups, sites, links, todos, settings] = await Promise.all([
      tx.objectStore('desktops').getAll(), tx.objectStore('groups').getAll(), tx.objectStore('sites').getAll(),
      tx.objectStore('links').getAll(), tx.objectStore('todos').getAll(), tx.objectStore('settings').getAll(),
    ])
    await tx.done
    return { desktops: sorted(desktops), groups: sorted(groups).sort((a, b) => Number(b.pinned) - Number(a.pinned)), sites: sorted(sites), links: sorted(links), todos: sorted(todos), settings }
  }
  async board(desktopId = 0): Promise<BoardPage> {
    const db = await this.db()
    const tx = db.transaction(['desktops', 'groups', 'sites', 'links'], 'readonly')
    const desktops = sorted(await tx.objectStore('desktops').getAll())
    const selected = requireRow(desktops.find((d) => d.id === desktopId) ?? desktops[0], '桌面')
    const [groups, sites, summaries] = await Promise.all([
      tx.objectStore('groups').index('desktopId').getAll(selected.id),
      tx.objectStore('sites').index('desktopId').getAll(selected.id),
      Promise.all(desktops.map(async (d) => ({
        id: d.id, name: d.name, view: d.view,
        groupCount: await tx.objectStore('groups').index('desktopId').count(d.id),
        siteCount: await tx.objectStore('sites').index('desktopId').count(d.id),
      }))),
    ])
    const links = new Map(await Promise.all(sites.map(async (s) => [s.id, sorted(await tx.objectStore('links').index('siteId').getAll(s.id))] as const)))
    await tx.done
    const desktop: Desktop = { id: selected.id, name: selected.name, view: selected.view, groups: sorted(groups).sort((a, b) => Number(b.pinned) - Number(a.pinned)).map((g) => ({
      id: g.id, name: g.name, pinned: g.pinned, sites: sorted(sites.filter((s) => s.groupId === g.id)).map((s) => ({
        id: s.id, origin: s.origin, title: s.title,
        ...(s.description ? { description: s.description } : {}),
        ...(s.intranetUrl ? { intranetUrl: s.intranetUrl } : {}),
        iconVersion: s.iconVersion, iconUrl: s.iconUrl,
        links: (links.get(s.id) ?? []).map((l) => ({ id: l.id, path: l.path, title: l.title })),
      })),
    })) }
    return { desktop, desktops: summaries }
  }
  async search(query: string) {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const rows = await this.rows()
    const hit = (s: string) => s.toLowerCase().includes(q)
    const links = new Set(rows.links.filter((l) => hit(l.path) || hit(l.title)).map((l) => l.siteId))
    const counts = new Map<number, number>()
    for (const s of rows.sites) if (hit(s.title) || hit(hostOf(s.origin)) || (s.description && hit(s.description)) || (s.intranetUrl && hit(s.intranetUrl)) || links.has(s.id)) counts.set(s.desktopId, (counts.get(s.desktopId) ?? 0) + 1)
    return [...counts].map(([desktopId, count]) => ({ desktopId, count }))
  }
  async settings(): Promise<SystemSettings> {
    const stored = (await (await this.db()).get('settings', 'system'))?.value as SystemSettings | undefined
    return { ...DEFAULT_SETTINGS, ...stored, defaultIntranet: stored?.defaultIntranet !== false }
  }
  async updateSettings(settings: Omit<SystemSettings, 'autoSortByUsage' | 'defaultIntranet'> & { autoSortByUsage?: boolean; defaultIntranet?: boolean }) {
    const siteName = nameOf(settings.siteName, MAX_SITE_NAME_LENGTH)
    if (
      typeof settings.openInNewTab !== 'boolean' ||
      !isLayoutColumns(settings.layoutColumns) ||
      (settings.autoSortByUsage !== undefined && typeof settings.autoSortByUsage !== 'boolean') ||
      (settings.defaultIntranet !== undefined && typeof settings.defaultIntranet !== 'boolean')
    ) throw new Error('无效的设置')
    const value: SystemSettings = {
      siteName,
      openInNewTab: settings.openInNewTab,
      layoutColumns: settings.layoutColumns,
      autoSortByUsage: settings.autoSortByUsage ?? false,
      defaultIntranet: settings.defaultIntranet ?? true,
    }
    await this.write(async (tx) => {
      // Settings carry their own modification time so that the newer side wins when syncing
      const previous = await tx.objectStore('settings').get('system')
      await tx.objectStore('settings').put({ key: 'system', value, updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1) })
    })
    return value
  }
  private async firstGroup(tx: WriteTransaction, desktopId: number) {
    requireRow(await tx.objectStore('desktops').get(desktopId), '桌面')
    const groups = sorted(await tx.objectStore('groups').index('desktopId').getAll(desktopId))
    if (groups[0]) return groups[0].id
    return tx.objectStore('groups').add({ ...entity(), desktopId, name: '默认', pinned: false } as GroupRow)
  }
  async createDesktop(name: string) {
    return this.write(async (tx) => {
      const store = tx.objectStore('desktops')
      if (await store.count() >= MAX_DESKTOPS) throw new Error(`最多只能有 ${MAX_DESKTOPS} 个桌面`)
      const value = nameOf(name, 20)
      const id = await store.add({ ...entity(await this.next(tx, 'desktops')), name: value, view: 'large' } as DesktopRow)
      return { id, name: value }
    })
  }
  async updateDesktop(id: number, patch: { name?: string; view?: View }) {
    return this.write(async (tx) => {
      const row = requireRow(await tx.objectStore('desktops').get(id), '桌面')
      if (patch.name !== undefined) row.name = nameOf(patch.name, 20)
      if (patch.view !== undefined) { if (!isView(patch.view)) throw new Error('无效的显示方式'); row.view = patch.view }
      await tx.objectStore('desktops').put(changed(row, {}))
      return ok
    })
  }
  private async deleteSiteRows(tx: WriteTransaction, id: number) {
    for (const link of await tx.objectStore('links').index('siteId').getAll(id)) await tx.objectStore('links').delete(link.id)
    await tx.objectStore('icons').delete(id)
    await tx.objectStore('sites').delete(id)
  }
  async deleteDesktop(id: number) {
    return this.write(async (tx) => {
      if (!(await tx.objectStore('desktops').get(id))) return ok
      if (await tx.objectStore('desktops').count() <= 1) throw new Error('至少要保留一个桌面')
      for (const site of await tx.objectStore('sites').index('desktopId').getAll(id)) await this.deleteSiteRows(tx, site.id)
      for (const group of await tx.objectStore('groups').index('desktopId').getAll(id)) await tx.objectStore('groups').delete(group.id)
      await tx.objectStore('desktops').delete(id)
      return ok
    })
  }
  async createGroup(desktopId: number, name: string) {
    return this.write(async (tx) => {
      requireRow(await tx.objectStore('desktops').get(desktopId), '桌面')
      await tx.objectStore('groups').add({ ...entity(await this.next(tx, 'groups')), desktopId, name: nameOf(name, 40), pinned: false } as GroupRow)
      return ok
    })
  }
  private async patchGroup(id: number, patch: Partial<GroupRow>) {
    return this.write(async (tx) => {
      const group = requireRow(await tx.objectStore('groups').get(id), '分组')
      await tx.objectStore('groups').put(changed(group, patch))
      return ok
    })
  }
  async renameGroup(id: number, name: string) { return this.patchGroup(id, { name: nameOf(name, 40) }) }
  async pinGroup(id: number, pinned: boolean) {
    if (typeof pinned !== 'boolean') throw new Error('无效的置顶状态')
    return this.patchGroup(id, { pinned })
  }
  async deleteGroup(id: number) {
    return this.write(async (tx) => {
      for (const site of await tx.objectStore('sites').index('groupId').getAll(id)) await this.deleteSiteRows(tx, site.id)
      await tx.objectStore('groups').delete(id)
      return ok
    })
  }
  private async next(tx: WriteTransaction, store: 'desktops' | 'groups' | 'sites' | 'links') {
    const rows = await tx.objectStore(store).getAll()
    return rows.reduce((max, row) => Math.max(max, row.position + 1), 0)
  }
  async addBookmark(
    url: string,
    desktopId = 0,
    groupId?: number,
    title?: string,
    iconDataUrl?: string,
    extra?: { siteTitle?: string; description?: string; intranetUrl?: string },
  ): Promise<AddResult> {
    const parsed = parseBookmarkUrl(url)
    if (!parsed) throw new Error('无效的网址')
    const icon = iconDataUrl ? validateIcon(iconDataUrl) : null
    const description = extra?.description?.trim() ? extra.description.trim().slice(0, MAX_SITE_DESCRIPTION_LENGTH) : undefined
    const rawIntranet = extra?.intranetUrl?.trim() ?? ''
    const intranetUrl = rawIntranet ? parseIntranetUrl(rawIntranet) : undefined
    if (rawIntranet && !intranetUrl) throw new Error('无效的内网地址')
    // Card and link identities come from their natural keys (desktop + origin, card + path),
    // so the same bookmark added on another device while offline becomes the same record
    // instead of a second one. Both are computed before the transaction: WebCrypto cannot
    // be awaited inside an IndexedDB transaction.
    const desktop = await this.targetDesktop(desktopId)
    const known = await (await this.db()).getFromIndex('sites', 'origin', [desktop.id, parsed.origin])
    const siteSyncId = known?.syncId ?? await deriveSyncId('s', desktop.syncId, parsed.origin)
    const linkSyncId = parsed.path ? await deriveSyncId('l', siteSyncId, parsed.path) : null
    return this.write(async (tx) => {
      const desktops = sorted(await tx.objectStore('desktops').getAll())
      const desktop = requireRow(desktops.find((d) => d.id === desktopId) ?? desktops[0], '桌面')
      let site = await tx.objectStore('sites').index('origin').get([desktop.id, parsed.origin])
      const existed = !!site
      if (site && !parsed.path) return { result: 'site_exists', siteId: site.id, siteTitle: site.title }
      if (site && parsed.path && await tx.objectStore('links').index('path').get([site.id, parsed.path])) return { result: 'link_exists', siteId: site.id, siteTitle: site.title }
      if (!site) {
        const requested = groupId ? await tx.objectStore('groups').get(groupId) : undefined
        const target = requested?.desktopId === desktop.id ? requested.id : await this.firstGroup(tx, desktop.id)
        const resolvedSiteTitle = (extra?.siteTitle?.trim() || (title && !parsed.path ? title.trim() : '') || hostOf(parsed.origin)).slice(0, 80)
        const row = {
          ...entity(await this.next(tx, 'sites')),
          syncId: siteSyncId,
          ...stats(),
          desktopId: desktop.id,
          groupId: target,
          origin: parsed.origin,
          title: resolvedSiteTitle,
          ...(description ? { description } : {}),
          ...(intranetUrl ? { intranetUrl } : {}),
          iconVersion: icon ? Date.now() : 0,
          iconUrl: null,
        } as SiteRow
        const id = await tx.objectStore('sites').add(row)
        site = { ...row, id }
        if (icon) await tx.objectStore('icons').put({ siteId: id, dataUrl: icon })
      }
      if (parsed.path && linkSyncId) await tx.objectStore('links').add({ ...entity(await this.next(tx, 'links')), syncId: linkSyncId, ...stats(), siteId: site.id, path: parsed.path, title: (title?.trim() || fallbackLinkTitle(parsed.path)).slice(0, 80) } as LinkRow)
      return { result: parsed.path ? (existed ? 'link_added' : 'site_created') : 'site_created', siteId: site.id, siteTitle: site.title }
    })
  }
  async updateSite(id: number, patch: { title?: string; description?: string; intranetUrl?: string | null; groupId?: number; desktopId?: number }) {
    return this.write(async (tx) => {
      const site = requireRow(await tx.objectStore('sites').get(id), '卡片')
      if (patch.title !== undefined) site.title = nameOf(patch.title, 80)
      if (patch.description !== undefined) {
        if (typeof patch.description !== 'string') throw new Error('无效的描述')
        const desc = patch.description.trim().slice(0, MAX_SITE_DESCRIPTION_LENGTH)
        if (desc) site.description = desc
        else delete site.description
      }
      if (patch.intranetUrl !== undefined) {
        if (patch.intranetUrl !== null && typeof patch.intranetUrl !== 'string') throw new Error('无效的内网地址')
        const raw = (patch.intranetUrl ?? '').trim()
        if (!raw) {
          delete site.intranetUrl
        } else {
          const parsedIntranet = parseIntranetUrl(raw)
          if (!parsedIntranet) throw new Error('无效的内网地址')
          site.intranetUrl = parsedIntranet
        }
      }
      if (patch.groupId !== undefined || patch.desktopId !== undefined) {
        const groupId = patch.groupId ?? await this.firstGroup(tx, patch.desktopId!)
        const group = requireRow(await tx.objectStore('groups').get(groupId), '分组')
        const clash = await tx.objectStore('sites').index('origin').get([group.desktopId, site.origin])
        if (clash && clash.id !== site.id) throw new Error('目标桌面已有这个网站的卡片')
        if (group.id !== site.groupId) site.position = await this.next(tx, 'sites')
        site.groupId = group.id
        site.desktopId = group.desktopId
      }
      await tx.objectStore('sites').put(changed(site, {}))
      return ok
    })
  }
  async deleteSite(id: number) { return this.write(async (tx) => { await this.deleteSiteRows(tx, id); return ok }) }
  async renameLink(id: number, title: string) {
    return this.write(async (tx) => {
      const row = requireRow(await tx.objectStore('links').get(id), '链接')
      await tx.objectStore('links').put(changed(row, { title: nameOf(title, 80) }))
      return ok
    })
  }
  async deleteLink(id: number) { return this.write(async (tx) => { await tx.objectStore('links').delete(id); return ok }) }
  async order(order: OrderInput) {
    return this.write(async (tx) => {
      for (const storeName of ['desktops', 'groups'] as const) {
        const ids = order[storeName]
        if (!ids) continue
        if (!idsValid(ids)) throw new Error('无效的排序')
        for (const [position, id] of ids.entries()) {
          const row = await tx.objectStore(storeName).get(id)
          if (row) await tx.objectStore(storeName).put(changed(row, { position }) as DesktopRow & GroupRow)
        }
      }
      const seen = new Set<number>()
      for (const entry of order.sites ?? []) {
        if (!idsValid(entry.ids)) throw new Error('无效的卡片排序')
        const group = await tx.objectStore('groups').get(entry.groupId)
        if (!group) continue
        for (const [position, id] of entry.ids.entries()) {
          if (seen.has(id)) throw new Error('卡片排序重复')
          seen.add(id)
          const site = await tx.objectStore('sites').get(id)
          if (site?.desktopId === group.desktopId) await tx.objectStore('sites').put(changed(site, { groupId: group.id, position }))
        }
      }
      return ok
    })
  }
  async todos() {
    const rows = sorted(await (await this.db()).getAll('todos'))
    return rows.sort((a, b) => a.doneAt === null ? (b.doneAt === null ? 0 : -1) : b.doneAt === null ? 1 : b.doneAt - a.doneAt).map(({ id, text, doneAt }) => ({ id, text, doneAt }))
  }
  async addTodo(text: string) {
    return this.write(async (tx) => {
      const rows = await tx.objectStore('todos').getAll()
      const row = { ...entity(Math.min(0, ...rows.map((r) => r.position)) - 1), text: nameOf(text, MAX_TODO_LENGTH), doneAt: null } as TodoRow
      const id = await tx.objectStore('todos').add(row)
      return { id, text: row.text, doneAt: null }
    })
  }
  async updateTodo(id: number, patch: { text?: string; done?: boolean }) {
    return this.write(async (tx) => {
      const row = requireRow(await tx.objectStore('todos').get(id), '待办')
      if (patch.text !== undefined) row.text = nameOf(patch.text, MAX_TODO_LENGTH)
      if (patch.done !== undefined) {
        row.doneAt = patch.done ? Date.now() : null
        if (!patch.done) row.position = Math.min(0, ...(await tx.objectStore('todos').getAll()).map((r) => r.position)) - 1
      }
      await tx.objectStore('todos').put(changed(row, {}))
      return ok
    })
  }
  async deleteTodo(id: number) { return this.write(async (tx) => { await tx.objectStore('todos').delete(id); return ok }) }
  async clearDoneTodos() {
    return this.write(async (tx) => { for (const row of await tx.objectStore('todos').getAll()) if (row.doneAt !== null) await tx.objectStore('todos').delete(row.id); return ok })
  }
  async orderTodos(ids: number[]) {
    if (!idsValid(ids)) throw new Error('无效的待办排序')
    return this.write(async (tx) => {
      for (const [position, id] of ids.entries()) {
        const row = await tx.objectStore('todos').get(id)
        if (row && row.doneAt === null) await tx.objectStore('todos').put(changed(row, { position }))
      }
      return ok
    })
  }
  async recordClick(target: ClickTarget) {
    return this.writeSync(async (tx) => {
      const device = await tx.objectStore('sync').get('device')
      const deviceId = device?.key === 'device' ? device.deviceId : 'unknown'
      const clicked = <T extends { clicks: number; clickCounts?: ClickCounts }>(row: T) => {
        const clickCounts = { ...clickCountsOf(row) }
        clickCounts[deviceId] = Math.min(Number.MAX_SAFE_INTEGER, (clickCounts[deviceId] ?? 0) + 1)
        return { ...row, clickCounts, clicks: totalClicks(clickCounts), lastClickedAt: Date.now() }
      }
      // Opening a bookmark is merged as a counter, so it deliberately leaves updatedAt
      // alone: a click must not make this record win a later edit conflict.
      if ('linkId' in target) {
        const row = await tx.objectStore('links').get(target.linkId)
        if (row) await tx.objectStore('links').put(clicked(row))
      } else {
        const row = await tx.objectStore('sites').get(target.siteId)
        if (row) await tx.objectStore('sites').put(clicked(row))
      }
      await this.sortSitesByUsage(tx)
      return ok
    })
  }
  async usage(): Promise<UsageStats> {
    const rows = await this.rows()
    return { since: rows.settings.find((s) => s.key === 'since')?.value as number ?? null, sites: rows.sites.map((s) => ({ ...s, groupName: rows.groups.find((g) => g.id === s.groupId)?.name ?? '', links: rows.links.filter((l) => l.siteId === s.id) })) }
  }
  async icon(id: number): Promise<string | null> { return (await (await this.db()).get('icons', id))?.dataUrl ?? null }
  async setIcon(id: number, source: { dataUrl?: string; url?: string } = {}) {
    let dataUrl = source.dataUrl ? validateIcon(source.dataUrl) : null
    const url = source.url ? parseIconUrl(source.url) : null
    if (source.url && !url) throw new Error('无效的图片地址')
    if (!dataUrl && !url) {
      const site = requireRow(await (await this.db()).get('sites', id), '卡片')
      try {
        const found = await this.options.fetchIcon(site.origin)
        if (found) dataUrl = validateIcon(found)
      } catch { /* An unavailable icon falls back to a letter. */ }
      if (!dataUrl) throw new Error('没有可用的缓存图标，可以上传图片或填写图标地址')
    }
    return this.write(async (tx) => {
      const row = requireRow(await tx.objectStore('sites').get(id), '卡片')
      if (dataUrl) await tx.objectStore('icons').put({ siteId: id, dataUrl })
      else await tx.objectStore('icons').delete(id)
      const iconVersion = dataUrl ? Math.max(Date.now(), row.iconVersion + 1) : 0
      // Only the custom address travels to other devices, so caching a picture here
      // leaves the modification time alone.
      await tx.objectStore('sites').put({ ...row, iconUrl: url, iconVersion, updatedAt: url === row.iconUrl ? row.updatedAt : Math.max(Date.now(), row.updatedAt + 1) })
      return { ...ok, iconUrl: url }
    })
  }
  async removeIcon(id: number) {
    return this.write(async (tx) => {
      const row = requireRow(await tx.objectStore('sites').get(id), '卡片')
      await tx.objectStore('icons').delete(id)
      await tx.objectStore('sites').put({ ...row, iconUrl: null, iconVersion: -1, updatedAt: row.iconUrl === null ? row.updatedAt : Math.max(Date.now(), row.updatedAt + 1) })
      return ok
    })
  }
  async exportBackup(desktopId?: number) {
    const db = await this.db()
    const tx = db.transaction([...STORES, VAULT_STORE] as [...typeof STORES, typeof VAULT_STORE], 'readonly')
    const [desktops, groups, sites, links, icons, todos, settings] = await Promise.all(STORES.map((store) => tx.objectStore(store).getAll())) as [DesktopRow[], GroupRow[], SiteRow[], LinkRow[], { siteId: number; dataUrl: string }[], TodoRow[], { key: string; value: SystemSettings | number }[]]
    const vault = (await tx.objectStore('vault').get('vault'))?.vault
    await tx.done
    if (desktopId !== undefined && !desktops.some((d) => d.id === desktopId)) throw new Error('桌面不存在')
    const iconMap = new Map(icons.map((i) => [i.siteId, i.dataUrl]))
    const full = desktopId === undefined
    const metadata = (row: Entity & { clicks?: number; clickCounts?: ClickCounts; lastClickedAt?: number | null }) => full ? { syncId: row.syncId, createdAt: row.createdAt, updatedAt: row.updatedAt, ...(row.clicks !== undefined ? { clicks: row.clicks, clickCounts: clickCountsOf({ clicks: row.clicks, clickCounts: row.clickCounts }), lastClickedAt: row.lastClickedAt } : {}) } : {}
    const backup = {
      version: full ? 3 : 2,
      exportedAt: new Date().toISOString(),
      desktops: sorted(desktops).filter((d) => desktopId === undefined || d.id === desktopId).map((d) => ({ name: d.name, view: d.view, ...metadata(d), groups: sorted(groups).filter((g) => g.desktopId === d.id).map((g) => ({ name: g.name, pinned: g.pinned, ...metadata(g), sites: sorted(sites).filter((s) => s.groupId === g.id).map((s) => {
        const dataUrl = iconMap.get(s.id)
        const match = dataUrl && /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
        return { origin: s.origin, title: s.title, ...(s.description ? { description: s.description } : {}), ...(s.intranetUrl ? { intranetUrl: s.intranetUrl } : {}), ...metadata(s), ...(s.iconUrl ? { iconUrl: s.iconUrl } : {}), ...(match ? { icon: { type: match[1], data: match[2] } } : {}), links: sorted(links).filter((l) => l.siteId === s.id).map((l) => ({ path: l.path, title: l.title, ...metadata(l) })) }
      }) })) })),
      ...(full ? { local: { settings: { ...DEFAULT_SETTINGS, ...(settings.find((s) => s.key === 'system')?.value as SystemSettings | undefined) }, since: settings.find((s) => s.key === 'since')?.value ?? Date.now(), todos: sorted(todos).map((t) => ({ text: t.text, doneAt: t.doneAt, ...metadata(t) })) } } : {}),
      // Ciphertext only: the private spaces stay locked inside the file
      ...(full && vault ? { vault } : {}),
    }
    return { json: JSON.stringify(backup, null, 2), filename: `77bookmarks-${full ? 'full-' : ''}${new Date().toISOString().slice(0, 10)}.json` }
  }
  async importBackup(input: unknown, mode: ImportMode): Promise<ImportResult> {
    const parsed = parseBackup(input)
    if ('error' in parsed) throw new Error(parsed.error)
    if (mode !== 'append' && mode !== 'replace') throw new Error('无效的导入方式')
    // All validation happens before clearing or writing any data.
    for (const d of parsed.desktops) for (const g of d.groups) for (const s of g.sites) if (s.icon) validateIcon(`data:${s.icon.type};base64,${s.icon.data}`)
    // Restoring never removes a private space: the records of the file are added to the ones
    // here, which is harmless to repeat should the import below fail.
    if (mode === 'replace' && parsed.vault) {
      const vaultTx = (await this.db()).transaction(VAULT_STORE, 'readwrite')
      const restored = restoreVault((await vaultTx.objectStore('vault').get('vault'))?.vault, parsed.vault)
      if (Object.keys(restored.chunks).length <= MAX_CHUNKS) await vaultTx.objectStore('vault').put({ key: 'vault', vault: restored })
      await vaultTx.done
    }
    return this.write(async (tx) => {
      if ((mode === 'append' ? await tx.objectStore('desktops').count() : 0) + parsed.desktops.length > MAX_DESKTOPS) throw new Error(`最多只能有 ${MAX_DESKTOPS} 个桌面`)
      if (mode === 'replace') for (const store of ['desktops', 'groups', 'sites', 'links', 'icons'] as const) await tx.objectStore(store).clear()
      const desktopIds: number[] = []
      for (const d of parsed.desktops) {
        const desktopId = await tx.objectStore('desktops').add({ ...this.importEntity(d, mode), name: d.name, view: d.view, position: await this.next(tx, 'desktops') } as DesktopRow)
        desktopIds.push(desktopId)
        for (const [position, g] of d.groups.entries()) {
          const groupId = await tx.objectStore('groups').add({ ...this.importEntity(g, mode), position, desktopId, name: g.name, pinned: g.pinned === true } as GroupRow)
          for (const [sitePosition, s] of g.sites.entries()) await this.importSite(tx, desktopId, groupId, s, sitePosition, mode)
        }
      }
      // Appending imports desktops only, so existing global settings and to-dos are untouched.
      if (mode === 'replace' && parsed.local) {
        await tx.objectStore('todos').clear()
        for (const [position, todo] of parsed.local.todos.entries()) await tx.objectStore('todos').add({ ...this.importEntity(todo, mode), position, text: todo.text, doneAt: todo.doneAt } as TodoRow)
        await tx.objectStore('settings').put({ key: 'system', value: parsed.local.settings })
        await tx.objectStore('settings').put({ key: 'since', value: parsed.local.since })
      }
      return { ...ok, desktopIds, ...backupStats(parsed.desktops) }
    })
  }
  private importEntity(source: { syncId?: string; createdAt?: number; updatedAt?: number }, mode: ImportMode) {
    const base = entity()
    return mode === 'replace' ? { ...base, syncId: source.syncId ?? base.syncId, createdAt: source.createdAt ?? base.createdAt, updatedAt: source.updatedAt ?? base.updatedAt } : base
  }
  private async importSite(tx: WriteTransaction, desktopId: number, groupId: number, s: BackupSite, position: number, mode: ImportMode) {
    const siteId = await tx.objectStore('sites').add({ ...this.importEntity(s, mode), ...stats(), clicks: s.clicks ?? 0, ...(s.clickCounts ? { clickCounts: s.clickCounts } : {}), lastClickedAt: s.lastClickedAt ?? null, position, desktopId, groupId, origin: s.origin, title: s.title, ...(s.description ? { description: s.description } : {}), ...(s.intranetUrl ? { intranetUrl: s.intranetUrl } : {}), iconUrl: s.iconUrl ?? null, iconVersion: s.icon ? Date.now() : 0 } as SiteRow)
    if (s.icon) await tx.objectStore('icons').put({ siteId, dataUrl: `data:${s.icon.type};base64,${s.icon.data}` })
    for (const [linkPosition, l] of s.links.entries()) await tx.objectStore('links').add({ ...this.importEntity(l, mode), ...stats(), clicks: l.clicks ?? 0, ...(l.clickCounts ? { clickCounts: l.clickCounts } : {}), lastClickedAt: l.lastClickedAt ?? null, position: linkPosition, siteId, path: l.path, title: l.title } as LinkRow)
  }
  async importChrome(desktop: BackupDesktop) {
    return this.importBackup({ version: 2, desktops: [desktop] }, 'append')
  }

  /** What the settings page and the sync engine need to know about the cloud copy */
  async syncStatus(): Promise<SyncStatus> {
    const { deviceId, config, state, base } = await this.syncRecords()
    const snapshot = await buildSnapshot(await this.db(), deviceId)
    return {
      config, state, deviceId,
      synced: base !== null,
      dirty: base === null || snapshotFingerprint(snapshot) !== snapshotFingerprint(base),
    }
  }
  async updateSyncConfig(patch: Partial<SyncConfig>): Promise<SyncConfig> {
    return this.writeSync(async (tx) => {
      const stored = await tx.objectStore('sync').get('config')
      const previous = (stored as { config?: SyncConfig } | undefined)?.config ?? EMPTY_SYNC_CONFIG
      const kind = patch.kind ?? previous.kind
      if (!isSyncKind(kind)) throw new Error('无效的同步方式')
      const endpoint = (patch.endpoint ?? previous.endpoint).trim().slice(0, 500)
      if (endpoint) {
        let url: URL
        try { url = new URL(endpoint) } catch { throw new Error('无效的同步地址') }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请填写不含账号、查询参数或片段的 HTTP(S) 地址')
      }
      const value: SyncConfig = {
        enabled: patch.enabled ?? previous.enabled,
        kind,
        endpoint,
        token: (patch.token ?? previous.token).trim().slice(0, 500),
        username: (patch.username ?? previous.username).trim().slice(0, 200),
        password: (patch.password ?? previous.password).slice(0, 500),
      }
      if (value.enabled && (!value.endpoint || !(kind === 'worker' ? value.token : value.username))) {
        throw new Error(kind === 'worker' ? '请填写 Worker 地址和同步令牌' : '请填写 WebDAV 地址和用户名')
      }
      if (previous.kind !== value.kind || previous.endpoint !== value.endpoint || previous.username !== value.username) {
        await tx.objectStore('sync').put({ key: 'base', snapshot: null })
        await tx.objectStore('sync').put({ key: 'state', state: EMPTY_SYNC_STATE })
      }
      await tx.objectStore('sync').put({ key: 'config', config: value })
      return value
    })
  }
  /**
   * Merges the cloud copy into the local database in one transaction and returns the
   * resulting local state, which the caller uploads. The common ancestor advances to the
   * version that was just merged, so an upload that fails loses nothing and the next run
   * still compares against the right version.
   */
  async mergeRemote(remote: SyncSnapshot | null): Promise<{ snapshot: SyncSnapshot; stats: MergeStats }> {
    return this.writeSync(async (tx) => {
      const read = async () => {
        const [desktops, groups, sites, links, todos, settings, vault] = await Promise.all([
          tx.objectStore('desktops').getAll(), tx.objectStore('groups').getAll(), tx.objectStore('sites').getAll(),
          tx.objectStore('links').getAll(), tx.objectStore('todos').getAll(), tx.objectStore('settings').getAll(),
          tx.objectStore('vault').get('vault'),
        ])
        return { desktops, groups, sites, links, todos, settings, vault: vault?.vault }
      }
      const store = tx.objectStore('sync')
      const [deviceRecord, baseRecord] = await Promise.all([store.get('device'), store.get('base')])
      const deviceId = (deviceRecord as { deviceId?: string } | undefined)?.deviceId ?? ''
      const base = (baseRecord as { snapshot?: SyncSnapshot | null } | undefined)?.snapshot ?? null
      let local = snapshotOf(await read(), deviceId)
      const pristine = !base && remote && local.desktops.length === 1 && local.groups.length === 1
        && local.desktops[0].syncId === DEFAULT_DESKTOP_SYNC_ID && local.desktops[0].updatedAt === 0
        && local.groups[0].syncId === DEFAULT_GROUP_SYNC_ID && local.groups[0].updatedAt === 0
        && !local.sites.length && !local.links.length && !local.todos.length && local.settings.updatedAt === 0
      // An untouched board takes the cloud copy as it is, but may already hold private spaces
      if (pristine) local = { ...remote, deviceId, ...(local.vault ? { vault: local.vault } : {}) }
      const { snapshot, stats } = mergeSnapshots(pristine ? remote : remote ? base : null, local, remote ?? local)
      await applySnapshot(tx, snapshot)
      await this.sortSitesByUsage(tx)
      await store.put({ key: 'base', snapshot: remote })
      // Rebuilt from the records that were actually written, so the upload matches the database
      return { snapshot: snapshotOf(await read(), deviceId), stats }
    })
  }
  /** The whole board as one snapshot, which is how a private space is put away */
  async snapshot(): Promise<SyncSnapshot> {
    const { deviceId } = await this.syncRecords()
    return buildSnapshot(await this.db(), deviceId)
  }
  /** The encrypted private spaces. Only ciphertext passes through here: keys never leave the page. */
  async vaultRead(): Promise<Vault> {
    const record = await (await this.db()).get('vault', 'vault')
    if (!record) throw new Error('保险库不可用，请刷新后重试')
    return record.vault
  }
  /**
   * Stores records in the vault. `guard` names a record and what the caller last saw in it
   * (null for "not there"): when it has changed since, somebody else wrote the same space
   * and nothing is stored.
   */
  async vaultWrite(input: Record<string, string>, guard?: { id: string; value: string | null }) {
    const chunks = parseChunks(input)
    if (!chunks || !Object.keys(chunks).length) throw new Error('无效的保险库数据')
    const db = await this.db()
    const tx = db.transaction(VAULT_STORE, 'readwrite')
    const settled = tx.done.catch(() => undefined)
    try {
      const record = await tx.objectStore('vault').get('vault')
      if (!record) throw new Error('保险库不可用，请刷新后重试')
      if (guard && (record.vault.chunks[guard.id] ?? null) !== guard.value) throw new Error('这个隐私空间已在别处被修改，请重新解锁')
      const merged = { ...record.vault.chunks, ...chunks }
      if (Object.keys(merged).length > MAX_CHUNKS) throw new Error('保险库已满，无法再保存')
      await tx.objectStore('vault').put({ key: 'vault', vault: { ...record.vault, chunks: merged } })
      await tx.done
      return ok
    } catch (error) {
      try { tx.abort() } catch { /* Already aborted. */ }
      await settled
      throw error
    }
  }
  /** Records the outcome of a sync run; a successful upload moves the common ancestor forward */
  async recordSyncResult(result: { pushed?: SyncSnapshot; stats?: MergeStats; error?: string }): Promise<SyncState> {
    return this.writeSync(async (tx) => {
      const store = tx.objectStore('sync')
      const stored = await store.get('state')
      const previous = (stored as { state?: SyncState } | undefined)?.state ?? EMPTY_SYNC_STATE
      const state: SyncState = {
        lastSyncAt: result.error ? previous.lastSyncAt : Date.now(),
        lastResult: result.stats ?? previous.lastResult,
        lastError: result.error ?? null,
      }
      await store.put({ key: 'state', state })
      if (result.pushed) await store.put({ key: 'base', snapshot: result.pushed })
      return state
    })
  }
}

export type ServiceMethod = { [K in keyof LocalService]: LocalService[K] extends (...args: never[]) => unknown ? K : never }[keyof LocalService]
export const READ_METHODS = new Set<ServiceMethod>(['board', 'search', 'settings', 'todos', 'usage', 'icon', 'exportBackup', 'vaultRead'])
export const SERVICE_METHODS: ServiceMethod[] = ['board', 'search', 'settings', 'updateSettings', 'createDesktop', 'updateDesktop', 'deleteDesktop', 'createGroup', 'renameGroup', 'pinGroup', 'deleteGroup', 'addBookmark', 'updateSite', 'deleteSite', 'renameLink', 'deleteLink', 'order', 'todos', 'addTodo', 'updateTodo', 'deleteTodo', 'clearDoneTodos', 'orderTodos', 'recordClick', 'usage', 'icon', 'setIcon', 'removeIcon', 'exportBackup', 'importBackup', 'importChrome', 'vaultRead', 'vaultWrite']
