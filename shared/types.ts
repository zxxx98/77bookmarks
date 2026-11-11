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
  /** 0 when no icon is stored */
  iconVersion: number
  /** Custom icon address, shown instead of the stored icon */
  iconUrl: string | null
  links: Link[]
}

export interface Group {
  id: number
  name: string
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
