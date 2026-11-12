import type { AccessTokenStatus, AddResult, BoardPage, DesktopMatch, ImportMode, ImportResult, OrderInput, Todo, UsageStats, View } from '../shared/types'
import type { SystemSettings } from '../shared/settings'
import { rememberSettings } from './settings'
import type { ChromeImportRow } from './chrome-import'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function send(path: string, method = 'GET', body?: unknown): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new ApiError(response.status, data?.error ?? `请求失败（${response.status}）`)
  }
  return response
}

async function request<T = { ok: true }>(path: string, method = 'GET', body?: unknown): Promise<T> {
  return (await send(path, method, body)).json() as Promise<T>
}

export const api = {
  login: (password: string) => request('/login', 'POST', { password }),
  logout: () => request('/logout', 'POST'),
  board: (desktopId: number) => request<BoardPage>(`/board${desktopId > 0 ? `?desktop=${desktopId}` : ''}`),
  search: (query: string) => request<DesktopMatch[]>(`/search?q=${encodeURIComponent(query)}`),
  /** Click counters of every card and link, across all desktops */
  usage: () => request<UsageStats>('/usage'),
  settings: () => request<SystemSettings>('/settings').then(rememberSettings),
  updateSettings: (settings: SystemSettings) => request<SystemSettings>('/settings', 'PUT', settings).then(rememberSettings),
  addBookmark: (url: string, desktopId: number, groupId?: number) => request<AddResult>('/bookmarks', 'POST', { url, desktopId, groupId }),
  order: (order: OrderInput) => request('/order', 'PUT', order),

  /** Open to-dos from top to bottom, then the finished ones */
  todos: () => request<Todo[]>('/todos'),
  addTodo: (text: string) => request<Todo>('/todos', 'POST', { text }),
  updateTodo: (id: number, patch: { text?: string; done?: boolean }) => request(`/todos/${id}`, 'PATCH', patch),
  deleteTodo: (id: number) => request(`/todos/${id}`, 'DELETE'),
  clearDoneTodos: () => request('/todos/done', 'DELETE'),
  orderTodos: (ids: number[]) => request('/todos/order', 'PUT', { ids }),

  /** State of the access token used by the browser extension */
  tokenStatus: () => request<AccessTokenStatus | null>('/token'),
  createToken: () => request<{ token: string; createdAt: number }>('/token', 'POST'),
  revokeToken: () => request('/token', 'DELETE'),

  createDesktop: (name: string) => request<{ id: number; name: string }>('/desktops', 'POST', { name }),
  updateDesktop: (id: number, patch: { name?: string; view?: View }) => request(`/desktops/${id}`, 'PATCH', patch),
  deleteDesktop: (id: number) => request(`/desktops/${id}`, 'DELETE'),

  createGroup: (desktopId: number, name: string) => request('/groups', 'POST', { desktopId, name }),
  renameGroup: (id: number, name: string) => request(`/groups/${id}`, 'PATCH', { name }),
  pinGroup: (id: number, pinned: boolean) => request(`/groups/${id}`, 'PATCH', { pinned }),
  deleteGroup: (id: number) => request(`/groups/${id}`, 'DELETE'),

  /** `desktopId` moves the card to the first group of another desktop */
  updateSite: (id: number, patch: { title?: string; groupId?: number; desktopId?: number }) => request(`/sites/${id}`, 'PATCH', patch),
  deleteSite: (id: number) => request(`/sites/${id}`, 'DELETE'),
  /** `url` shows an image from that address, `dataUrl` stores an upload, and an empty body re-fetches the icon from the site */
  setIcon: (id: number, source: { dataUrl?: string; url?: string } = {}) =>
    request<{ ok: true; iconUrl: string | null }>(`/sites/${id}/icon`, 'POST', source),
  removeIcon: (id: number) => request(`/sites/${id}/icon`, 'DELETE'),

  renameLink: (id: number, title: string) => request(`/links/${id}`, 'PATCH', { title }),
  deleteLink: (id: number) => request(`/links/${id}`, 'DELETE'),

  /** Backup of every desktop, or of just one */
  exportBackup: async (desktopId?: number): Promise<{ blob: Blob; filename: string }> => {
    const response = await send(`/export${desktopId === undefined ? '' : `?desktop=${desktopId}`}`)
    const encoded = (response.headers.get('Content-Disposition') ?? '').match(/filename\*=UTF-8''([^;]+)/)?.[1]
    return { blob: await response.blob(), filename: encoded ? decodeURIComponent(encoded) : '77bookmarks.json' }
  },
  importBackup: (backup: unknown, mode: ImportMode) => request<ImportResult>(`/import?mode=${mode}`, 'POST', backup),
  importChromeGroups: (desktopId: number, offset: number, items: string[]) =>
    request<{ groupIds: number[] }>('/chrome-import', 'POST', { kind: 'groups', desktopId, offset, items }),
  importChromeRows: (desktopId: number, items: ChromeImportRow[]) =>
    request<{ ok: true }>('/chrome-import', 'POST', { kind: 'rows', desktopId, items }),
}
