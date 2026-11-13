import { attachContextMenuHandler, registerContextMenus, reportAddResult } from '../extension/context-menu'
import { describeResult, isBookmarkable } from '../extension/lib'
import { clipperRpc } from './client'

const BRIDGE = 'incognito-bridge'

/**
 * Keeps the bridge script on the pages of the connected server, and only there. The access
 * it needs was granted when the connection code was entered.
 */
async function syncBridge() {
  const { serverOrigin } = await chrome.storage.local.get('serverOrigin')
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE] }).catch(() => [])
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE] }).catch(() => undefined)
  if (typeof serverOrigin !== 'string' || !serverOrigin) return
  await chrome.scripting.registerContentScripts([{ id: BRIDGE, matches: [`${serverOrigin}/*`], js: ['bridge.js'], runAt: 'document_start', persistAcrossSessions: true }]).catch(() => undefined)
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  registerContextMenus()
  void syncBridge()
  if (reason === 'install') void chrome.runtime.openOptionsPage()
})
chrome.runtime.onStartup.addListener(() => { void syncBridge() })
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'serverOrigin' in changes) void syncBridge()
})

// A private space of the self-hosted page asks for an address to be opened in an incognito window
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'open-incognito') return
  void (async () => {
    const { serverOrigin } = await chrome.storage.local.get('serverOrigin')
    let asked: URL | null = null
    try { asked = new URL(String(message.url)) } catch { /* Refused below. */ }
    const from = sender.tab?.url ?? sender.url ?? ''
    // Only the connected board may ask, and only for ordinary web addresses
    if (!asked || !/^https?:$/.test(asked.protocol) || typeof serverOrigin !== 'string' || !serverOrigin || !from.startsWith(`${serverOrigin}/`)) return false
    await chrome.windows.create({ url: asked.href, incognito: true, focused: true })
    return true
  })().then((ok) => respond({ ok }), () => respond({ ok: false }))
  return true
})

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage()
})

attachContextMenuHandler(async (url, title, tab) => {
  if (!isBookmarkable(url)) {
    await reportAddResult(tab, '这个页面不能添加为书签', true)
    return
  }
  const stored = await chrome.storage.local.get(['serverOrigin', 'token', 'desktopId', 'groupId'])
  const origin = typeof stored.serverOrigin === 'string' ? stored.serverOrigin : ''
  const token = typeof stored.token === 'string' ? stored.token : ''
  if (!origin || !token) {
    await reportAddResult(tab, '请先在扩展选项里填写连接码', true)
    void chrome.runtime.openOptionsPage()
    return
  }
  try {
    const result = await clipperRpc(
      { origin, token },
      'addBookmark',
      url,
      Number(stored.desktopId) || 0,
      Number(stored.groupId) || undefined,
      title,
    )
    await reportAddResult(tab, describeResult(result))
  } catch (error) {
    await reportAddResult(tab, error instanceof Error ? error.message : '添加失败', true)
  }
})
