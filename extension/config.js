/** Where the connection and the last chosen desktop and group are kept. Local to this browser. */

/** @typedef {import('./lib.js').Connection} Connection */

const KEYS = ['server', 'token', 'siteName', 'desktopId', 'groupId']

/** @returns {Promise<Connection | null>} */
export async function getConnection() {
  const { server, token, siteName } = await chrome.storage.local.get(['server', 'token', 'siteName'])
  return server && token ? { server, token, siteName } : null
}

/** @param {Connection} connection */
export async function saveConnection(connection) {
  // Switching servers must not keep the other one's desktop and group
  await chrome.storage.local.remove(['desktopId', 'groupId'])
  await chrome.storage.local.set({ server: connection.server, token: connection.token, siteName: connection.siteName ?? '' })
}

export async function clearConnection() {
  await chrome.storage.local.remove(KEYS)
}

/** The desktop and group the extension adds to, defaulting to the server's first ones */
export async function getTarget() {
  const { desktopId, groupId } = await chrome.storage.local.get(['desktopId', 'groupId'])
  return { desktopId: desktopId || undefined, groupId: groupId || undefined }
}

/** @param {{ desktopId?: number, groupId?: number }} target */
export async function saveTarget(target) {
  await chrome.storage.local.set({ desktopId: target.desktopId ?? '', groupId: target.groupId ?? '' })
}
