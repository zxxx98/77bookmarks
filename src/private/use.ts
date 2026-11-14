import { useSyncExternalStore } from 'react'
import { privateSpace } from './session'

/** Whether a private space is open in this tab */
export const usePrivateActive = () => useSyncExternalStore(privateSpace.subscribe, privateSpace.active)
/** Changes whenever a space is opened or closed */
export const usePrivateGeneration = () => useSyncExternalStore(privateSpace.subscribe, privateSpace.generation)
