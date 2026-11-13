import { platform } from '../platform'

/** Carries the address to the dialog that explains why it could not be opened privately */
export const INCOGNITO_UNAVAILABLE = '77bookmarks:incognito-unavailable'

/**
 * Opens an address from a private space: in an incognito window where the platform can open
 * one, and otherwise not at all, leaving the choice to the user.
 */
export async function openInIncognito(url: string): Promise<void> {
  const opened = await platform.incognito?.open(url).catch(() => false)
  if (!opened) window.dispatchEvent(new CustomEvent(INCOGNITO_UNAVAILABLE, { detail: url }))
}
