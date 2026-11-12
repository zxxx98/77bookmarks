import { hydratePreferences } from './preferences'

// Appearance stores initialize when main is imported, after Chrome preferences have hydrated.
void hydratePreferences().catch(() => undefined).then(() => import('./main'))
