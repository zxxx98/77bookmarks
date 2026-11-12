import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { Desktop } from '../shared/types'
import { api } from './api'
import { updateBoardCache } from './board-cache'

const CONCURRENCY = 2
const DELAY_MS = 150

export function collectLazyIconCandidates(desktop: Desktop, attempted: Set<number>, inFlight: Set<number>): number[] {
  return desktop.groups
    .flatMap((group) => group.sites)
    .filter((site) => site.iconVersion === 0 && !site.iconUrl && !attempted.has(site.id) && !inFlight.has(site.id))
    .map((site) => site.id)
}

export function useLazyIcons(desktop: Desktop | undefined, enabled = true) {
  const queryClient = useQueryClient()
  const attemptedRef = useRef<Set<number>>(new Set())
  const inFlightRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!enabled || !desktop) return

    let cancelled = false
    const attempted = attemptedRef.current
    const inFlight = inFlightRef.current

    // Gather sites on the current desktop that need an icon
    const queue = collectLazyIconCandidates(desktop, attempted, inFlight)

    if (queue.length === 0) return

    const processNext = async () => {
      if (cancelled || inFlight.size >= CONCURRENCY || queue.length === 0) return

      const siteId = queue.shift()
      if (siteId === undefined || attempted.has(siteId) || inFlight.has(siteId)) return

      inFlight.add(siteId)

      try {
        const result = await api.setIcon(siteId)
        if (cancelled) return
        const stamp = Date.now()
        updateBoardCache(queryClient, (page) => {
          let modified = false
          const groups = page.desktop.groups.map((group) => {
            const sites = group.sites.map((s) => {
              if (s.id === siteId) {
                modified = true
                // An address of the site itself means no image is stored here
                return { ...s, iconVersion: result.iconUrl ? 0 : stamp, iconUrl: result.iconUrl }
              }
              return s
            })
            return { ...group, sites }
          })
          return modified ? { ...page, desktop: { ...page.desktop, groups } } : page
        })
      } catch {
        // Failed or site has no icon
        if (cancelled) return
        attempted.add(siteId)
        updateBoardCache(queryClient, (page) => {
          let modified = false
          const groups = page.desktop.groups.map((group) => {
            const sites = group.sites.map((s) => {
              if (s.id === siteId) {
                modified = true
                return { ...s, iconVersion: -1 }
              }
              return s
            })
            return { ...group, sites }
          })
          return modified ? { ...page, desktop: { ...page.desktop, groups } } : page
        })
      } finally {
        inFlight.delete(siteId)
        attempted.add(siteId)
        if (!cancelled && queue.length > 0) {
          setTimeout(processNext, DELAY_MS)
        }
      }
    }

    // Start workers up to CONCURRENCY
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
      void processNext()
    }

    return () => {
      cancelled = true
    }
  }, [desktop, enabled, queryClient])
}
