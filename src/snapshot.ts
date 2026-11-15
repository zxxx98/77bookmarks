import type { BoardPage, Todo } from '../shared/types'
import { platform } from './platform'
import { privateSpace } from './private/session'

const KEY = 'board-snapshot'
const SWITCH_KEY = 'offline-snapshot'
const VERSION = 1
/** As long as a session lasts: past that the server would ask for the password anyway */
export const SNAPSHOT_MAX_AGE = 30 * 24 * 60 * 60 * 1000

export interface Snapshot {
  version: number
  savedAt: number
  /** The pages last shown, by desktop id */
  boards: Record<string, BoardPage>
  todos?: Todo[]
}

const isPage = (value: unknown): value is BoardPage => {
  const page = value as BoardPage | null
  return !!page && typeof page === 'object' && Array.isArray(page.desktops) && typeof page.desktop?.id === 'number' && Array.isArray(page.desktop.groups)
}

/** Anything that is not a snapshot this version wrote, or is too old to trust, counts as none */
export function parseSnapshot(raw: string | null, now: number): Snapshot | null {
  try {
    const value = JSON.parse(raw ?? 'null') as Snapshot | null
    if (!value || value.version !== VERSION || typeof value.savedAt !== 'number' || now - value.savedAt > SNAPSHOT_MAX_AGE) return null
    if (!value.boards || typeof value.boards !== 'object' || !Object.values(value.boards).every(isPage)) return null
    return { version: VERSION, savedAt: value.savedAt, boards: value.boards, ...(Array.isArray(value.todos) ? { todos: value.todos } : {}) }
  } catch {
    return null
  }
}

/** Adds a page; its list of desktops is the latest, so pages of desktops that are gone are dropped */
export function withBoard(snapshot: Snapshot | null, page: BoardPage, now: number): Snapshot {
  const ids = new Set(page.desktops.map((desktop) => String(desktop.id)))
  const boards = Object.fromEntries(Object.entries(snapshot?.boards ?? {}).filter(([id]) => ids.has(id)))
  boards[String(page.desktop.id)] = page
  return { version: VERSION, savedAt: now, boards, ...(snapshot?.todos ? { todos: snapshot.todos } : {}) }
}

/** The page of a desktop; 0 asks for the first desktop, as it does on the server */
export function boardOf(snapshot: Snapshot | null, desktopId: number): BoardPage | undefined {
  if (!snapshot) return undefined
  if (desktopId) return snapshot.boards[String(desktopId)]
  const pages = Object.values(snapshot.boards)
  const first = pages[0]?.desktops[0]?.id
  return pages.find((page) => page.desktop.id === first)
}

let cached: Snapshot | null | undefined
const supported = platform.kind === 'selfhost'
const switchedOn = () => {
  try { return localStorage.getItem(SWITCH_KEY) !== 'off' } catch { return false }
}
// What a private space shows is never written down, and never mixed with what was
const usable = () => supported && switchedOn() && !privateSpace.active()

function load(): Snapshot | null {
  if (cached !== undefined) return cached
  try { cached = parseSnapshot(localStorage.getItem(KEY), Date.now()) } catch { cached = null }
  return cached
}
function store(next: Snapshot) {
  cached = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Too large for this browser: better no snapshot than one that falls behind
    try { localStorage.removeItem(KEY) } catch { /* Storage is unavailable. */ }
  }
}

/**
 * Where the data lives on a server, a slow connection would leave every visit staring at
 * a spinner. The last pages shown are kept in this browser, shown at once on the next
 * visit and replaced as soon as the server answers. Signing out removes them.
 */
export const snapshot = {
  supported,
  enabled: () => supported && switchedOn(),
  setEnabled(on: boolean) {
    try {
      if (on) localStorage.removeItem(SWITCH_KEY)
      else localStorage.setItem(SWITCH_KEY, 'off')
    } catch { /* Storage is unavailable, and then nothing is kept either. */ }
    if (!on) this.clear()
  },
  exists: () => usable() && !!load() && Object.keys(load()!.boards).length > 0,
  board: (desktopId: number) => (usable() ? boardOf(load(), desktopId) : undefined),
  todos: () => (usable() ? load()?.todos : undefined),
  saveBoard(page: BoardPage) {
    if (usable()) store(withBoard(load(), page, Date.now()))
  },
  saveTodos(todos: Todo[]) {
    const current = usable() ? load() : null
    // Without a page there is nothing to show the list beside
    if (current) store({ ...current, todos: todos.filter((todo) => todo.id > 0) })
  },
  clear() {
    cached = null
    try { localStorage.removeItem(KEY) } catch { /* Storage is unavailable. */ }
  },
}
