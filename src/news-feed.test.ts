import { describe, expect, it } from 'vitest'
import { readNewsItems } from './news-feed'

describe('news feed entries', () => {
  it('reads RSS sources, sorts dated entries and keeps only the newest item per URL', () => {
    const xml = `<rss version="2.0"><channel><title>快报合集</title>
      <item><title>旧标题</title><link>/story</link><pubDate>Mon, 23 Nov 2026 08:00:00 GMT</pubDate></item>
      <item><title>排第二</title><link>/second</link><pubDate>Mon, 23 Nov 2026 09:00:00 GMT</pubDate></item>
      <item><title>新标题 &amp; 补充</title><link>/story</link><source url="https://paper.example/feed">示例报</source><pubDate>Mon, 23 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>无日期</title><link>/undated</link></item>
      <item><title>不能打开</title><link>javascript:alert(1)</link></item>
    </channel></rss>`

    expect(readNewsItems(xml, 'https://feeds.example/combined')).toEqual([
      { title: '新标题 & 补充', url: 'https://feeds.example/story', source: '示例报', publishedAt: Date.UTC(2026, 10, 23, 10) },
      { title: '排第二', url: 'https://feeds.example/second', source: '快报合集', publishedAt: Date.UTC(2026, 10, 23, 9) },
      { title: '无日期', url: 'https://feeds.example/undated', source: '快报合集', publishedAt: null },
    ])
  })

  it('uses an Atom alternate link and the original source', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://paper.example/news/">
      <title>快报</title><entry>
        <title>一条 Atom 快报</title><id>urn:news:1</id>
        <link rel="self" href="/feed"/><link rel="alternate" href="feature"/>
        <source><title>示例报</title></source>
        <published>2026-11-23T08:00:00Z</published><updated>2026-11-23T09:00:00Z</updated>
      </entry>
    </feed>`

    expect(readNewsItems(xml, 'https://feeds.example/atom')).toEqual([
      { title: '一条 Atom 快报', url: 'https://paper.example/news/feature', source: '示例报', publishedAt: Date.UTC(2026, 10, 23, 8) },
    ])
  })
})
