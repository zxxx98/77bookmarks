import type { Group } from '../shared/types'
import { fullUrl, hostOf } from '../shared/url'

export interface SearchResult {
  groups: Group[]
  /** Ids of links that matched the query themselves */
  matchedLinks: Set<number>
  /** URL opened when Enter is pressed in the search box */
  firstUrl: string | null
}

export function searchBoard(groups: Group[], query: string): SearchResult {
  const q = query.trim().toLowerCase()
  const matchedLinks = new Set<number>()
  if (!q) return { groups, matchedLinks, firstUrl: null }

  let firstUrl: string | null = null
  const hit = (value: string) => value.toLowerCase().includes(q)
  const filtered = groups
    .map((group) => ({
      ...group,
      sites: group.sites.filter((site) => {
        const siteHit = hit(site.title) || hit(hostOf(site.origin))
        const linkHits = site.links.filter((link) => hit(link.title) || hit(link.path))
        for (const link of linkHits) matchedLinks.add(link.id)
        if (!siteHit && linkHits.length === 0) return false
        firstUrl ??= siteHit ? site.origin : fullUrl(site.origin, linkHits[0].path)
        return true
      }),
    }))
    .filter((group) => group.sites.length > 0)
  return { groups: filtered, matchedLinks, firstUrl }
}
