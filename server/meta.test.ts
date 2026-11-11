import { describe, expect, it } from 'vitest'
import { linkTitleFrom, reportedMeta, siteTitleFrom } from './meta'

describe('titles reported by the browser extension', () => {
  const url = 'https://grafana.corp.example/d/abc/prod-overview'

  it('names a link after the tab title, without the name of its site', () => {
    expect(linkTitleFrom(reportedMeta('Prod Overview - Dashboards - Grafana', url), url, 'Grafana')).toBe('Prod Overview - Dashboards')
  })

  it('has no link title to offer when the tab title is only the site name', () => {
    expect(linkTitleFrom(reportedMeta('Grafana', url), url, 'Grafana')).toBeNull()
  })

  it('is not mistaken for a redirect, unlike a fetch that ended on a login page', () => {
    const fetched = { title: 'Login - Grafana', siteName: null, icons: [], finalUrl: 'https://grafana.corp.example/login' }
    expect(linkTitleFrom(fetched, url, 'Grafana')).toBeNull()
    expect(linkTitleFrom(reportedMeta('Prod Overview', url), url, 'Grafana')).toBe('Prod Overview')
  })

  it('names a card after the meaningful part of a homepage tab title', () => {
    expect(siteTitleFrom(reportedMeta('首页 | 内部知识库', 'https://wiki.corp.example'))).toBe('内部知识库')
  })
})
