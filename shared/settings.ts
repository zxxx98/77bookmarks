export const DEFAULT_SITE_NAME = '77 Bookmarks'
export const MAX_SITE_NAME_LENGTH = 60

export interface SystemSettings {
  siteName: string
  openInNewTab: boolean
}

export const DEFAULT_SETTINGS: SystemSettings = {
  siteName: DEFAULT_SITE_NAME,
  openInNewTab: true,
}
