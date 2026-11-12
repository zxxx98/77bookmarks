import { createContext, useContext } from 'react'

export const LogoutContext = createContext<(() => void) | undefined>(undefined)
/** Signs out, on editions that have signing in; undefined elsewhere, which hides the menu entry */
export const useLogout = () => useContext(LogoutContext)
