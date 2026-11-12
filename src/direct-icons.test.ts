// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { convertDirectIcons } from './direct-icons'

vi.mock('./api', () => ({ api: { directIcons: vi.fn() } }))

const directIcons = vi.mocked(api.directIcons)

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('moving icons to the addresses of their sites', () => {
  it('walks the cards until every one of them has been looked at', async () => {
    directIcons.mockResolvedValueOnce({ checked: 3, converted: 3, nextAfter: 3, done: false })
    directIcons.mockResolvedValueOnce({ checked: 2, converted: 2, nextAfter: 7, done: true })
    expect(await convertDirectIcons()).toBe(5)
    expect(directIcons.mock.calls.map(([after]) => after)).toEqual([0, 3])
    expect(localStorage.getItem('direct-icons-done')).toBe('1')
  })

  it('starts where the last run stopped', async () => {
    localStorage.setItem('direct-icons-cursor', '42')
    directIcons.mockResolvedValueOnce({ checked: 1, converted: 1, nextAfter: 43, done: true })
    expect(await convertDirectIcons()).toBe(1)
    expect(directIcons).toHaveBeenCalledWith(42)
  })

  it('keeps the place of a run that was cut short', async () => {
    directIcons.mockRejectedValueOnce(new Error('网络不通'))
    await expect(convertDirectIcons()).rejects.toThrow('网络不通')
    expect(localStorage.getItem('direct-icons-done')).toBeNull()
  })

  it('stops when another tab of this browser has done the work', async () => {
    localStorage.setItem('direct-icons-done', '1')
    expect(await convertDirectIcons()).toBe(0)
    expect(directIcons).not.toHaveBeenCalled()
  })
})
