import type { MouseEvent } from 'react'
import type { ClickTarget } from '../shared/types'
import { api } from './api'

/** The background worker commits the count even when this tab navigates away. */
export function recordClick(target: ClickTarget): void {
  void api.recordClick(target).catch(() => undefined)
}
export function countClicks(target: ClickTarget) {
  return {
    onClick: () => recordClick(target),
    onAuxClick: (event: MouseEvent) => { if (event.button === 1) recordClick(target) },
  }
}
