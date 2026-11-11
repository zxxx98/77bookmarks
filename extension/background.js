/** Context menu, keyboard shortcut and the feedback shown on the page after adding */

import { getConnection, getTarget } from './config.js'
import { addBookmark, describeResult, isBookmarkable } from './lib.js'

const MENU_PAGE = 'add-page'
const MENU_LINK = 'add-link'
const BADGE = {
  pending: { text: '…', color: '#6b6a65' },
  ok: { text: '✓', color: '#3b6956' },
  error: { text: '!', color: '#b3402f' },
}

// Menus outlive the service worker, so they are only created when the extension is installed or updated
chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_PAGE, title: '添加当前网页到 77 Bookmarks', contexts: ['page'] })
    chrome.contextMenus.create({ id: MENU_LINK, title: '添加此链接到 77 Bookmarks', contexts: ['link'] })
  })
  if (reason === 'install') void chrome.runtime.openOptionsPage()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // A link is added by its address alone: the tab title belongs to the page around it
  if (info.menuItemId === MENU_LINK) void add({ url: info.linkUrl ?? '' }, tab)
  else if (info.menuItemId === MENU_PAGE) void add({ url: tab?.url ?? info.pageUrl ?? '', title: tab?.title }, tab)
})

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'add-page') void add({ url: tab?.url ?? '', title: tab?.title }, tab)
})

/**
 * @param {{ url: string, title?: string }} page
 * @param {chrome.tabs.Tab | undefined} tab
 */
async function add(page, tab) {
  const connection = await getConnection()
  if (!connection) {
    await report(tab, '还没有连接书签页，请先在扩展选项里粘贴连接码', 'error')
    void chrome.runtime.openOptionsPage()
    return
  }
  if (!isBookmarkable(page.url)) {
    await report(tab, '这个页面不能添加为书签', 'error')
    return
  }
  await report(tab, '正在添加到书签页…', 'pending')
  try {
    const response = await addBookmark(connection, { ...page, ...(await getTarget()) })
    await report(tab, describeResult(response), 'ok')
  } catch (error) {
    await report(tab, error instanceof Error ? error.message : '添加失败', 'error')
  }
}

/** Timer that clears the badge, replaced whenever a newer result arrives */
let badgeTimer = 0

/**
 * Shows the outcome on the page it concerns, and on the toolbar icon for pages that can't be scripted
 * @param {chrome.tabs.Tab | undefined} tab
 * @param {string} message
 * @param {keyof typeof BADGE} kind
 */
async function report(tab, message, kind) {
  clearTimeout(badgeTimer)
  void chrome.action.setBadgeBackgroundColor({ color: BADGE[kind].color })
  void chrome.action.setBadgeText({ text: BADGE[kind].text })
  void chrome.action.setTitle({ title: kind === 'pending' ? '添加到 77 Bookmarks' : message })
  if (kind !== 'pending') {
    badgeTimer = setTimeout(() => {
      void chrome.action.setBadgeText({ text: '' })
      void chrome.action.setTitle({ title: '添加到 77 Bookmarks' })
    }, 4000)
  }
  if (!tab?.id) return
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showToast, args: [message, kind] })
  } catch {
    // The Web Store, the PDF viewer and browser pages refuse scripts: the badge has to do there
  }
}

/**
 * Runs inside the page, so it can't use anything from this file
 * @param {string} message
 * @param {string} kind
 */
function showToast(message, kind) {
  const ID = 'bookmarks-77-toast'
  document.getElementById(ID)?.remove()
  const host = document.createElement('div')
  host.id = ID
  host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483647'
  const box = document.createElement('div')
  box.setAttribute('role', 'status')
  box.textContent = message
  box.style.cssText = [
    'font:500 13px/1.45 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
    'max-width:320px',
    'padding:10px 14px',
    'border-radius:10px',
    'color:#faf8f5',
    `background:${kind === 'error' ? '#b3402f' : '#262522'}`,
    'box-shadow:0 8px 28px rgba(0,0,0,.28)',
    'overflow-wrap:anywhere',
  ].join(';')
  // A shadow root keeps the page's styles off the message
  host.attachShadow({ mode: 'closed' }).append(box)
  document.documentElement.append(host)
  setTimeout(() => host.remove(), kind === 'pending' ? 30_000 : kind === 'error' ? 5000 : 2600)
}
