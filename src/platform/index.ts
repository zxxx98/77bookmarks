import { extensionPlatform } from './extension'
import { selfhostPlatform } from './selfhost'
import type { Platform } from './types'

export type { Platform } from './types'

/**
 * The adapter is chosen when the app is built: `VITE_TARGET=selfhost` produces the edition
 * that talks to the server in `server/`, anything else the browser extension. The constant
 * is replaced at build time, so the other adapter is left out of the bundle.
 */
export const platform: Platform = import.meta.env.VITE_TARGET === 'selfhost' ? selfhostPlatform : extensionPlatform
