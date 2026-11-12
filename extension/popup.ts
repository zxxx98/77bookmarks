import { call } from '../src/storage/client'
import { describeResult, isBookmarkable } from './lib'

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const desktopSelect = el<HTMLSelectElement>('desktop')
const groupSelect = el<HTMLSelectElement>('group')
const addButton = el<HTMLButtonElement>('add')
const status = el('status')
function say(message: string, failed = false) { status.textContent = message; status.className = failed ? 'status error' : 'status' }
function fill(select: HTMLSelectElement, items: { id: number; name: string }[], selected?: number) {
  select.replaceChildren(...items.map((item) => new Option(item.name, String(item.id), false, item.id === selected)))
}
const target = () => ({ desktopId: Number(desktopSelect.value), groupId: Number(groupSelect.value) || undefined })
const saveTarget = () => chrome.storage.local.set(target())
async function main() {
  el('open').addEventListener('click', () => void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }))
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab?.url ?? ''
  el('page-title').textContent = tab?.title || url || '当前页面'
  el('page-url').textContent = url
  const bookmarkable = isBookmarkable(url)
  if (!bookmarkable) say('这个页面不能添加为书签', true)
  addButton.disabled = true
  let revision = 0
  const showBoard = async (desktopId = 0, groupId?: number) => {
    const current = ++revision
    const page = await call('board', desktopId)
    if (current !== revision) return
    fill(desktopSelect, page.desktops, page.desktop.id)
    fill(groupSelect, page.desktop.groups.length ? page.desktop.groups : [{ id: 0, name: '默认' }], groupId)
    await saveTarget()
    addButton.disabled = !bookmarkable
  }
  const stored = await chrome.storage.local.get(['desktopId', 'groupId'])
  const settings = await call('settings')
  el('site-name').textContent = settings.siteName
  await showBoard(Number(stored.desktopId) || 0, Number(stored.groupId) || undefined)
  desktopSelect.addEventListener('change', () => {
    addButton.disabled = true
    void showBoard(Number(desktopSelect.value)).catch((e) => say(e.message, true))
  })
  groupSelect.addEventListener('change', () => void saveTarget())
  el('form').addEventListener('submit', async (event) => {
    event.preventDefault()
    addButton.disabled = true
    say('正在保存…')
    try {
      const result = await call('addBookmark', url, target().desktopId, target().groupId, tab?.title)
      say(describeResult(result))
      addButton.textContent = '已添加'
      if (result.result === 'site_created') void call('setIcon', result.siteId).catch(() => undefined)
    } catch (error) { say(error instanceof Error ? error.message : '添加失败', true); addButton.disabled = !bookmarkable }
  })
}
void main().catch((error) => say(error instanceof Error ? error.message : '加载失败', true))
