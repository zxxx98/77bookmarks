import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from './api'

/** Where the last run stopped, so that a run that was cut short continues where it left off */
const CURSOR_KEY = 'direct-icons-cursor'
/** Set once every card has been looked at, so the cards are not looked at again */
const DONE_KEY = 'direct-icons-done'

/** Only one run at a time, even when the effect runs twice */
let running: Promise<unknown> | null = null

function readCursor(): number {
  try {
    const value = Number(localStorage.getItem(CURSOR_KEY))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

function remember(cursor: number, done: boolean) {
  try {
    localStorage.setItem(CURSOR_KEY, String(cursor))
    if (done) localStorage.setItem(DONE_KEY, '1')
  } catch {
    /* A browser without storage only does the work again. */
  }
}

function isDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Cards whose icon is stored here are looked at once, so that the browser loads the address of
 * the site itself and this project is not asked for the image every time a board is shown.
 * Returns how many cards changed.
 */
export async function convertDirectIcons(): Promise<number> {
  let cursor = readCursor()
  let converted = 0
  for (;;) {
    // Another tab of this browser may have finished the work already
    if (isDone()) return converted
    const result = await api.directIcons(cursor)
    converted += result.converted
    cursor = result.nextAfter
    remember(cursor, result.done)
    if (result.done) return converted
  }
}

/** Looks at the cards in the background, once per browser */
export function useDirectIcons() {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (running || isDone()) return
    running = convertDirectIcons()
      .then((converted) => (converted > 0 ? queryClient.invalidateQueries({ queryKey: ['board'] }) : undefined))
      .catch(() => undefined)
      .finally(() => {
        running = null
      })
  }, [queryClient])
}
