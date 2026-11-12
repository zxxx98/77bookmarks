import { describe, expect, it } from 'vitest'
import { describeResult, isBookmarkable } from '../extension/lib.js'

describe('bookmarkable pages', () => {
  it.each(['https://example.com/a?b=c', 'http://localhost:3000'])('accepts %s', (url) => {
    expect(isBookmarkable(url)).toBe(true)
  })

  it.each(['chrome://extensions', 'chrome-extension://abc/popup.html', 'file:///home/me/a.html', 'about:blank', '', 'example.com'])('refuses %j', (url) => {
    expect(isBookmarkable(url)).toBe(false)
  })
})

describe('result messages', () => {
  it.each([
    ['site_created', '已添加「GitHub」'],
    ['link_added', '已添加到「GitHub」'],
    ['site_exists', '「GitHub」已在书签页里'],
    ['link_exists', '「GitHub」里已有这个链接'],
  ] as const)('describes %s', (result, message) => {
    expect(describeResult({ result, siteId: 1, siteTitle: 'GitHub' })).toBe(message)
  })
})
