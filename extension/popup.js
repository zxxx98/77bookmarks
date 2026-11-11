/** Toolbar popup: pick the desktop and group, then add the page in the current tab */

import { getConnection, getTarget, saveTarget } from './config.js'
import { addBookmark, describeResult, isBookmarkable, loadBoard } from './lib.js'

/** @template {HTMLElement} T @param {string} id @returns {T} */
const el = (id) => /** @type {T} */ (document.getElementById(id))
/** @type {HTMLSelectElement} */
const desktopSelect = el('desktop')
/** @type {HTMLSelectElement} */
const groupSelect = el('group')
/** @type {HTMLButtonElement} */
const addButton = el('add')
const status = el('status')

/** @param {string} message @param {boolean} [failed] */
function say(message, failed = false) {
  status.textContent = message
  status.className = failed ? 'status error' : 'status'
}

/** @param {HTMLSelectElement} select @param {{ id: number | '', name: string }[]} items @param {number | undefined} selected */
function fill(select, items, selected) {
  select.replaceChildren(...items.map((item) => new Option(item.name, String(item.id), false, item.id === selected)))
}

const target = () => ({ desktopId: Number(desktopSelect.value) || undefined, groupId: Number(groupSelect.value) || undefined })

async function main() {
  const connection = await getConnection()
  el('go-options').addEventListener('click', () => void chrome.runtime.openOptionsPage())
  if (!connection) {
    el('setup').hidden = false
    return
  }
  if (connection.siteName) el('site-name').textContent = connection.siteName
  const openButton = el('open')
  openButton.hidden = false
  openButton.addEventListener('click', () => void chrome.tabs.create({ url: connection.server }))

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab?.url ?? ''
  el('form').hidden = false
  el('page-title').textContent = tab?.title || url || '当前页面'
  el('page-url').textContent = url
  const bookmarkable = isBookmarkable(url)
  if (!bookmarkable) say('这个页面不能添加为书签', true)
  addButton.disabled = true

  /** Lists the desktops and the groups of the chosen one @param {number | undefined} desktopId @param {number | undefined} groupId */
  const showBoard = async (desktopId, groupId) => {
    const page = await loadBoard(connection, desktopId)
    fill(desktopSelect, page.desktops, page.desktop.id)
    const groups = page.desktop.groups ?? []
    // A desktop without groups gets its first one created by the server on adding
    fill(groupSelect, groups.length ? groups : [{ id: '', name: '默认' }], groups.some((group) => group.id === groupId) ? groupId : groups[0]?.id)
    await saveTarget(target())
    addButton.disabled = !bookmarkable
  }

  const stored = await getTarget()
  try {
    await showBoard(stored.desktopId, stored.groupId)
  } catch (error) {
    say(error instanceof Error ? error.message : '加载失败', true)
    return
  }

  desktopSelect.addEventListener('change', () => {
    addButton.disabled = true
    showBoard(Number(desktopSelect.value), undefined).catch((error) => say(error.message, true))
  })
  groupSelect.addEventListener('change', () => void saveTarget(target()))

  el('form').addEventListener('submit', async (event) => {
    event.preventDefault()
    addButton.disabled = true
    say('正在添加…')
    try {
      say(describeResult(await addBookmark(connection, { url, title: tab?.title, ...target() })))
      addButton.textContent = '已添加'
    } catch (error) {
      say(error instanceof Error ? error.message : '添加失败', true)
      addButton.disabled = false
    }
  })
}

void main()
