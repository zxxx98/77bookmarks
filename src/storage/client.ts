import { platform } from '../platform'

export { DATA_CHANGED, DATA_MESSAGE, SYNC_MESSAGE } from './messages'

/** The data boundary of the interface; where a request ends up is the platform adapter's business */
export const call: typeof platform.call = (method, ...args) => platform.call(method, ...args)
export const syncCall: typeof platform.syncCall = (method, ...args) => platform.syncCall(method, ...args)
export const onDataChanged = (listener: () => void) => platform.onDataChanged(listener)
