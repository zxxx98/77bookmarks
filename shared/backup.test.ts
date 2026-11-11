import { describe, expect, it } from 'vitest'
import { backupStats, parseBackup, type ParsedBackup } from './backup'

const site = (origin: string, extra: object = {}) => ({ origin, title: 'Site', links: [], ...extra })
const v2 = (desktops: unknown[]) => ({ version: 2, exportedAt: '2026-11-10T00:00:00.000Z', desktops })

function ok(input: unknown, legacyName?: string): ParsedBackup {
  const parsed = parseBackup(input, legacyName)
  if ('error' in parsed) throw new Error(parsed.error)
  return parsed
}

describe('parseBackup', () => {
  it('reads a version 2 backup', () => {
    const parsed = ok(
      v2([
        { name: ' 工作 ', view: 'list', groups: [{ name: '开发', sites: [site('https://github.com', { links: [{ path: '/pulls', title: 'Pulls' }] })] }] },
        { name: '生活', view: 'small', groups: [] },
      ]),
    )
    expect(parsed.exportedAt).toBe('2026-11-10T00:00:00.000Z')
    expect(parsed.desktops.map((d) => [d.name, d.view])).toEqual([
      ['工作', 'list'],
      ['生活', 'small'],
    ])
    expect(parsed.desktops[0].groups[0].sites[0]).toEqual({ origin: 'https://github.com', title: 'Site', links: [{ path: '/pulls', title: 'Pulls' }] })
    expect(backupStats(parsed.desktops)).toEqual({ desktops: 2, sites: 1, links: 1 })
  })

  it('turns a version 1 backup into one desktop', () => {
    const parsed = ok({ version: 1, groups: [{ name: '默认', sites: [site('https://a.com')] }] }, '旧备份')
    expect(parsed.desktops).toHaveLength(1)
    expect(parsed.desktops[0]).toMatchObject({ name: '旧备份', view: 'large' })
    expect(parsed.desktops[0].groups[0].sites[0].origin).toBe('https://a.com')
  })

  it('falls back to large cards for an unknown view', () => {
    expect(ok(v2([{ name: 'A', view: 'huge', groups: [] }])).desktops[0].view).toBe('large')
  })

  it('keeps the same site on different desktops but drops repeats within one', () => {
    const parsed = ok(
      v2([
        {
          name: 'A',
          groups: [
            { name: 'g1', sites: [site('https://a.com'), site('https://A.com/')] },
            { name: 'g2', sites: [site('https://a.com'), site('https://b.com')] },
          ],
        },
        { name: 'B', groups: [{ name: 'g', sites: [site('https://a.com')] }] },
      ]),
    )
    expect(parsed.desktops[0].groups.map((g) => g.sites.map((s) => s.origin))).toEqual([['https://a.com'], ['https://b.com']])
    expect(parsed.desktops[1].groups[0].sites).toHaveLength(1)
  })

  it('drops repeated link paths', () => {
    const links = [
      { path: '/x', title: 'X' },
      { path: '/x', title: 'X again' },
      { path: '/y', title: 'Y' },
    ]
    const parsed = ok(v2([{ name: 'A', groups: [{ name: 'g', sites: [site('https://a.com', { links })] }] }]))
    expect(parsed.desktops[0].groups[0].sites[0].links).toEqual([
      { path: '/x', title: 'X' },
      { path: '/y', title: 'Y' },
    ])
  })

  it('keeps valid icons and leaves out broken ones', () => {
    const sites = [
      site('https://a.com', { icon: { type: 'image/png', data: 'AAAA' }, iconUrl: 'cdn.example.com/a.png' }),
      site('https://b.com', { icon: { type: 'text/html', data: 'AAAA' }, iconUrl: 'javascript:alert(1)' }),
    ]
    const [a, b] = ok(v2([{ name: 'A', groups: [{ name: 'g', sites }] }])).desktops[0].groups[0].sites
    expect(a.icon).toEqual({ type: 'image/png', data: 'AAAA' })
    expect(a.iconUrl).toBe('https://cdn.example.com/a.png')
    expect(b.icon).toBeUndefined()
    expect(b.iconUrl).toBeUndefined()
  })

  it('keeps pinned groups pinned and ignores anything but true', () => {
    const groups = [
      { name: 'a', pinned: true, sites: [] },
      { name: 'b', pinned: 'yes', sites: [] },
      { name: 'c', sites: [] },
    ]
    expect(ok(v2([{ name: 'A', groups }])).desktops[0].groups).toStrictEqual([
      { name: 'a', pinned: true, sites: [] },
      { name: 'b', sites: [] },
      { name: 'c', sites: [] },
    ])
  })

  it('rejects malformed backups', () => {
    const bad: unknown[] = [
      null,
      'text',
      [],
      {},
      { version: 3, desktops: [] },
      v2([]),
      v2([{ name: '', groups: [] }]),
      v2([{ name: 'A' }]),
      v2([{ name: 'A', groups: [{ name: 'g' }] }]),
      v2([{ name: 'A', groups: [{ name: 'g', sites: [{ origin: 'not a url', title: 'x', links: [] }] }] }]),
      v2([{ name: 'A', groups: [{ name: 'g', sites: [site('https://a.com', { links: [{ path: 'no-slash', title: 'x' }] })] }] }]),
      { version: 1, groups: 'nope' },
    ]
    for (const input of bad) expect(parseBackup(input), JSON.stringify(input)).toHaveProperty('error')
  })
})
