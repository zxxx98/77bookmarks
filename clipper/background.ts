import { attachContextMenuHandler, registerContextMenus, reportAddResult } from '../extension/context-menu'
import { describeResult, isBookmarkable } from '../extension/lib'
import { clipperRpc } from './client'

chrome.runtime.onInstalled.addListener(({ reason }) => {
  registerContextMenus()
  if (reason === 'install') void chrome.runtime.openOptionsPage()
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
