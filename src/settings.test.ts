import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../shared/settings'
import { readSettings, rememberSettings } from './settings'

afterEach(() => vi.unstubAllGlobals())

describe('cached display settings', () => {
  it('preserves the saved opening preference before the server responds', () => {
    const settings = { siteName: '工作台', openInNewTab: false }
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(settings), setItem: vi.fn() })
    expect(readSettings()).toEqual(settings)
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
