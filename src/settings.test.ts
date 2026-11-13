import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/settings'
import { readSettings, rememberSettings } from './settings'

afterEach(() => vi.unstubAllGlobals())

describe('cached display settings', () => {
  it('preserves the saved opening preference before the local store responds', () => {
    const settings = { siteName: '工作台', openInNewTab: false }
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(settings), setItem: vi.fn() })
    expect(readSettings()).toEqual({ ...settings, layoutColumns: 1, autoSortByUsage: false, defaultIntranet: true })
  })

  it('uses the cached layout before the local store responds', () => {
    const settings = { siteName: '工作台', openInNewTab: true, layoutColumns: 4 }
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(settings) })
    expect(readSettings()).toEqual({ ...settings, autoSortByUsage: false, defaultIntranet: true })
  })

  it('falls back to one column for an invalid cached layout', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ siteName: '工作台', openInNewTab: true, layoutColumns: 5 }) })
    expect(readSettings()).toEqual({ siteName: '工作台', openInNewTab: true, layoutColumns: 1, autoSortByUsage: false, defaultIntranet: true })
  })

  it.each([true, false, undefined, 'true'])('enables cached automatic sorting only for a boolean true: %s', (autoSortByUsage) => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ ...DEFAULT_SETTINGS, autoSortByUsage }) })
    expect(readSettings().autoSortByUsage).toBe(autoSortByUsage === true)
  })

  it.each([true, false, undefined])('defaults cached intranet redirect preference to true unless explicitly false: %s', (defaultIntranet) => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ ...DEFAULT_SETTINGS, defaultIntranet }) })
    expect(readSettings().defaultIntranet).toBe(defaultIntranet !== false)
  })

  it.each(['{', 'null', '{}', '{"siteName":"","openInNewTab":false}', '{"siteName":"名字","openInNewTab":"false"}'])('ignores an invalid cache: %s', (value) => {
    vi.stubGlobal('localStorage', { getItem: () => value })
    expect(readSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('continues loading and saving when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('full') },
    })
    expect(readSettings()).toEqual(DEFAULT_SETTINGS)
    expect(rememberSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
  })
})
