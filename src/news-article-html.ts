import DOMPurify from 'dompurify'

function resolveWebUrl(value: string | null, base: string): string | null {
  if (!value?.trim()) return null
  try {
    const url = new URL(value, base)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) return url.href
  } catch { /* Skip malformed article links. */ }
  return null
}

export function sanitizeNewsHtml(html: string, articleUrl: string): string {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['a', 'b', 'blockquote', 'br', 'caption', 'code', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  })

  for (const link of fragment.querySelectorAll('a')) {
    const url = resolveWebUrl(link.getAttribute('href'), articleUrl)
    if (!url) {
      link.removeAttribute('href')
      continue
    }
    link.setAttribute('href', url)
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noreferrer noopener')
  }
  for (const image of fragment.querySelectorAll('img')) {
    const url = resolveWebUrl(image.getAttribute('src'), articleUrl)
    if (!url) {
      image.remove()
      continue
    }
    image.setAttribute('src', url)
    image.setAttribute('loading', 'lazy')
    image.setAttribute('referrerpolicy', 'no-referrer')
  }

  if (!fragment.textContent?.trim() && !fragment.querySelector('img')) return ''
  const content = document.createElement('div')
  content.append(fragment)
  return content.innerHTML
}
