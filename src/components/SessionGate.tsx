import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_SITE_NAME } from '../../shared/settings'
import { platform } from '../platform'
import { LogoutContext } from '../session'
import { readSettings } from '../settings'
import { LoginPage } from './LoginPage'

type State = { status: 'checking' } | { status: 'error'; message: string } | { status: 'out'; siteName: string } | { status: 'in' }

/** Keeps the app behind the sign-in page where the platform has sessions; a no-op elsewhere */
export function SessionGate({ children }: { children: ReactNode }) {
  const session = platform.session
  const queryClient = useQueryClient()
  const [state, setState] = useState<State>(session ? { status: 'checking' } : { status: 'in' })

  const check = useCallback(() => {
    if (!session) return
    setState({ status: 'checking' })
    session.status().then(
      ({ authenticated, siteName }) => setState(authenticated ? { status: 'in' } : { status: 'out', siteName }),
      (error) => setState({ status: 'error', message: error instanceof Error ? error.message : '无法连接服务器' }),
    )
  }, [session])
  useEffect(check, [check])

  const signedOut = useCallback(() => {
    // Nothing of the previous session may be shown to whoever signs in next
    queryClient.clear()
    setState({ status: 'out', siteName: readSettings().siteName || DEFAULT_SITE_NAME })
  }, [queryClient])
  useEffect(() => session?.onExpired(signedOut), [session, signedOut])

  const logout = useCallback(() => {
    void session?.logout().catch(() => undefined).then(signedOut)
  }, [session, signedOut])

  if (state.status === 'in') return <LogoutContext.Provider value={session ? logout : undefined}>{children}</LogoutContext.Provider>
  if (state.status === 'out') {
    return <LoginPage siteName={state.siteName} onLogin={async (password) => { await session!.login(password); setState({ status: 'in' }) }} />
  }
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      {state.status === 'checking' ? <LoaderCircle className="animate-spin text-faint" /> : (
        <div>
          <p className="text-sm text-muted">{state.message}</p>
          <button className="btn btn-soft mt-4" onClick={check}>重试</button>
        </div>
      )}
    </main>
  )
}
