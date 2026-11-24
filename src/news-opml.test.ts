import { describe, expect, it } from 'vitest'
import { readNewsOpml } from './news-opml'

describe('reading OPML news subscriptions', () => {
  it('preserves folders, nested folders and ungrouped HTTP feeds', () => {
    const { sections, skipped } = readNewsOpml(`<opml version="2.0"><body>
      <outline text="Flat" xmlUrl="https://news.example/feed" htmlUrl="https://news.example/"/>
      <outline text="Tech" title="技术">
        <outline text="Example" xmlUrl="https://tech.example/atom?a=1&amp;b=2"/>
        <outline text="Duplicate" xmlUrl="https://tech.example/atom?a=1&amp;b=2#fragment"/>
        <outline text="Nested">
          <outline text="Nested feed" xmlUrl="http://local.test/feed"/>
          <outline text="Invalid" xmlUrl="file:///tmp/feed"/>
        </outline>
      </outline>
      <outline text="Notes" isComment="true"><outline text="Ignored" xmlUrl="https://ignored.example/feed"/></outline>
    </body></opml>`)

    expect(sections.map(({ name, sources }) => ({ name, sources }))).toEqual([
      { name: '未分组', sources: [{ name: 'Flat', url: 'https://news.example/feed' }] },
      { name: '技术', sources: [{ name: 'Example', url: 'https://tech.example/atom?a=1&b=2' }] },
      { name: '技术 / Nested', sources: [{ name: 'Nested feed', url: 'http://local.test/feed' }] },
    ])
    expect(skipped).toBe(2)
  })

  it('rejects unrelated XML and an OPML file without subscription addresses', () => {
    expect(() => readNewsOpml('<rss version="2.0"><channel/></rss>')).toThrow('OPML')
    expect(() => readNewsOpml('<opml version="2.0"><body><outline text="Page" htmlUrl="https://example.com/"/></body></opml>')).toThrow('没有可用的订阅地址')
  })
})
