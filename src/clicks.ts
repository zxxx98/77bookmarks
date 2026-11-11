import type { MouseEvent } from 'react'
import type { ClickTarget } from '../shared/types'

/** Best effort: a lost count must never get in the way of opening the bookmark */
export function recordClick(target: ClickTarget): void {
  try {
    // keepalive lets the request outlive the page when the bookmark opens in the same tab
    void fetch('/api/clicks', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target),
    }).catch(() => undefined)
  } catch { /* Counting is optional. */ }
}

/** Anchor props that count left clicks (with or without a modifier key) and middle clicks */
export function countClicks(target: ClickTarget) {
  return {
    onClick: () => recordClick(target),
    onAuxClick: (event: MouseEvent) => {
      if (event.button === 1) recordClick(target)
    },
  }
}
