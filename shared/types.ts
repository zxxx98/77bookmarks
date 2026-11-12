export const VIEWS = ['large', 'small', 'list'] as const
/** Card layout of a desktop */
export type View = (typeof VIEWS)[number]

export function isView(value: unknown): value is View {
  return VIEWS.includes(value as View)
}

export interface Link {
  id: number
  path: string
  title: string
}

export interface Site {
  id: number
  origin: string
  title: string
  /** 0 when no icon is stored here */
  iconVersion: number
  /** Address the browser loads the icon from, instead of one stored here */
  iconUrl: string | null
  links: Link[]
}

export interface Group {
  id: number
  name: string
  /** Pinned groups are shown before the others on their desktop */
  pinned: boolean
  sites: Site[]
}

/** An independent board with its own groups, cards and layout */
export interface Desktop {
  id: number
  name: string
  view: View
  groups: Group[]
}

export interface Board {
  desktops: Desktop[]
}

/** Navigation metadata; bookmarks are only sent for the selected desktop. */
export interface DesktopSummary extends Omit<Desktop, 'groups'> {
  groupCount: number
  siteCount: number
}

export interface BoardPage {
  desktops: DesktopSummary[]
  desktop: Desktop
}

export interface DesktopMatch {
  desktopId: number
  count: number
}

export interface AddResult {
  result: 'site_created' | 'site_exists' | 'link_added' | 'link_exists'
  siteId: number
  siteTitle: string
}

export interface OrderInput {
  desktops?: number[]
  groups?: number[]
  sites?: { groupId: number; ids: number[] }[]
}

export type ImportMode = 'append' | 'replace'

export interface ImportResult {
  ok: true
  /** Ids of the desktops created by the import, in backup order */
  desktopIds: number[]
  sites: number
  links: number
}

/** What a click opened: a card's homepage, or one of its links */
export type ClickTarget = { siteId: number } | { linkId: number }

export interface LinkUsage extends Link {
  clicks: number
  /** null until the link is first opened from the bookmark page */
  lastClickedAt: number | null
  createdAt: number
}

export interface SiteUsage extends Omit<Site, 'links'> {
  desktopId: number
  groupName: string
  /** Openings of the homepage; link clicks are counted on the links */
  clicks: number
  lastClickedAt: number | null
  createdAt: number
  links: LinkUsage[]
}

export interface UsageStats {
  /** When clicks started being counted, or null if unknown */
  since: number | null
  sites: SiteUsage[]
}

/** Where an access token stands: the token itself is only ever shown once, when it is created */
export interface AccessTokenStatus {
  createdAt: number
  lastUsedAt: number | null
}

export const MAX_TODO_LENGTH = 200

export interface Todo {
  id: number
  text: string
  /** null while open, otherwise when it was ticked off */
  doneAt: number | null
}
