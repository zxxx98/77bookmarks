import { chromium, expect } from '@playwright/test'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

const extensionPath = resolve('dist-extension')
const profile = await mkdtemp(join(tmpdir(), '77bookmarks-extension-'))
const errors = []
const requests = []
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
  // The one intentional navigation is fulfilled locally by Playwright; app code makes no HTTP calls.
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
}
