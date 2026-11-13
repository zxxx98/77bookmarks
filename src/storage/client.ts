import { platform } from '../platform'
import { privateSpace } from '../private/session'

export { DATA_CHANGED, DATA_MESSAGE, SYNC_MESSAGE } from './messages'

/**
 * The data boundary of the interface; where a request ends up is the platform adapter's
 * business. While a private space is open, requests about the board go to that space.
 */
export const call: typeof platform.call = (method, ...args) =>
  privateSpace.handles(method) ? privateSpace.call(method, args) as never : platform.call(method, ...args)
export const syncCall: typeof platform.syncCall = (method, ...args) => platform.syncCall(method, ...args)
export const onDataChanged = (listener: () => void) => platform.onDataChanged(listener)
