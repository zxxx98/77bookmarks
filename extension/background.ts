import { LocalService, READ_METHODS, SERVICE_METHODS, type ServiceMethod } from '../src/storage/service'
import { DATA_CHANGED, DATA_MESSAGE, SYNC_MESSAGE } from '../src/storage/client'
import { SYNC_METHODS, runSyncMethod } from '../src/sync/control'
import { fetchTitleHtml, TITLE_MESSAGE } from '../src/page-title'
import { parseBookmarkUrl } from '../shared/url'

const service = new LocalService()

/** Fires once, half a minute after the last local change, to upload it */
const SYNC_SOON = '77bookmarks:sync-soon'
/** Periodically pulls what other devices changed, even when this board is idle */
const SYNC_TICK = '77bookmarks:sync-tick'

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== TITLE_MESSAGE) return
  const parsed = typeof message.url === 'string' ? parseBookmarkUrl(message.url) : null
  if (!parsed?.path) { respond({ html: null }); return }
  // Permission is requested by the page's submit gesture, never by the worker.
  void chrome.permissions.contains({ origins: [`${parsed.origin}/*`] }).then(
    (granted) => granted ? fetchTitleHtml(message.url) : null,
  ).then((html) => respond({ html }), () => respond({ html: null }))
  return true
})

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== DATA_MESSAGE) return
  if (!SERVICE_METHODS.includes(message.method) || !Array.isArray(message.args)) {
    respond({ ok: false, error: '无效的本地数据请求' })
    return
  }
  const method = message.method as ServiceMethod
  const run = service[method] as (...values: unknown[]) => Promise<unknown>
  void run.apply(service, message.args).then((value) => {
    respond({ ok: true, value })
    if (!READ_METHODS.has(method)) {
      void chrome.runtime.sendMessage({ type: DATA_CHANGED }).catch(() => undefined)
      // Uploading straight away would fight with the next edit, so it waits a moment
      if (method !== 'setIcon' || (message.args[1]?.url !== undefined)) void soon()
    }
  }, (error) => respond({ ok: false, error: error instanceof Error ? error.message : '保存失败，请重试' }))
  return true // Keep the response port alive until the IndexedDB transaction commits.
})

// Cloud sync lives here rather than in the new-tab page: one engine owns the connection,
// and it keeps running when the page is closed.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== SYNC_MESSAGE) return
  const method = String(message.method ?? '')
  if (!SYNC_METHODS.includes(method as typeof SYNC_METHODS[number])) {
    respond({ ok: false, error: '无效的同步请求' })
    return
  }
  void runSyncMethod(service, method, Array.isArray(message.args) ? message.args : []).then(({ value, changed }) => {
    respond({ ok: true, value, changed })
    if (method === 'configure') void schedule()
    if (changed) void chrome.runtime.sendMessage({ type: DATA_CHANGED }).catch(() => undefined)
  }, (error) => {
    void chrome.runtime.sendMessage({ type: DATA_CHANGED }).catch(() => undefined)
    respond({ ok: false, error: error instanceof Error ? error.message : '同步失败，请重试' })
  })
  return true
})

/** Arms the alarms for the current configuration; no alarm is set while syncing is off */
async function schedule() {
  await chrome.alarms.clear(SYNC_TICK)
  const { config, dirty } = await service.syncStatus()
  if (!config.enabled) {
    await chrome.alarms.clear(SYNC_SOON)
    return
  }
  chrome.alarms.create(SYNC_TICK, { periodInMinutes: 15, delayInMinutes: 15 })
  if (dirty) void soon()
}

async function soon() {
  const { config } = await service.syncStatus()
  if (!config.enabled) return
  if (!(await chrome.alarms.get(SYNC_SOON))) chrome.alarms.create(SYNC_SOON, { delayInMinutes: 0.5 })
}

async function runSync(force: boolean) {
  if (!(await service.syncStatus()).config.enabled) return
  try {
    const { value, changed } = await runSyncMethod(service, 'now', [force])
    if (changed) void chrome.runtime.sendMessage({ type: DATA_CHANGED }).catch(() => undefined)
    return value
  } catch {
    void chrome.runtime.sendMessage({ type: DATA_CHANGED }).catch(() => undefined)
    // The reason is kept in the sync state and shown in the settings page.
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_SOON || alarm.name === SYNC_TICK) void runSync(true)
})

chrome.runtime.onStartup.addListener(() => { void schedule(); void runSync(true) })

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'add-page', title: '添加当前网页到 77 Bookmarks', contexts: ['page'] })
    chrome.contextMenus.create({ id: 'add-link', title: '添加此链接到 77 Bookmarks', contexts: ['link'] })
  })
  if (reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
  void schedule()
  void runSync(true)
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'add-link') void add(info.linkUrl ?? '', undefined, tab)
  else if (info.menuItemId === 'add-page') void add(tab?.url ?? info.pageUrl ?? '', tab?.title, tab)
})
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'add-page') void add(tab?.url ?? '', tab?.title, tab)
})

async function add(url: string, title: string | undefined, tab: chrome.tabs.Tab | undefined) {
  if (!/^https?:\/\//i.test(url)) { await report(tab, '这个页面不能添加为书签', true); return }
  try {
    const target = await chrome.storage.local.get(['desktopId', 'groupId'])
    const result = await service.addBookmark(url, Number(target.desktopId) || 0, Number(target.groupId) || undefined, title)
    await report(tab, result.result.endsWith('exists') ? `「${result.siteTitle}」里已有这个书签` : `已添加到「${result.siteTitle}」`)
    void chrome.runtime.sendMessage({ type: DATA_CHANGED }).catch(() => undefined)
    void soon()
    // Fetch only from Chrome's favicon cache; saving the bookmark never waits on the network.
    if (result.result === 'site_created') {
      await service.setIcon(result.siteId).catch(() => undefined)
      void chrome.runtime.sendMessage({ type: DATA_CHANGED }).catch(() => undefined)
    }
  } catch (error) { await report(tab, error instanceof Error ? error.message : '添加失败', true) }
}
async function report(tab: chrome.tabs.Tab | undefined, message: string, failed = false) {
  const tabId = tab?.id
  await chrome.action.setBadgeBackgroundColor({ color: failed ? '#b3402f' : '#3b6956', ...(tabId ? { tabId } : {}) })
  await chrome.action.setBadgeText({ text: failed ? '!' : '✓', ...(tabId ? { tabId } : {}) })
  await chrome.action.setTitle({ title: message, ...(tabId ? { tabId } : {}) })
  if (!tabId) return
  try {
    await chrome.scripting.executeScript({ target: { tabId }, args: [message, failed], func: (text: string, error: boolean) => {
      document.getElementById('bookmarks-77-toast')?.remove()
      const host = document.createElement('div')
      host.id = 'bookmarks-77-toast'
      host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647'
      const box = document.createElement('div')
      box.textContent = text
      box.style.cssText = `font:13px/1.5 system-ui;padding:12px 16px;border-radius:8px;color:white;background:${error ? '#b3402f' : '#262522'};max-width:320px;overflow-wrap:anywhere;box-shadow:0 8px 28px #0004`
      host.attachShadow({ mode: 'closed' }).append(box)
      document.documentElement.append(host)
      setTimeout(() => host.remove(), 4000)
    } })
  } catch { /* Restricted pages use the toolbar badge. */ }
}

void schedule()
