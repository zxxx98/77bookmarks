import { extensionPlatform } from './extension'
import type { Platform } from './types'

export type { Platform } from './types'

/**
 * The adapter is chosen when the app is built: `VITE_TARGET=selfhost` produces the edition
 * that talks to the server in `server/`, anything else the browser extension.
 */
export const platform: Platform = extensionPlatform
