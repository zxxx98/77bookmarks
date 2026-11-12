import { clipperRpc, parseConnectionCode, type ClipperConnection } from './client'

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const siteTitle = el('site-title')
const connectForm = el<HTMLFormElement>('connect-form')
const codeInput = el<HTMLInputElement>('code')
const connectBtn = el<HTMLButtonElement>('connect-btn')
const connectedSection = el('connected-section')
const connectedOrigin = el('connected-origin')
const disconnectBtn = el<HTMLButtonElement>('disconnect-btn')
const targetSection = el('target-section')
const desktopSelect = el<HTMLSelectElement>('desktop')
const groupSelect = el<HTMLSelectElement>('group')
const status = el('status')

let currentConnection: ClipperConnection | null = null
let revision = 0

function say(message: string, failed = false) {
  status.textContent = message
  status.className = failed ? 'status error' : 'status'
}

function fill(select: HTMLSelectElement, items: { id: number; name: string }[], selected?: number) {
  select.replaceChildren(...items.map((item) => new Option(item.name, String(item.id), false, item.id === selected)))
}

async function saveTarget() {
  await chrome.storage.local.set({
    desktopId: Number(desktopSelect.value) || 0,
    groupId: Number(groupSelect.value) || undefined,
  })
}

async function loadBoard(connection: ClipperConnection, desktopId = 0, groupId?: number) {
  const current = ++revision
  const [page, settings] = await Promise.all([
    clipperRpc(connection, 'board', desktopId),
    clipperRpc(connection, 'settings'),
  ])
  if (current !== revision) return
  siteTitle.textContent = `${settings.siteName} 右键添加`
  fill(desktopSelect, page.desktops, page.desktop.id)
  fill(groupSelect, page.desktop.groups.length ? page.desktop.groups : [{ id: 0, name: '默认' }], groupId)
  await saveTarget()
}

function showConnected(connection: ClipperConnection | null) {
  currentConnection = connection
  connectedOrigin.textContent = connection?.origin ?? ''
  connectedSection.classList.toggle('hidden', !connection)
  targetSection.classList.toggle('hidden', !connection)
  if (!connection) siteTitle.textContent = '77 Bookmarks 右键添加'
}

async function main() {
  const stored = await chrome.storage.local.get(['serverOrigin', 'token', 'desktopId', 'groupId'])
  const origin = typeof stored.serverOrigin === 'string' ? stored.serverOrigin : ''
  const token = typeof stored.token === 'string' ? stored.token : ''
  if (origin && token) {
    const connection = { origin, token }
    showConnected(connection)
    try {
      await loadBoard(connection, Number(stored.desktopId) || 0, Number(stored.groupId) || undefined)
    } catch (error) {
      say(error instanceof Error ? error.message : '加载服务器信息失败', true)
    }
  }

  connectForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const parsed = parseConnectionCode(codeInput.value)
    if (!parsed) {
      say('连接码格式不对，请从自部署版的「设置 → 浏览器插件」复制完整连接码', true)
      return
    }
    connectBtn.disabled = true
    say('正在连接…')
    try {
      const granted = await chrome.permissions.request({ origins: [`${parsed.origin}/*`] })
      if (!granted) throw new Error('需要授权访问该服务器地址才能连接')
      await loadBoard(parsed, 0, undefined)
      await chrome.storage.local.set({ serverOrigin: parsed.origin, token: parsed.token })
      showConnected(parsed)
      codeInput.value = ''
      say('连接成功，现在可以在任意网页或链接上右键添加了')
    } catch (error) {
      say(error instanceof Error ? error.message : '连接失败', true)
    } finally {
      connectBtn.disabled = false
    }
  })

  disconnectBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove(['serverOrigin', 'token', 'desktopId', 'groupId'])
    showConnected(null)
    say('已断开连接')
  })

  desktopSelect.addEventListener('change', () => {
    if (!currentConnection) return
    void loadBoard(currentConnection, Number(desktopSelect.value))
      .then(() => say('已更新默认保存位置'))
      .catch((error) => say(error instanceof Error ? error.message : '加载失败', true))
  })

  groupSelect.addEventListener('change', () => {
    void saveTarget().then(() => say('已更新默认保存位置'))
  })
}

void main()
