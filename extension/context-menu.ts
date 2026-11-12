/** Registers the two right-click menu items shared by both the full extension and the clipper */
export function registerContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'add-page', title: '添加当前网页到 77 Bookmarks', contexts: ['page'] })
    chrome.contextMenus.create({ id: 'add-link', title: '添加此链接到 77 Bookmarks', contexts: ['link'] })
  })
}

export function attachContextMenuHandler(
  onAdd: (url: string, title: string | undefined, tab: chrome.tabs.Tab | undefined) => Promise<void>,
) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'add-link') void onAdd(info.linkUrl ?? '', undefined, tab)
    else if (info.menuItemId === 'add-page') void onAdd(tab?.url ?? info.pageUrl ?? '', tab?.title, tab)
  })
}

/** Shows the result on the toolbar icon and, where permitted, as an in-page toast */
export async function reportAddResult(tab: chrome.tabs.Tab | undefined, message: string, failed = false) {
  const tabId = tab?.id
  await chrome.action.setBadgeBackgroundColor({ color: failed ? '#b3402f' : '#3b6956', ...(tabId ? { tabId } : {}) })
  await chrome.action.setBadgeText({ text: failed ? '!' : '✓', ...(tabId ? { tabId } : {}) })
  await chrome.action.setTitle({ title: message, ...(tabId ? { tabId } : {}) })
  if (!tabId) return
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [message, failed],
      func: (text: string, error: boolean) => {
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
      },
    })
  } catch {
    /* Restricted pages use the toolbar badge. */
  }
}
