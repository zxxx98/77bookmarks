import { parseOpml, type Opml } from 'feedsmith'
import { MAX_NEWS_NAME, MAX_NEWS_SECTIONS, MAX_NEWS_SOURCES, newsSourceKey, parseNewsSections, type NewsSection } from '../shared/news'
import { parseNewsFeedUrl } from '../shared/url'

export const MAX_OPML_BYTES = 1024 * 1024

export function readNewsOpml(text: string): { sections: NewsSection[]; skipped: number } {
  let outlines: Opml.Outline<string>[] | undefined
  try {
    outlines = parseOpml(text).body?.outlines
  } catch {
    throw new Error('无法读取此 OPML 文件')
  }
  const sections: NewsSection[] = []
  let count = 0
  let skipped = 0

  function collect(nodes: Opml.Outline<string>[], path: string[]) {
    const seen = new Set<string>()
    const sources: NewsSection['sources'] = []
    const folders: { outlines: Opml.Outline<string>[]; name: string }[] = []
    for (const node of nodes) {
      if (node.isComment) continue
      const label = node.title?.trim() || node.text?.trim()
      if (node.outlines?.length) folders.push({ outlines: node.outlines, name: label || '未命名分组' })
      if (node.xmlUrl === undefined) continue
      const url = parseNewsFeedUrl(node.xmlUrl)
      const key = url && newsSourceKey(url)
      if (!url || !key || seen.has(key)) {
        skipped++
        continue
      }
      seen.add(key)
      const name = label?.slice(0, MAX_NEWS_NAME)
      sources.push({ url, ...(name ? { name } : {}) })
    }
    if (sources.length) {
      count += sources.length
      if (count > MAX_NEWS_SOURCES || sections.length >= MAX_NEWS_SECTIONS) {
        throw new Error(`每份 OPML 最多支持 ${MAX_NEWS_SECTIONS} 个分组、${MAX_NEWS_SOURCES} 个订阅源`)
      }
      sections.push({ id: `opml-${sections.length + 1}`, name: (path.join(' / ') || '未分组').slice(0, MAX_NEWS_NAME), sources })
    }
    for (const folder of folders) collect(folder.outlines, [...path, folder.name])
  }

  collect(outlines ?? [], [])
  if (!sections.length) throw new Error('OPML 中没有可用的订阅地址')
  if (!parseNewsSections(sections)) throw new Error('OPML 中的订阅地址过长')
  return { sections, skipped }
}
