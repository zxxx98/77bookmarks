import { createReadStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import { openSqliteStore } from './sqlite'

/** Full backups carry every stored icon, so requests may be far larger than a bookmark */
const MAX_BODY_BYTES = 32 * 1024 * 1024
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json',
}
const SECURITY = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' }

const here = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT) || 8080
const dataDir = resolve(process.env.DATA_DIR ?? './data')
const staticDir = resolve(process.env.STATIC_DIR ?? join(here, 'public'))
const password = process.env.ADMIN_PASSWORD ?? ''
/** Only a reverse proxy in front may say who the client is and whether it used HTTPS */
const trustProxy = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? '')

if (password.length < 8) {
  console.error('请设置 ADMIN_PASSWORD 环境变量（至少 8 个字符）后再启动。')
  process.exit(1)
}

await mkdir(dataDir, { recursive: true })
const store = await openSqliteStore(join(dataDir, '77bookmarks.sqlite'))
const app = await createApp({ store, password })

async function readBody(request: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).byteLength
    if (size > MAX_BODY_BYTES) return null
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function api(request: IncomingMessage, response: ServerResponse) {
  const forwarded = (name: string) => (trustProxy ? String(request.headers[name] ?? '').split(',')[0].trim() : '')
  const secure = forwarded('x-forwarded-proto') === 'https'
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const payload = hasBody ? await readBody(request) : undefined
  if (payload === null) {
    response.writeHead(413, { 'content-type': 'application/json', ...SECURITY }).end(JSON.stringify({ error: '请求内容过大' }))
    return
  }
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  const result = await app.handle(
    new Request(`http://${request.headers.host ?? 'localhost'}${request.url}`, { method: request.method, headers, body: payload?.length ? new Uint8Array(payload) : undefined }),
    { client: forwarded('x-forwarded-for') || request.socket.remoteAddress || 'unknown', secure },
  )
  response.writeHead(result.status, { ...Object.fromEntries(result.headers), ...SECURITY })
  if (!result.body) { response.end(); return }
  const stream = Readable.fromWeb(result.body as import('node:stream/web').ReadableStream)
  // A closed tab must release its event stream
  response.on('close', () => stream.destroy())
  stream.pipe(response)
}

async function page(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, SECURITY).end(); return }
  let pathname: string
  try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname) } catch { pathname = '/' }
  let file = normalize(join(staticDir, pathname))
  // The app is a single page: anything that is not a file inside the folder is the page itself
  const inside = file === staticDir || file.startsWith(staticDir + sep)
  const found = inside ? await stat(file).catch(() => null) : null
  if (!found?.isFile()) {
    if (pathname.startsWith('/assets/')) { response.writeHead(404, SECURITY).end(); return }
    file = join(staticDir, 'index.html')
  }
  const info = await stat(file).catch(() => null)
  if (!info) { response.writeHead(404, SECURITY).end('界面文件缺失'); return }
  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': info.size,
    // Built assets carry a content hash in their name; the page itself must always be fresh
    'cache-control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SECURITY,
  })
  if (request.method === 'HEAD') response.end()
  else createReadStream(file).pipe(response)
}

const server = createServer((request, response) => {
  const run = request.url?.startsWith('/api/') ? api : page
  run(request, response).catch((error) => {
    console.error(error)
    if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json', ...SECURITY })
    response.end(JSON.stringify({ error: '服务器出错，请稍后重试' }))
  })
})
server.listen(port, '0.0.0.0', () => console.log(`77 Bookmarks 已启动：http://0.0.0.0:${port}（数据目录 ${dataDir}）`))

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close()
    server.close(() => { store.destroy(); process.exit(0) })
    // Open event streams would otherwise hold the server open
    server.closeAllConnections()
  })
}
