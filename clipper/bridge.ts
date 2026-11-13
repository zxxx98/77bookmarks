/**
 * Runs in the pages of the connected server, and nowhere else. A page cannot open an
 * incognito window, which the addresses of a private space are opened in; the extension can.
 * The page asks with a window message, this passes the request on and the answer back.
 */
const PAGE = '77bookmarks-page'
const CLIPPER = '77bookmarks-clipper'

document.documentElement.dataset.bookmarks77Clipper = '1'

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return
  const data = event.data as { source?: unknown; type?: unknown; id?: unknown; url?: unknown } | null
  if (data?.source !== PAGE || data.type !== 'open-incognito' || typeof data.id !== 'string' || typeof data.url !== 'string') return
  const answer = (ok: boolean) => window.postMessage({ source: CLIPPER, id: data.id, ok }, window.location.origin)
  chrome.runtime.sendMessage({ type: 'open-incognito', url: data.url }).then((response) => answer(response?.ok === true), () => answer(false))
})
