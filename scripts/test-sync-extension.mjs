import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const temporary = await mkdtemp(join(tmpdir(), '77bookmarks-sync-'))
const token = randomBytes(32).toString('hex')
const contexts = []
let backend
let backendLog = ''
let davBody = null
let davVersion = 0
const dav = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match, If-None-Match')
  response.setHeader('Access-Control-Expose-Headers', 'ETag')
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
  if (request.headers.authorization !== `Basic ${Buffer.from('sync:test-password').toString('base64')}`) { response.writeHead(401).end(); return }
  const etag = `"dav-${davVersion}"`
  if (request.method === 'GET') {
    if (!davBody) { response.writeHead(404).end(); return }
    response.setHeader('ETag', etag)
    response.setHeader('Content-Type', 'application/json')
    response.end(davBody)
    return
  }
  if (request.method !== 'PUT') { response.writeHead(405).end(); return }
  if ((request.headers['if-none-match'] === '*' && davBody) || (request.headers['if-match'] && request.headers['if-match'] !== etag)) { response.writeHead(412).end(); return }
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => { davBody = body; davVersion++; response.setHeader('ETag', `"dav-${davVersion}"`); response.writeHead(204).end() })
})
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function rpc(page, type, method, ...args) {
  return page.evaluate(async ({ type, method, args }) => {
    const response = await chrome.runtime.sendMessage({ type: `77bookmarks:${type}`, method, args })
    if (!response?.ok) throw new Error(response?.error ?? 'RPC failed')
    return response.value
  }, { type, method, args })
}
const data = (page, method, ...args) => rpc(page, 'data', method, ...args)
const sync = (page, method, ...args) => rpc(page, 'sync', method, ...args)
const origins = async (page) => (await data(page, 'board')).desktop.groups.flatMap((group) => group.sites.map((site) => site.origin)).sort()
async function device(name) {
  const extension = resolve('dist-extension')
  const context = await chromium.launchPersistentContext(join(temporary, name), {
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'],
    viewport: { width: 1440, height: 1000 },
  })
  contexts.push(context)
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`)
  await expect(page.getByRole('button', { name: '当前桌面：主桌面' })).toBeVisible()
  expect((await sync(page, 'status')).config.enabled).toBe(false)
  return { context, page }
}
try {
  await listen(dav)
  // Reserve a free port, then release it for Wrangler's local Worker runtime.
  const reservation = createServer()
  await listen(reservation)
  const workerPort = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const endpoint = `http://127.0.0.1:${workerPort}`
  backend = spawn('npm', ['run', 'dev', '--prefix', 'sync-worker', '--', '--ip', '127.0.0.1', '--port', String(workerPort), '--persist-to', join(temporary, 'd1')], {
    env: { ...process.env, SYNC_TOKEN: token, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  backend.stdout.on('data', (chunk) => { backendLog += chunk })
  backend.stderr.on('data', (chunk) => { backendLog += chunk })
  await expect.poll(async () => {
    try { return (await fetch(`${endpoint}/v1/snapshot`, { headers: { authorization: `Bearer ${token}` } })).status } catch { return 0 }
  }, { timeout: 30_000 }).toBe(404)

  const a = await device('device-a')
  const b = await device('device-b')
  await data(a.page, 'addBookmark', 'https://shared.example.com/docs')
  await data(a.page, 'addTodo', '同步待办')
  // Exercise the actual settings UI, including the initial upload on Save.
  await a.page.getByRole('button', { name: '更多', exact: true }).click()
  await a.page.getByRole('button', { name: '系统设置', exact: true }).click()
  await a.page.getByRole('tab', { name: '云同步', exact: true }).click()
  await a.page.getByLabel('Worker 地址', { exact: true }).fill(endpoint)
  await a.page.getByLabel('同步令牌', { exact: true }).fill(token)
  await a.page.getByLabel('启用云同步', { exact: true }).check()
  await a.page.getByRole('tabpanel', { name: '云同步' }).getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => (await sync(a.page, 'status')).state.lastSyncAt).toBeTruthy()
  const config = (await sync(a.page, 'status')).config
  await sync(b.page, 'configure', config)
  await sync(b.page, 'now')
  expect(await origins(b.page)).toEqual(['https://shared.example.com'])
  await expect(b.page.getByText('同步待办', { exact: true })).toBeVisible()
  console.log('✓ Real extension settings configure Worker + local D1; a second browser profile receives data')

  await Promise.all([a.context.setOffline(true), b.context.setOffline(true)])
  await data(a.page, 'addBookmark', 'https://offline-a.example.com')
  await data(b.page, 'addBookmark', 'https://offline-b.example.com')
  await data(a.page, 'addBookmark', 'https://same.example.com')
  await data(b.page, 'addBookmark', 'https://same.example.com')
  await expect(sync(a.page, 'now')).rejects.toThrow()
  expect(await origins(a.page)).toContain('https://offline-a.example.com')
  await Promise.all([a.context.setOffline(false), b.context.setOffline(false)])
  await sync(a.page, 'now')
  await sync(b.page, 'now')
  await sync(a.page, 'now')
  expect(await origins(a.page)).toEqual(await origins(b.page))
  expect(await origins(a.page)).toHaveLength(4)
  const site = (await data(a.page, 'board')).desktop.groups.flatMap((group) => group.sites).find((site) => site.origin === 'https://same.example.com')
  await data(a.page, 'deleteSite', site.id)
  await sync(a.page, 'now')
  await sync(b.page, 'now')
  expect(await origins(b.page)).not.toContain('https://same.example.com')
  console.log('✓ Offline edits, same-site deduplication, network recovery and deletion converge between browser profiles')

  const davConfig = { enabled: true, kind: 'webdav', endpoint: `http://127.0.0.1:${dav.address().port}/bookmarks/`, username: 'sync', password: 'test-password', token: '' }
  await sync(a.page, 'configure', davConfig)
  await sync(a.page, 'now')
  await sync(b.page, 'configure', davConfig)
  await data(b.page, 'addTodo', 'WebDAV 待办')
  await sync(b.page, 'now')
  await sync(a.page, 'now')
  expect((await data(a.page, 'todos')).map((todo) => todo.text)).toContain('WebDAV 待办')
  expect(davVersion).toBeGreaterThan(1)
  const callsBefore = davVersion
  await sync(a.page, 'configure', { enabled: false })
  expect(await sync(a.page, 'now', false)).toEqual({ status: 'disabled' })
  expect(davVersion).toBe(callsBefore)
  expect(JSON.stringify(JSON.parse(davBody).snapshot)).not.toContain(token)
  console.log('✓ WebDAV conditional writes and switching providers work in the extension; disabling stops sync')
} catch (error) {
  if (backend?.exitCode !== null) console.error(backendLog)
  throw error
} finally {
  for (const context of contexts) await context.close()
  if (backend?.pid) { try { process.kill(-backend.pid, 'SIGTERM') } catch {} }
  await new Promise((resolve) => dav.close(resolve))
  await sleep(100)
  await rm(temporary, { recursive: true, force: true })
}
