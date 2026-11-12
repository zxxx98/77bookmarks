import { chromium, expect } from '@playwright/test'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createServer } from 'node:http'

const extensionPath = resolve('dist-extension')
const profile = await mkdtemp(join(tmpdir(), '77bookmarks-extension-'))
const errors = []
const requests = []
const titleRequests = []
const titleResponses = []
// Deliberately omit CORS headers: the extension worker must use its granted host access.
const titleServer = createServer((request, response) => {
  titleRequests.push(request.url)
  if (request.url === '/slow') return
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  const body = request.url === '/docs' ? '<head><title>中文 &amp; 标题测试</title></head>'
    : request.url === '/other' ? '<head><title>切换后的标题</title></head>'
    : request.url === '/delayed' || request.url === '/late' || request.url === '/early-save' ? '<head><title>迟到的网页标题</title></head>'
    : '<head></head>'
  const finish = () => { response.end(body); titleResponses.push(request.url) }
  if (request.url === '/delayed' || request.url === '/late') setTimeout(finish, 1200)
  else if (request.url === '/early-save') setTimeout(finish, 2000)
  else finish()
})
await new Promise((resolve) => titleServer.listen(0, '127.0.0.1', resolve))
titleServer.unref()
const titleOrigin = `http://127.0.0.1:${titleServer.address().port}`
const options = {
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-sandbox', '--enable-unsafe-extension-debugging'],
  viewport: { width: 1440, height: 1000 },
}
let context = await chromium.launchPersistentContext(profile, options)
function watch(page) {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' && /Content Security Policy|Refused to|Uncaught/.test(message.text())) errors.push(message.text()) })
  page.on('request', (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
}
context.on('page', watch)
const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
const id = new URL(worker.url()).host
const url = `chrome-extension://${id}/index.html`
const page = await context.newPage()
watch(page)
const rpc = (page, method, ...args) => page.evaluate(async ({ method, args }) => {
  const response = await chrome.runtime.sendMessage({ type: '77bookmarks:data', method, args })
  if (!response?.ok) throw new Error(response?.error ?? 'No response from local service')
  return response.value
}, { method, args })
try {
  await page.goto(url)
  await expect(page.getByRole('button', { name: '当前桌面：主桌面' })).toBeVisible()
  await expect(page.getByText('加载失败')).toHaveCount(0)
  console.log('✓ Packaged extension loads under Manifest V3 CSP')

  // UI creation, another new-tab page and persistent local data, all while offline.
  await context.setOffline(true)
  await page.getByRole('button', { name: '添加书签', exact: true }).click()
  await page.getByLabel('网址', { exact: true }).fill('https://example.com/docs?utm_source=test')
  await page.getByRole('dialog').getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /example.com/ }).first()).toBeVisible()
  await page.getByRole('textbox', { name: '添加待办', exact: true }).fill('离线保存的待办')
  await page.getByRole('textbox', { name: '添加待办', exact: true }).press('Enter')
  await expect(page.getByText('离线保存的待办', { exact: true })).toBeVisible()

  const second = await context.newPage()
  watch(second)
  await second.goto('chrome://newtab/')
  await expect(second.getByRole('button', { name: '当前桌面：主桌面' })).toBeVisible()
  await expect(second.getByText('离线保存的待办', { exact: true })).toBeVisible()
  const board = await rpc(page, 'board', 0)
  const desktopId = board.desktop.id
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => rpc(i % 2 ? page : second, 'addBookmark', 'https://concurrent.example.com/article', desktopId)))
  expect(results.filter((r) => r.result === 'site_created')).toHaveLength(1)
  await expect(page.getByRole('link', { name: /concurrent.example.com/ }).first()).toBeVisible()
  await expect(second.getByRole('link', { name: /concurrent.example.com/ }).first()).toBeVisible()
  await rpc(second, 'addTodo', '另一个标签页添加')
  await expect(page.getByText('另一个标签页添加', { exact: true })).toBeVisible()
  console.log('✓ Offline UI, new-tab override, concurrent writes and updates across tabs')

  // Genuine toolbar popup reads and writes the same local database.
  const webPage = await context.newPage()
  await context.setOffline(false)

  const openChildUrl = async (path) => {
    await page.getByRole('button', { name: '添加书签', exact: true }).click()
    await page.getByLabel('网址', { exact: true }).click()
    await page.getByLabel('网址', { exact: true }).fill(`${titleOrigin}${path}`)
  }
  const saveChildUrl = async () => {
    await page.getByRole('dialog').getByRole('button', { name: '添加', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 1500 })
    return (await rpc(page, 'board')).desktop.groups.flatMap((g) => g.sites).find((s) => s.origin === titleOrigin)
  }
  const nameInput = page.getByLabel('子链接名称', { exact: true })
  // Pasting alone must never open a native permission prompt or block saving.
  await openChildUrl('/needs-permission')
  await expect(page.getByRole('button', { name: '读取网页标题', exact: true })).toBeVisible()
  await expect(nameInput).toHaveValue('needs-permission')
  expect(titleRequests).toEqual([])
  await saveChildUrl()

  // Grant the fixture site using Chrome's extension settings, avoiding a native prompt in headless mode.
  const extensionsPage = await context.newPage()
  await extensionsPage.goto('chrome://extensions/')
  await extensionsPage.evaluate(({ id, origin }) => chrome.developerPrivate.addHostPermission(id, `${origin}/*`), { id, origin: titleOrigin })
  await extensionsPage.close()

  await openChildUrl('/docs')
  // Complete the first optional permission request from the explicit button gesture.
  await page.getByRole('button', { name: '读取网页标题', exact: true }).click()
  await expect(nameInput).toHaveValue('中文 & 标题测试')
  // A preview does not write a bookmark until the user clicks Add.
  expect((await rpc(page, 'board')).desktop.groups.flatMap((g) => g.sites).find((s) => s.origin === titleOrigin).links.some((l) => l.path === '/docs')).toBe(false)
  await mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/add-bookmark-title.png' })
  const titledSite = await saveChildUrl()
  expect(titledSite.title).toBe(titleOrigin.replace('http://', ''))
  const titledLink = titledSite.links.find((l) => l.path === '/docs')
  expect(titledLink.title).toBe('中文 & 标题测试')
  expect(titleRequests).toEqual(['/docs'])
  await rpc(page, 'renameLink', titledLink.id, '手动修改的名称')
  await openChildUrl('/docs')
  await expect(nameInput).toHaveCount(0)
  expect((await saveChildUrl()).links.find((l) => l.path === '/docs').title).toBe('手动修改的名称')
  expect(titleRequests).toEqual(['/docs'])

  await openChildUrl('/no-title')
  await expect(page.getByText('未能读取网页标题，已使用路径末段，名称可修改。', { exact: true })).toBeVisible()
  await expect(nameInput).toHaveValue('no-title')
  await nameInput.fill('手动填写的名称')
  expect((await saveChildUrl()).links.find((l) => l.path === '/no-title').title).toBe('手动填写的名称')

  await openChildUrl('/slow')
  await expect(page.getByText('未能读取网页标题，已使用路径末段，名称可修改。', { exact: true })).toBeVisible()
  const slowSite = await saveChildUrl()
  expect(slowSite.links.find((l) => l.path === '/slow').title).toBe('slow')

  await openChildUrl('/delayed')
  await expect.poll(() => titleRequests.includes('/delayed')).toBe(true)
  await nameInput.fill('抓取期间手动填写')
  await expect(page.getByText('已读取网页标题，保留你填写的名称。', { exact: true })).toBeVisible()
  await expect(nameInput).toHaveValue('抓取期间手动填写')
  expect((await saveChildUrl()).links.find((l) => l.path === '/delayed').title).toBe('抓取期间手动填写')

  await openChildUrl('/late')
  await expect.poll(() => titleRequests.includes('/late')).toBe(true)
  await page.getByLabel('网址', { exact: true }).fill(`${titleOrigin}/other`)
  await expect(nameInput).toHaveValue('切换后的标题')
  await expect.poll(() => titleResponses.includes('/late')).toBe(true)
  await expect(nameInput).toHaveValue('切换后的标题')
  const switchedSite = await saveChildUrl()
  expect(switchedSite.links.find((l) => l.path === '/other').title).toBe('切换后的标题')
  expect(switchedSite.links.some((l) => l.path === '/late')).toBe(false)

  await openChildUrl('/early-save')
  await expect.poll(() => titleRequests.includes('/early-save')).toBe(true)
  expect((await saveChildUrl()).links.find((l) => l.path === '/early-save').title).toBe('early-save')
  await expect.poll(() => titleResponses.includes('/early-save')).toBe(true)
  expect((await rpc(page, 'board')).desktop.groups.flatMap((g) => g.sites).find((s) => s.origin === titleOrigin).links.find((l) => l.path === '/early-save').title).toBe('early-save')
  console.log('✓ Title preview, editable fallbacks, manual names, stale responses and saving during lookup')

  await webPage.route('https://saved.example.com/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><title>收藏页面标题</title><h1>测试页面</h1>' }))
  await webPage.goto('https://saved.example.com/guide')
  await webPage.bringToFront()
  const browserCdp = await context.browser().newBrowserCDPSession()
  const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })
  const tabTarget = targetInfos.find((t) => t.url === webPage.url())
  if (!tabTarget) throw new Error('Could not find active browser tab target')
  await browserCdp.send('Extensions.triggerAction', { id, targetId: tabTarget.targetId })
  // The real action grants activeTab without requesting permanent access to all websites.
  const popup = await context.newPage()
  watch(popup)
  await popup.goto(`chrome-extension://${id}/extension/popup.html`)
  await webPage.bringToFront()
  await popup.reload()
  await expect(popup.locator('#desktop')).toContainText('主桌面')
  await expect(popup.locator('#page-title')).toContainText('收藏页面标题')
  await popup.getByRole('button', { name: '添加到书签页' }).click()
  await expect(popup.locator('#status')).toContainText('已添加')
  await expect(page.getByRole('link', { name: /saved.example.com/ }).first()).toBeVisible()
  expect((await rpc(page, 'board')).desktop.groups.flatMap((g) => g.sites).find((s) => s.origin === 'https://saved.example.com').links[0].title).toBe('收藏页面标题')
  await popup.close()
  await webPage.close()
  await context.setOffline(true)
  console.log('✓ Toolbar popup saves active-page metadata into the local board')

  await rpc(page, 'updateSettings', { siteName: '本地书签测试', openInNewTab: false, layoutColumns: 2 })
  await expect(page).toHaveTitle('本地书签测试')
  await expect(second).toHaveTitle('本地书签测试')
  await page.getByRole('button', { name: '更多', exact: true }).click()
  await expect(page.getByRole('button', { name: '退出登录' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '锁定', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  const autoSort = page.getByRole('checkbox', { name: '通过使用统计自动排序', exact: true })
  await expect(autoSort).not.toBeChecked()
  await rpc(page, 'createGroup', desktopId, '自动排序测试')
  const usageGroup = (await rpc(page, 'board')).desktop.groups.find((g) => g.name === '自动排序测试')
  const usageA = await rpc(page, 'addBookmark', 'https://usage-a.example.com', desktopId, usageGroup.id)
  const usageB = await rpc(page, 'addBookmark', 'https://usage-b.example.com/docs', desktopId, usageGroup.id)
  const usageLink = (await rpc(page, 'board')).desktop.groups.find((g) => g.id === usageGroup.id).sites.find((s) => s.id === usageB.siteId).links[0]
  await rpc(page, 'recordClick', { linkId: usageLink.id })
  const usageCards = (tab) => tab.locator('a[href="https://usage-a.example.com"], a[href="https://usage-b.example.com"]')
  await expect(usageCards(page).first()).toHaveAttribute('href', 'https://usage-a.example.com')
  await autoSort.check()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(usageCards(page).first()).toHaveAttribute('href', 'https://usage-b.example.com')
  await expect(usageCards(second).first()).toHaveAttribute('href', 'https://usage-b.example.com')
  await page.reload()
  await expect(usageCards(page).first()).toHaveAttribute('href', 'https://usage-b.example.com')
  await page.getByRole('button', { name: '更多', exact: true }).click()
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  await expect(autoSort).toBeChecked()
  await autoSort.uncheck()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect.poll(() => rpc(page, 'settings').then((s) => s.autoSortByUsage)).toBe(false)
  await page.keyboard.press('Escape')
  await rpc(page, 'recordClick', { siteId: usageA.siteId })
  await rpc(page, 'recordClick', { siteId: usageA.siteId })
  await expect(usageCards(page).first()).toHaveAttribute('href', 'https://usage-b.example.com')
  await page.reload()
  await expect(usageCards(page).first()).toHaveAttribute('href', 'https://usage-b.example.com')
  await rpc(page, 'deleteGroup', usageGroup.id)
  console.log('✓ Usage sorting setting, link counts, cross-tab updates and retained order after disabling and reload')

  await page.getByRole('button', { name: '更多', exact: true }).click()
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  await page.getByRole('tab', { name: '备份与恢复' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出完整备份' }).click()
  const download = await downloadPromise
  await mkdir('artifacts', { recursive: true })
  const backupPath = resolve('artifacts/extension-full-backup.json')
  await download.saveAs(backupPath)
  const { readFile } = await import('node:fs/promises')
  const backup = JSON.parse(await readFile(backupPath, 'utf8'))
  expect(backup.version).toBe(3)
  expect(backup.local.settings.siteName).toBe('本地书签测试')
  expect(backup.local.todos).toHaveLength(2)
  await rpc(second, 'addTodo', '恢复后应消失')
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles(backupPath)
  await page.getByRole('radio', { name: /替换全部数据/ }).click()
  await page.getByRole('button', { name: '替换并导入', exact: true }).click()
  await page.getByRole('button', { name: '替换现有数据', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await rpc(page, 'todos')).map((t) => t.text)).not.toContain('恢复后应消失')
  await expect(second.getByText('恢复后应消失', { exact: true })).toHaveCount(0)
  console.log('✓ Full-backup download and UI restore, including to-dos and settings')

  // Import a real Netscape HTML file through the existing UI.
  await page.getByRole('button', { name: '更多', exact: true }).click()
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  await page.getByRole('tab', { name: '备份与恢复' }).click()
  const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>资料</H3><DL><DT><A HREF="https://import.example.com/docs">导入文档</A></DL></DL>'
  await page.locator('input[type=file][accept=".html,.htm,text/html"]').setInputFiles({ name: 'bookmarks.html', mimeType: 'text/html', buffer: Buffer.from(html) })
  await page.getByRole('button', { name: '导入为新桌面', exact: true }).click()
  await expect(page.getByRole('button', { name: '当前桌面：Chrome 书签' })).toBeVisible()
  await expect(page.getByRole('link', { name: /import.example.com/ }).first()).toBeVisible()
  console.log('✓ Chrome HTML import through the settings UI')

  // Restart the MV3 worker and verify that a fresh request reopens IndexedDB.
  const cdp = await context.newCDPSession(page)
  const versions = []
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: update }) => versions.push(...update))
  await cdp.send('ServiceWorker.enable')
  await expect.poll(() => versions.find((v) => v.scriptURL === worker.url() && v.runningStatus === 'running')?.versionId).toBeTruthy()
  const version = versions.findLast((v) => v.scriptURL === worker.url() && v.runningStatus === 'running')
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId })
  expect((await rpc(page, 'todos')).length).toBe(2)
  console.log('✓ Service-worker stop and restart preserves local data')

  await page.screenshot({ path: 'artifacts/extension-newtab.png', fullPage: true })
  expect(errors).toEqual([])
  // Page navigation is fulfilled by Playwright; worker title requests go only to the local fixture server.
  expect(requests.filter((u) => !u.startsWith('https://saved.example.com/'))).toEqual([])
  await context.close()
  context = await chromium.launchPersistentContext(profile, options)
  const reopened = await context.newPage()
  watch(reopened)
  await reopened.goto(url)
  await expect(reopened).toHaveTitle('本地书签测试')
  expect((await rpc(reopened, 'todos')).length).toBe(2)
  expect((await rpc(reopened, 'board')).desktops.length).toBe(2)
  expect(errors).toEqual([])
  console.log('✓ Browser restart preserves bookmarks, to-dos and settings')
  console.log('All extension smoke checks passed. Artifacts: artifacts/')
} catch (error) {
  console.error('Browser errors:', errors)
  console.error('Database board:', JSON.stringify(await rpc(page, 'board').catch(() => null)))
  console.error('Page text:', await page.locator('body').innerText().catch(() => 'unavailable'))
  throw error
} finally {
  await context.close()
  titleServer.closeAllConnections()
  await new Promise((resolve) => titleServer.close(resolve))
}
