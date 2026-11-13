export const DEFAULT_SITE_NAME = '77 Bookmarks'
export const MAX_SITE_NAME_LENGTH = 60
export type LayoutColumns = 1 | 2 | 3 | 4

export const isLayoutColumns = (value: unknown): value is LayoutColumns =>
  value === 1 || value === 2 || value === 3 || value === 4

export interface SystemSettings {
  siteName: string
  openInNewTab: boolean
  layoutColumns: LayoutColumns
  autoSortByUsage: boolean
  defaultIntranet?: boolean
}

export const DEFAULT_SETTINGS: SystemSettings = {
  siteName: DEFAULT_SITE_NAME,
  openInNewTab: true,
  layoutColumns: 1,
  autoSortByUsage: false,
  defaultIntranet: true,
}
