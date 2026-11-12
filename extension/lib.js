/** Shared presentation helpers for the local extension. */
/** @param {string} url */
export function isBookmarkable(url) {
  try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false }
}
/** @param {import('../shared/types').AddResult} result */
export function describeResult(result) {
  switch (result.result) {
    case 'site_created': return `已添加「${result.siteTitle}」`
    case 'link_added': return `已添加到「${result.siteTitle}」`
    case 'site_exists': return `「${result.siteTitle}」已在书签页里`
    case 'link_exists': return `「${result.siteTitle}」里已有这个链接`
  }
}
