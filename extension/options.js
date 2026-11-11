/** Options page: connect the extension to a bookmark page with a connection code, or disconnect it */

import { clearConnection, getConnection, saveConnection } from './config.js'
import { loadBoard, loadSiteName, originPattern, parseConnection } from './lib.js'

/** @template {HTMLElement} T @param {string} id @returns {T} */
const el = (id) => /** @type {T} */ (document.getElementById(id))
/** @type {HTMLInputElement} */
const codeInput = el('code')
/** @type {HTMLButtonElement} */
const connectButton = el('connect-button')
const errorLine = el('error')

async function render() {
  const connection = await getConnection()
  el('connected').hidden = !connection
  el('connect').hidden = !!connection
  if (!connection) return
  el('site-name').textContent = connection.siteName || '书签页'
  el('server').textContent = connection.server
}

el('connect-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  errorLine.textContent = ''
  const connection = parseConnection(codeInput.value)
  if (!connection) {
    errorLine.textContent = '连接码不完整，请从书签页的「系统设置 → 浏览器扩展」重新复制。'
    return
  }
  // Has to be the first asynchronous step: the browser only shows the prompt while the click is fresh
  const granted = await chrome.permissions.request({ origins: [originPattern(connection.server)] })
  if (!granted) {
    errorLine.textContent = `需要允许访问 ${connection.server}，扩展才能把书签发给它。`
    return
  }
  connectButton.disabled = true
  try {
    // Reading the board proves both the address and the token before anything is saved
    await loadBoard(connection, undefined)
    await saveConnection({ ...connection, siteName: await loadSiteName(connection).catch(() => '') })
    codeInput.value = ''
    await render()
  } catch (error) {
    errorLine.textContent = error instanceof Error ? error.message : '连接失败'
  } finally {
    connectButton.disabled = false
  }
})

el('disconnect').addEventListener('click', async () => {
  const connection = await getConnection()
  await clearConnection()
  if (connection) await chrome.permissions.remove({ origins: [originPattern(connection.server)] }).catch(() => false)
  await render()
})

el('open').addEventListener('click', async () => {
  const connection = await getConnection()
  if (connection) void chrome.tabs.create({ url: connection.server })
})

el('shortcuts').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }))

void render()
