import { describe, expect, it } from 'vitest'
import { getSearchEngine, SEARCH_ENGINES } from './engines'

describe('engines', () => {
  it('contains the expected default search engines', () => {
    const ids = SEARCH_ENGINES.map((e) => e.id)
    expect(ids).toEqual(['google', 'bing', 'baidu', 'duckduckgo', 'github'])
  })

  it('correctly builds search query URLs with proper encoding', () => {
    const google = getSearchEngine('google')
    expect(google.buildUrl('react hooks & context')).toBe('https://www.google.com/search?q=react%20hooks%20%26%20context')

    const bing = getSearchEngine('bing')
    expect(bing.buildUrl('test search')).toBe('https://www.bing.com/search?q=test%20search')

    const baidu = getSearchEngine('baidu')
    expect(baidu.buildUrl('书签 搜索')).toBe('https://www.baidu.com/s?wd=%E4%B9%A6%E7%AD%BE%20%E6%90%9C%E7%B4%A2')

    const ddg = getSearchEngine('duckduckgo')
    expect(ddg.buildUrl('privacy search')).toBe('https://duckduckgo.com/?q=privacy%20search')

    const github = getSearchEngine('github')
    expect(github.buildUrl('antigravity cli')).toBe('https://github.com/search?q=antigravity%20cli')
  })

  it('falls back to google when engine id is unknown', () => {
    // @ts-expect-error testing unknown engine id fallback
    const fallback = getSearchEngine('unknown')
    expect(fallback.id).toBe('google')
  })
})
