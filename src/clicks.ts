import type { MouseEvent } from 'react'
import type { ClickTarget } from '../shared/types'
import { api } from './api'
import { privateSpace } from './private/session'

/** The background worker commits the count even when this tab navigates away. */
export function recordClick(target: ClickTarget): void {
  // What is opened from a private space is not counted anywhere
  if (privateSpace.active()) return
  void api.recordClick(target).catch(() => undefined)
}
export function countClicks(target: ClickTarget) {
  return {
    onClick: () => recordClick(target),
    onAuxClick: (event: MouseEvent) => { if (event.button === 1) recordClick(target) },
  }
}
