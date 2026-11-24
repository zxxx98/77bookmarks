import { describe, expect, it } from 'vitest'
import { readNewsArticle, readNewsBatch, readNewsItems } from './news-feed'

describe('news feed entries', () => {
  it('keeps RSS article content available on demand while the headlines stay small', async () => {
    const feedUrl = 'https://example.com/rss'
    const xml = `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>快报</title>
      <item><title>正文</title><link>/body</link><description>较短的摘要</description><content:encoded><![CDATA[<p>完整正文</p>]]></content:encoded></item>
      <item><title>摘要</title><link>/summary</link><description><![CDATA[<p>只有摘要</p>]]></description></item>
      <item><title>标题</title><link>/title</link></item>
    </channel></rss>`
    const read = async () => readNewsItems(xml, feedUrl)
    const headlines = await readNewsBatch([{ url: feedUrl }], read, false)
    expect(headlines.items[0]).toMatchObject({ url: 'https://example.com/body', feedUrl })
    expect(headlines.items[0]).not.toHaveProperty('article')
    await expect(readNewsArticle(read, feedUrl, 'https://example.com/body')).resolves.toEqual({ kind: 'full', format: 'html', body: '<p>完整正文</p>' })
    await expect(readNewsArticle(read, feedUrl, 'https://example.com/summary')).resolves.toEqual({ kind: 'summary', format: 'html', body: '<p>只有摘要</p>' })
    await expect(readNewsArticle(read, feedUrl, 'https://example.com/title')).resolves.toBeNull()
  })

  it('respects Atom content types and JSON Feed text', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>快报</title>
      <entry><title>HTML</title><link href="https://example.com/html"/><content type="html">&lt;p&gt;正文&lt;/p&gt;</content></entry>
      <entry><title>文本</title><link href="https://example.com/text"/><content type="text">文本 &lt;tag&gt;</content></entry>
      <entry><title>XHTML</title><link href="https://example.com/xhtml"/><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>富文本</p></div></content></entry>
      <entry><title>外部内容</title><link href="https://example.com/external"/><content type="image/png" src="https://example.com/image.png"/><summary>源提供的摘要</summary></entry>
    </feed>`
    const feedUrl = 'https://example.com/feed'
    const items = readNewsItems(atom, feedUrl)
    expect(items[0].article).toEqual({ kind: 'full', format: 'html', body: '<p>正文</p>' })
    expect(items[1].article).toEqual({ kind: 'full', format: 'text', body: '文本 <tag>' })
    expect(items[2].article).toMatchObject({ kind: 'full', format: 'html', body: expect.stringContaining('<p>富文本</p>') })
    expect(items[3].article).toEqual({ kind: 'summary', format: 'text', body: '源提供的摘要' })
    const json = JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'JSON', items: [{ id: 'story', url: 'https://example.com/story', title: '文本', content_text: '第一段\n第二段' }] })
    expect(readNewsItems(json, feedUrl)[0].article).toEqual({ kind: 'full', format: 'text', body: '第一段\n第二段' })
  })

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
