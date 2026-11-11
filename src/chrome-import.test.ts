// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { chromeRows, parseChromeBookmarks } from './chrome-import'

const header = '<!DOCTYPE NETSCAPE-Bookmark-file-1><META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8"><TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>'

describe('Chrome HTML import', () => {
  it('keeps nested folders and merges pages from one site into a single card', async () => {
    const html = `${header}<DL><p>
      <DT><H3>Bookmarks bar</H3><DL><p>
        <DT><A HREF="https://example.com/path?a=1&amp;b=2">First &amp; best</A>
        <DT><H3>Work</H3><DL><p>
          <DT><A HREF="https://example.com/">Example home</A>
          <DT><A HREF="https://github.com/pulls">Pulls</A>
        </DL><p>
      </DL><p>
      <DT><H3>Other bookmarks</H3><DL><p>
        <DT><A HREF="https://example.com/path?a=1&amp;b=2">Duplicate</A>
        <DT><A HREF="javascript:alert(1)">Invalid</A>
      </DL><p>
    </DL><p>`
    const result = await parseChromeBookmarks(html)
    expect(result).toMatchObject({ read: 5, skipped: 1 })
    expect(result.desktop.groups.map((group) => group.name)).toEqual(['Bookmarks bar', 'Bookmarks bar / Work'])
    expect(result.desktop.groups[0].sites).toEqual([{
      origin: 'https://example.com', title: 'Example home',
      links: [{ path: '/path?a=1&b=2', title: 'First & best' }],
    }])
    expect(result.desktop.groups[1].sites[0]).toEqual({
      origin: 'https://github.com', title: 'github.com', links: [{ path: '/pulls', title: 'Pulls' }],
    })
    expect(chromeRows(result.desktop, [10, 11])).toEqual([
      { groupId: 10, origin: 'https://example.com', title: 'Example home', sitePosition: 0, path: null },
      { groupId: 10, origin: 'https://example.com', title: 'Example home', sitePosition: 0, path: '/path?a=1&b=2', linkTitle: 'First & best', linkPosition: 0 },
      { groupId: 11, origin: 'https://github.com', title: 'github.com', sitePosition: 0, path: null },
      { groupId: 11, origin: 'https://github.com', title: 'github.com', sitePosition: 0, path: '/pulls', linkTitle: 'Pulls', linkPosition: 0 },
    ])
  })

  it('reports parsing progress for large exports and skips non-web addresses', async () => {
    const progress = vi.fn()
    const links = Array.from({ length: 501 }, (_, index) => `<DT><A HREF="https://example.com/page-${index}">Page ${index}</A>`).join('')
    const result = await parseChromeBookmarks(`${header}<DL><p>${links}<DT><A HREF="file:///tmp/test">Local</A></DL>`, progress)
    expect(progress.mock.calls).toEqual([[250, 502], [500, 502], [502, 502]])
    expect(result.desktop.groups[0].sites[0].links).toHaveLength(501)
    expect(result.skipped).toBe(1)
  })

  it('rejects unrelated files and exports without usable web bookmarks', async () => {
    await expect(parseChromeBookmarks('<html><a href="https://example.com">x</a></html>')).rejects.toThrow('Chrome')
    await expect(parseChromeBookmarks(`${header}<DL><DT><A HREF="chrome://settings">Settings</A></DL>`)).rejects.toThrow('可导入')
  })
})
