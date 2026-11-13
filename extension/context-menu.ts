import { selectionTitle, textFragmentUrl } from '../shared/url'

/** Registers the right-click menu items shared by both the full extension and the clipper */
export function registerContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'add-page', title: '添加当前网页到 77 Bookmarks', contexts: ['page'] })
    chrome.contextMenus.create({ id: 'add-link', title: '添加此链接到 77 Bookmarks', contexts: ['link'] })
    chrome.contextMenus.create({ id: 'add-selection', title: '添加选中文字到 77 Bookmarks', contexts: ['selection'] })
  })
}

export function attachContextMenuHandler(
  onAdd: (url: string, title: string | undefined, tab: chrome.tabs.Tab | undefined) => Promise<void>,
) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'add-link') void onAdd(info.linkUrl ?? '', undefined, tab)
    else if (info.menuItemId === 'add-page') void onAdd(tab?.url ?? info.pageUrl ?? '', tab?.title, tab)
    else if (info.menuItemId === 'add-selection') {
      void readSelection(tab, info.frameId).then((text) => {
        const selection = text || info.selectionText || ''
        const page = tab?.url ?? info.pageUrl ?? ''
        return onAdd(textFragmentUrl(page, selection), selectionTitle(selection) || tab?.title, tab)
      })
    }
  })
}

/**
 * Runs in the page: the selected text with its line breaks, widened to whole words.
 * The browser only finds a text fragment that starts and ends on word boundaries.
 */
export function wholeWordSelection(): string {
  const selection = getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) return selection?.toString() ?? ''
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection
  const range = selection.getRangeAt(0).cloneRange()
  const words = new Intl.Segmenter(undefined, { granularity: 'word' })
  const snap = (node: Node, offset: number, toEnd: boolean) => {
    if (node.nodeType !== Node.TEXT_NODE) return offset
    for (const word of words.segment((node as Text).data)) {
      const end = word.index + word.segment.length
      if (word.isWordLike && word.index < offset && offset < end) return toEnd ? end : word.index
    }
    return offset
  }
  range.setStart(range.startContainer, snap(range.startContainer, range.startOffset, false))
  range.setEnd(range.endContainer, snap(range.endContainer, range.endOffset, true))
  // Only a live selection reports the line breaks between blocks, so it is widened and then put back.
  selection.removeAllRanges()
  selection.addRange(range)
  const text = selection.toString()
  if (anchorNode && focusNode) selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)
  return text
}

async function readSelection(tab: chrome.tabs.Tab | undefined, frameId: number | undefined): Promise<string> {
  if (!tab?.id) return ''
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId ?? 0] },
      func: wholeWordSelection,
    })
    return typeof injected?.result === 'string' ? injected.result : ''
  } catch {
    return '' // Restricted pages fall back to the menu event's text.
  }
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
