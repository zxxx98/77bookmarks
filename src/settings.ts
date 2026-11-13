import { preferences } from './preferences'
import { DEFAULT_SETTINGS, isLayoutColumns, MAX_SITE_NAME_LENGTH, type SystemSettings } from '../shared/settings'

const SETTINGS_KEY = 'bookmarks-settings'

/** Only public display preferences are persisted, never bookmark data. */
export function readSettings(): SystemSettings {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')
    if (typeof value?.siteName === 'string' && value.siteName.trim() && value.siteName.length <= MAX_SITE_NAME_LENGTH && typeof value.openInNewTab === 'boolean') {
      return {
        siteName: value.siteName,
        openInNewTab: value.openInNewTab,
        layoutColumns: isLayoutColumns(value.layoutColumns) ? value.layoutColumns : 1,
        autoSortByUsage: value.autoSortByUsage === true,
        defaultIntranet: value.defaultIntranet !== false,
      }
    }
  } catch { /* Storage may be unavailable. */ }
  return DEFAULT_SETTINGS
}

export function rememberSettings(settings: SystemSettings): SystemSettings {
  try {
    preferences.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch { /* A full or unavailable storage must not prevent loading or saving. */ }
  return settings
}
