import { LocalService, READ_METHODS, SERVICE_METHODS, type ServiceMethod } from '../src/storage/service'
import { DATA_CHANGED, DATA_MESSAGE } from '../src/storage/client'

const service = new LocalService()

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== DATA_MESSAGE) return
  if (!SERVICE_METHODS.includes(message.method) || !Array.isArray(message.args)) {
    respond({ ok: false, error: '无效的本地数据请求' })
    return
  }
  const method = message.method as ServiceMethod
  const run = service[method] as (...args: unknown[]) => Promise<unknown>
  void run.apply(service, message.args).then((value) => {
    respond({ ok: true, value })
    if (!READ_METHODS.has(method)) void chrome.runtime.sendMessage({ type: DATA_CHANGED }).catch(() => undefined)
  }, (error) => respond({ ok: false, error: error instanceof Error ? error.message : '保存失败，请重试' }))
  return true // Keep the response port alive until the IndexedDB transaction commits.
})

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'add-page', title: '添加当前网页到 77 Bookmarks', contexts: ['page'] })
    chrome.contextMenus.create({ id: 'add-link', title: '添加此链接到 77 Bookmarks', contexts: ['link'] })
  })
  if (reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
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
