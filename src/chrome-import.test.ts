// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  allCheckState,
  chromeRows,
  countGroupSelected,
  createChromeSelection,
  filterChromeDesktop,
  filterChromePreview,
  groupCheckState,
  parseChromeBookmarks,
  rootOriginSet,
  siteCheckState,
  toggleAllSelection,
  toggleGroupSelection,
  toggleLinkSelection,
  toggleSiteSelection,
} from './chrome-import'

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

  it('defaults selection to all items and supports group, site, and link toggling', async () => {
    const html = `${header}<DL><p>
      <DT><H3>Dev</H3><DL><p>
        <DT><A HREF="https://example.com/">Example</A>
        <DT><A HREF="https://example.com/docs">Docs</A>
        <DT><A HREF="https://github.com/pulls">Pulls</A>
        <DT><A HREF="https://github.com/issues">Issues</A>
      </DL><p>
      <DT><H3>Reading</H3><DL><p>
        <DT><A HREF="https://news.ycombinator.com/">HN</A>
      </DL><p>
    </DL><p>`
    const data = await parseChromeBookmarks(html)
    const roots = rootOriginSet(data)
    expect([...roots]).toEqual(['https://example.com', 'https://news.ycombinator.com'])

    let selection = createChromeSelection(data)
    expect(allCheckState(data, selection, roots)).toBe('checked')
    expect(filterChromeDesktop(data, selection).groups).toHaveLength(2)

    // Unchecking a link on a site without root makes it indeterminate; unchecking both drops the site
    selection[0][1] = toggleLinkSelection(selection[0][1], 0)
    expect(siteCheckState(data.desktop.groups[0].sites[1], selection[0][1], roots)).toBe('indeterminate')
    expect(groupCheckState(data.desktop.groups[0], selection[0], roots)).toBe('indeterminate')
    expect(allCheckState(data, selection, roots)).toBe('indeterminate')

    selection[0][1] = toggleLinkSelection(selection[0][1], 1)
    expect(siteCheckState(data.desktop.groups[0].sites[1], selection[0][1], roots)).toBe('unchecked')
    expect(countGroupSelected(data.desktop.groups[0], selection[0])).toEqual({ sites: 1, links: 1 })

    // Unchecking the sub-link on a site WITH root keeps the root card selected; clicking site unchecks root too
    selection[0][0] = toggleLinkSelection(selection[0][0], 0)
    expect(siteCheckState(data.desktop.groups[0].sites[0], selection[0][0], roots)).toBe('indeterminate')
    expect(filterChromeDesktop(data, selection).groups[0].sites).toEqual([
      { origin: 'https://example.com', title: 'Example', links: [] },
    ])
    selection[0][0] = toggleSiteSelection(data.desktop.groups[0].sites[0], selection[0][0], roots)
    expect(siteCheckState(data.desktop.groups[0].sites[0], selection[0][0], roots)).toBe('unchecked')

    // Group 0 now has 0 selected items and is excluded from filtered output
    expect(filterChromeDesktop(data, selection).groups.map((g) => g.name)).toEqual(['Reading'])

    // Toggling group 0 re-selects everything inside group 0
    selection[0] = toggleGroupSelection(data.desktop.groups[0], selection[0], roots)
    expect(groupCheckState(data.desktop.groups[0], selection[0], roots)).toBe('checked')
    expect(allCheckState(data, selection, roots)).toBe('checked')

    // Global toggle unselects all, then re-selects all
    selection = toggleAllSelection(data, selection, roots)
    expect(allCheckState(data, selection, roots)).toBe('unchecked')
    expect(filterChromeDesktop(data, selection).groups).toEqual([])
    selection = toggleAllSelection(data, selection, roots)
    expect(allCheckState(data, selection, roots)).toBe('checked')
    expect(filterChromeDesktop(data, selection).groups).toHaveLength(2)
  })

  it('filters preview items by group name, site, or link while preserving original indices', async () => {
    const html = `${header}<DL><p>
      <DT><H3>Dev</H3><DL><p>
        <DT><A HREF="https://github.com/pulls">Pulls</A>
        <DT><A HREF="https://github.com/issues">Issues</A>
        <DT><A HREF="https://vitejs.dev/">Vite</A>
      </DL><p>
      <DT><H3>Music</H3><DL><p>
        <DT><A HREF="https://open.spotify.com/">Spotify</A>
      </DL><p>
    </DL><p>`
    const data = await parseChromeBookmarks(html)

    expect(filterChromePreview(data.desktop.groups, 'pulls')).toEqual([
      {
        group: data.desktop.groups[0],
        groupIndex: 0,
        sites: [{ site: data.desktop.groups[0].sites[0], siteIndex: 0, linkIndices: [0] }],
      },
    ])

    expect(filterChromePreview(data.desktop.groups, 'music')).toEqual([
      {
        group: data.desktop.groups[1],
        groupIndex: 1,
        sites: [{ site: data.desktop.groups[1].sites[0], siteIndex: 0, linkIndices: [] }],
      },
    ])

    expect(filterChromePreview(data.desktop.groups, 'nonexistent')).toEqual([])
  })
})
