import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Logo } from './TopBar'

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Changing the key restarts the shake animation on every failed attempt
  const [attempt, setAttempt] = useState(0)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!password || busy) return
    setBusy(true)
    try {
      await api.login(password)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
      setAttempt((n) => n + 1)
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs animate-rise text-center">
        <div className="mx-auto mb-5 w-fit rounded-[18px] shadow-pop">
          <Logo size={60} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">77 Bookmarks</h1>
        <p className="mt-1 mb-7 text-sm text-muted">输入密码以继续</p>

        <div key={attempt} className={`relative ${attempt ? 'animate-shake' : ''}`}>
          <input
            type="password"
            className={`input h-11 rounded-full bg-surface pr-12 pl-4 shadow-card ${error ? '!border-danger/60' : ''}`}
            placeholder="密码"
            aria-label="密码"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setError(null)
            }}
          />
          <button
            className="absolute top-1 right-1 grid size-9 place-items-center rounded-full bg-accent-solid text-white transition hover:brightness-110 disabled:opacity-40"
            aria-label="登录"
            disabled={!password || busy}
          >
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowRight size={16} strokeWidth={2.5} />}
          </button>
        </div>
        <p className="mt-3 h-5 text-sm text-danger" role="alert">
          {error}
        </p>
      </form>
    </main>
  )
}
