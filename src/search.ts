import type { ClickTarget, Group } from '../shared/types'
import { fullUrl, hostOf } from '../shared/url'

export interface SearchResult {
  groups: Group[]
  /** Ids of links that matched the query themselves */
  matchedLinks: Set<number>
  /** URL opened when Enter is pressed in the search box */
  firstUrl: string | null
  /** Intranet URL of `firstUrl` when configured on the matched card */
  firstIntranetUrl?: string | null
  /** Title of the matched card or link */
  firstTitle?: string | null
  /** The card or link behind `firstUrl` */
  firstTarget: ClickTarget | null
}

export function searchBoard(groups: Group[], query: string): SearchResult {
  const q = query.trim().toLowerCase()
  const matchedLinks = new Set<number>()
  if (!q) return { groups, matchedLinks, firstUrl: null, firstTarget: null }

  let firstUrl: string | null = null
  let firstIntranetUrl: string | null = null
  let firstTitle: string | null = null
  let firstTarget: ClickTarget | null = null
  const hit = (value: string) => value.toLowerCase().includes(q)
  const filtered = groups
    .map((group) => ({
      ...group,
      sites: group.sites.filter((site) => {
        const siteHit = hit(site.title) || hit(hostOf(site.origin)) || (!!site.description && hit(site.description)) || (!!site.intranetUrl && hit(site.intranetUrl))
        const linkHits = site.links.filter((link) => hit(link.title) || hit(link.path))
        for (const link of linkHits) matchedLinks.add(link.id)
        if (!siteHit && linkHits.length === 0) return false
        if (!firstUrl) {
          firstTarget = siteHit ? { siteId: site.id } : { linkId: linkHits[0].id }
          firstUrl = siteHit ? site.origin : fullUrl(site.origin, linkHits[0].path)
          firstIntranetUrl = site.intranetUrl ? (siteHit ? site.intranetUrl : site.intranetUrl.replace(/\/+$/, '') + linkHits[0].path) : null
          firstTitle = siteHit ? site.title : linkHits[0].title
        }
        return true
      }),
    }))
    .filter((group) => group.sites.length > 0)
  return { groups: filtered, matchedLinks, firstUrl, firstIntranetUrl, firstTitle, firstTarget }
}
