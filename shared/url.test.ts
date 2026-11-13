import { describe, expect, it } from 'vitest'
import { fallbackLinkTitle, fullIntranetUrl, fullUrl, hostOf, parseBookmarkUrl, parseIconUrl, parseIntranetUrl, selectionTitle, textFragmentUrl } from './url'

describe('parseBookmarkUrl', () => {
  it('adds https when the scheme is missing', () => {
    expect(parseBookmarkUrl('github.com/anthropics/claude-code')).toEqual({
      origin: 'https://github.com',
      host: 'github.com',
      path: '/anthropics/claude-code',
    })
  })

  it('keeps an explicit http scheme and port', () => {
    expect(parseBookmarkUrl('http://192.168.1.2:5000/admin')).toEqual({
      origin: 'http://192.168.1.2:5000',
      host: '192.168.1.2:5000',
      path: '/admin',
    })
  })

  it('treats the site root as having no path', () => {
    expect(parseBookmarkUrl('https://github.com')?.path).toBeNull()
    expect(parseBookmarkUrl('https://github.com/')?.path).toBeNull()
  })

  it('keeps query and hash', () => {
    expect(parseBookmarkUrl('https://a.com/s?q=1&p=2#top')?.path).toBe('/s?q=1&p=2#top')
    expect(parseBookmarkUrl('https://a.com/?q=1')?.path).toBe('/?q=1')
  })

  it('strips tracking parameters', () => {
    expect(parseBookmarkUrl('https://a.com/post?utm_source=x&id=3&fbclid=y')?.path).toBe('/post?id=3')
    expect(parseBookmarkUrl('https://a.com/?utm_medium=x')?.path).toBeNull()
  })

  it('separates subdomains', () => {
    expect(parseBookmarkUrl('docs.github.com/en')?.origin).toBe('https://docs.github.com')
  })

  it('lowercases the host and trims whitespace', () => {
    expect(parseBookmarkUrl('  GitHub.com/A  ')).toEqual({
      origin: 'https://github.com',
      host: 'github.com',
      path: '/A',
    })
  })

  it('accepts localhost and scheme-qualified bare hosts', () => {
    expect(parseBookmarkUrl('localhost:3000/x')?.origin).toBe('https://localhost:3000')
    expect(parseBookmarkUrl('http://nas/login')?.origin).toBe('http://nas')
  })

  it('rejects invalid input', () => {
    for (const bad of ['', '   ', 'foo', 'hello world', 'ftp://a.com/x', 'javascript:alert(1)', 'mailto:a@b.com']) {
      expect(parseBookmarkUrl(bad), bad).toBeNull()
    }
  })
})

describe('parseIconUrl', () => {
  it('keeps the whole address, including query and tracking-like parameters', () => {
    expect(parseIconUrl(' https://cdn.example.com/i/logo.png?utm_source=x&v=2 ')).toBe('https://cdn.example.com/i/logo.png?utm_source=x&v=2')
  })

  it('adds https when the scheme is missing', () => {
    expect(parseIconUrl('example.com/favicon.ico')).toBe('https://example.com/favicon.ico')
  })

  it('accepts addresses on a local network', () => {
    expect(parseIconUrl('http://192.168.1.2:5000/icon.svg')).toBe('http://192.168.1.2:5000/icon.svg')
    expect(parseIconUrl('http://nas/icon.png')).toBe('http://nas/icon.png')
  })

  it('rejects anything that is not an http(s) address', () => {
    for (const bad of ['', '  ', 'icon', 'a b.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'ftp://a.com/i.png', `https://a.com/${'x'.repeat(2000)}`]) {
      expect(parseIconUrl(bad), bad.slice(0, 40)).toBeNull()
    }
  })
})

describe('helpers', () => {
  it('hostOf drops the scheme', () => {
    expect(hostOf('https://github.com')).toBe('github.com')
    expect(hostOf('http://a.com:8080')).toBe('a.com:8080')
  })

  it('fullUrl joins origin and path', () => {
    expect(fullUrl('https://a.com', '/x?y=1')).toBe('https://a.com/x?y=1')
    expect(fullUrl('https://a.com', null)).toBe('https://a.com')
  })

  it('fallbackLinkTitle uses the last path segment', () => {
    expect(fallbackLinkTitle('/anthropics/claude-code')).toBe('claude-code')
    expect(fallbackLinkTitle('/docs/%E4%B8%AD%E6%96%87/?a=1')).toBe('中文')
    expect(fallbackLinkTitle('/?q=1')).toBe('/?q=1')
  })

  it('parseIntranetUrl normalizes intranet addresses and fullIntranetUrl joins subpaths', () => {
    expect(parseIntranetUrl('192.168.1.100:8080')).toBe('http://192.168.1.100:8080')
    expect(parseIntranetUrl('http://nas:5000/')).toBe('http://nas:5000')
    expect(parseIntranetUrl('https://intranet.corp.local/app')).toBe('https://intranet.corp.local/app')
    expect(parseIntranetUrl('not a url')).toBeNull()
    expect(fullIntranetUrl('http://192.168.1.100:8080', '/docs')).toBe('http://192.168.1.100:8080/docs')
    expect(fullIntranetUrl('http://192.168.1.100:8080', null)).toBe('http://192.168.1.100:8080')
  })
})

describe('textFragmentUrl', () => {
  it('quotes a short selection exactly', () => {
    expect(textFragmentUrl('https://a.com/post', '  hello   world ')).toBe('https://a.com/post#:~:text=hello%20world')
  })

  it('escapes the characters that separate directive parts', () => {
    expect(textFragmentUrl('https://a.com/', 'a-b, c&d')).toBe('https://a.com/#:~:text=a%2Db%2C%20c%26d')
  })

  it('keeps an existing anchor and replaces an existing directive', () => {
    expect(textFragmentUrl('https://a.com/p#intro', '你好')).toBe(`https://a.com/p#intro:~:text=${encodeURIComponent('你好')}`)
    expect(textFragmentUrl('https://a.com/p#:~:text=old', 'new')).toBe('https://a.com/p#:~:text=new')
  })

  it('stores the two ends of a selection that spans paragraphs', () => {
    expect(textFragmentUrl('https://a.com/p', 'First paragraph here.\n\nSecond one ends')).toBe(
      'https://a.com/p#:~:text=First%20paragraph%20here.,Second%20one%20ends',
    )
  })

  it('stores the two ends of a long selection as whole words', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`)
    const directive = textFragmentUrl('https://a.com/p', words.join(' ')).split(':~:text=')[1]
    const [start, end] = directive.split(',').map(decodeURIComponent)
    expect(words.join(' ').startsWith(start + ' ')).toBe(true)
    expect(words.join(' ').endsWith(' ' + end)).toBe(true)
    expect(start.length).toBeLessThanOrEqual(40)
    expect(end.length).toBeLessThanOrEqual(40)
  })

  it('survives bookmark parsing', () => {
    const url = textFragmentUrl('https://a.com/p', 'hello world')
    expect(parseBookmarkUrl(url)?.path).toBe('/p#:~:text=hello%20world')
  })

  it('leaves the address alone when nothing is selected', () => {
    expect(textFragmentUrl('https://a.com/p', ' \n ')).toBe('https://a.com/p')
  })
})

describe('selectionTitle', () => {
  it('collapses whitespace and caps the length', () => {
    expect(selectionTitle(' a\n b ')).toBe('a b')
    expect(selectionTitle('x'.repeat(200))).toHaveLength(80)
  })
})
