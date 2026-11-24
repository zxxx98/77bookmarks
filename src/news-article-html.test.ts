// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeNewsHtml } from './news-article-html'

describe('news reader HTML', () => {
  it('keeps article formatting, resolves safe links and removes external embeds and executable markup', () => {
    const html = `<p onclick="alert(1)"><strong>正文</strong></p>
      <script>alert(1)</script><iframe src="/next"></iframe><svg onload="alert(1)"></svg>
      <a href="javascript:alert(1)">不可用链接</a><a href="./details">详情</a>
      <img src="/picture.png" onerror="alert(1)" alt="插图"><img src="data:image/png;base64,AAAA">`
    const body = document.createElement('div')
    body.innerHTML = sanitizeNewsHtml(html, 'https://example.com/read/story')

    expect(body.querySelector('strong')?.textContent).toBe('正文')
    expect(body.querySelectorAll('script, iframe, svg, [onclick], [onerror]')).toHaveLength(0)
    expect(body.querySelectorAll('a[href]')).toHaveLength(1)
    expect(body.querySelector('a[href]')).toMatchObject({ href: 'https://example.com/read/details', target: '_blank', rel: 'noreferrer noopener' })
    expect(body.querySelectorAll('img')).toHaveLength(1)
    expect(body.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(body.querySelector('img')?.getAttribute('src')).toBe('https://example.com/picture.png')
  })
})
