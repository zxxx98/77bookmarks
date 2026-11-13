import { Copy, EyeOff, KeyRound, LoaderCircle, Lock, LockOpen, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { MIN_PASSWORD_LENGTH } from '../../shared/vault'
import { INCOGNITO_UNAVAILABLE, openInIncognito } from '../private/open'
import { privateSpace } from '../private/session'
import { usePrivateActive } from '../private/use'
import { Dialog, usePopover, useUi } from '../ui'

export type PrivateAction = 'unlock' | 'password'

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : '操作失败，请重试')

/**
 * A password field the browser does not recognise as one: no offer to save it, no entry in
 * the form history, no form to submit. The dots come from the stylesheet.
 */
function SecretInput({ value, onChange, onEnter, placeholder, disabled, autoFocus, label }: {
  value: string
  onChange: (value: string) => void
  onEnter: () => void
  placeholder: string
  disabled: boolean
  autoFocus?: boolean
  label: string
}) {
  return (
    <input
      type="text"
      className="input font-mono"
      style={{ WebkitTextSecurity: 'disc' } as CSSProperties}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      data-form-type="other"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); onEnter() } }}
    />
  )
}

/**
 * The one way into every private space. It never says how many there are or whether there
 * are any: a password either opens something or it does not, and typing it a second time
 * creates a space under it.
 */
function UnlockDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** The password that just led nowhere, which is what a new space may be created under */
  const [missing, setMissing] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setPassword(''); setError(''); setMissing(null); setBusy(false)
  }, [open])

  const submit = async () => {
    if (busy || !password) return
    setBusy(true)
    setError('')
    try {
      if (missing !== null && password === missing) await privateSpace.create(password)
      else if (!(await privateSpace.unlock(password))) {
        setMissing(password)
        setPassword('')
      }
      // Opening a space starts the interface over, which takes this dialog with it
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  const canCreate = missing !== null && [...missing].length >= MIN_PASSWORD_LENGTH

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose() }} closeDisabled={busy} title="隐私空间" width="max-w-sm">
      <p className="mb-3 text-sm leading-relaxed text-muted">
        {missing === null ? '输入密码，打开它对应的隐私空间。' : canCreate ? '没有用这个密码加密的隐私空间。要用它新建一个，请再输入一次。' : `没有用这个密码加密的隐私空间。新建时密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`}
      </p>
      <SecretInput value={password} onChange={(value) => { setPassword(value); setError('') }} onEnter={submit} placeholder={missing !== null && canCreate ? '再次输入密码' : '密码'} label="隐私空间密码" disabled={busy} autoFocus />
      {missing !== null && canCreate && <p className="mt-2 text-xs leading-relaxed text-faint">密码无法找回：一旦忘记，里面的内容就再也打不开。</p>}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn btn-soft" disabled={busy} onClick={onClose}>取消</button>
        <button type="button" className="btn btn-primary" disabled={busy || !password} onClick={submit}>
          {busy && <LoaderCircle size={15} className="animate-spin" />}
          {missing !== null && password === missing ? '新建' : '打开'}
        </button>
      </div>
    </Dialog>
  )
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useUi()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) return
    setPassword(''); setRepeat(''); setError(''); setBusy(false)
  }, [open])
  const mismatch = !!repeat && repeat !== password
  const ready = [...password].length >= MIN_PASSWORD_LENGTH && repeat === password
  const submit = async () => {
    if (busy || !ready) return
    setBusy(true)
    setError('')
    try {
      await privateSpace.changePassword(password)
      toast('密码已修改，旧密码不再能打开这个空间')
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose() }} closeDisabled={busy} title="修改隐私空间密码" width="max-w-sm">
      <div className="flex flex-col gap-3">
        <SecretInput value={password} onChange={(value) => { setPassword(value); setError('') }} onEnter={submit} placeholder={`新密码，至少 ${MIN_PASSWORD_LENGTH} 个字符`} label="新密码" disabled={busy} autoFocus />
        <SecretInput value={repeat} onChange={(value) => { setRepeat(value); setError('') }} onEnter={submit} placeholder="再次输入新密码" label="再次输入新密码" disabled={busy} />
      </div>
      {mismatch && <p className="mt-2 text-sm text-danger">两次输入的密码不一致</p>}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-2 text-xs leading-relaxed text-faint">密码无法找回：一旦忘记，里面的内容就再也打不开。</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn btn-soft" disabled={busy} onClick={onClose}>取消</button>
        <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={submit}>
          {busy && <LoaderCircle size={15} className="animate-spin" />}
          修改密码
        </button>
      </div>
    </Dialog>
  )
}

/**
 * While a private space is open, every address clicked on the page opens in an incognito
 * window instead of this one. Where no such window can be opened, the user is told and
 * decides; nothing is opened in this window behind their back.
 */
function IncognitoLinks() {
  const active = usePrivateActive()
  const { toast } = useUi()
  const [blocked, setBlocked] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    const intercept = (event: MouseEvent) => {
      // A handler of the card that already took the click (to ask inner or outer network) opens it itself
      if (event.defaultPrevented || (event.type === 'auxclick' && event.button !== 1)) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      const href = anchor instanceof HTMLAnchorElement ? anchor.href : ''
      if (!/^https?:/i.test(href) || anchor?.hasAttribute('download')) return
      event.preventDefault()
      void openInIncognito(href)
    }
    const unavailable = (event: Event) => setBlocked(String((event as CustomEvent).detail ?? ''))
    // On the document, so that the handlers of the interface have had their turn
    document.addEventListener('click', intercept)
    document.addEventListener('auxclick', intercept)
    window.addEventListener(INCOGNITO_UNAVAILABLE, unavailable)
    return () => {
      document.removeEventListener('click', intercept)
      document.removeEventListener('auxclick', intercept)
      window.removeEventListener(INCOGNITO_UNAVAILABLE, unavailable)
    }
  }, [active])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(blocked ?? '')
      toast('链接已复制')
      setBlocked(null)
    } catch {
      toast('复制失败，请手动选择上面的链接复制', 'error')
    }
  }
  return (
    <Dialog open={blocked !== null} onClose={() => setBlocked(null)} title="无法直接打开无痕窗口" width="max-w-md">
      <p className="text-sm leading-relaxed text-muted">
        网页自己不能打开无痕窗口。可以复制链接后粘贴到无痕窗口，或在卡片上点右键选择「在无痕窗口中打开链接」。连接了右键插件后，这里会直接用无痕窗口打开。
      </p>
      <p className="mt-3 rounded-control border border-line bg-surface-2 px-3 py-2 font-mono text-xs break-all select-all">{blocked}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-soft" onClick={() => { const url = blocked; setBlocked(null); if (url) window.open(url, '_blank', 'noreferrer') }}>
          仍在普通窗口打开
        </button>
        <button type="button" className="btn btn-primary" autoFocus onClick={copy}>
          <Copy size={15} />
          复制链接
        </button>
      </div>
    </Dialog>
  )
}

/** Everything about private spaces that is not part of the board itself */
export function PrivateSpaceDialogs({ action, onClose }: { action: PrivateAction | null; onClose: () => void }) {
  const { toast } = useUi()
  // The space was closed by something other than the user: say why, once
  const told = useRef(false)
  useEffect(() => {
    if (told.current) return
    told.current = true
    const notice = privateSpace.takeNotice()
    if (notice) toast(notice, 'error')
  }, [toast])
  return (
    <>
      <UnlockDialog open={action === 'unlock'} onClose={onClose} />
      <PasswordDialog open={action === 'password'} onClose={onClose} />
      <IncognitoLinks />
    </>
  )
}

/** Asks before overwriting the open space for good */
export function useDestroyPrivateSpace() {
  const { confirm, toast } = useUi()
  return async () => {
    const sure = await confirm({ title: '删除这个隐私空间？', message: '里面的桌面、书签和待办会被随机数据覆盖，无法恢复。其他隐私空间和普通书签不受影响。', confirmText: '永久删除', danger: true })
    if (!sure) return
    try { await privateSpace.destroy() } catch (error) { toast(messageOf(error), 'error') }
  }
}

/** The lock in the top bar: the way in while nothing is open, and the way out while a space is */
export function PrivateSpaceButton({ onAction, className = '' }: { onAction: (action: PrivateAction) => void; className?: string }) {
  const active = usePrivateActive()
  const menu = usePopover<HTMLDivElement>()
  const destroy = useDestroyPrivateSpace()
  const item = 'flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm transition hover:bg-fg/6 focus-visible:bg-fg/6'
  if (!active) {
    return (
      <button className={`icon-btn ${className}`} title="隐私空间（Alt+P）" aria-label="隐私空间" onClick={() => onAction('unlock')}>
        <Lock size={16} />
      </button>
    )
  }
  return (
    <div ref={menu.ref} className={`relative shrink-0 ${className}`}>
      <button
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-control bg-accent-solid px-2.5 text-xs font-semibold whitespace-nowrap text-accent-fg transition outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/50"
        title="隐私空间已打开（Alt+P 立即锁定）"
        aria-label="隐私空间已打开"
        aria-expanded={menu.open}
        onClick={() => menu.setOpen(!menu.open)}
      >
        <EyeOff size={15} className="shrink-0" />
        <span className="max-lg:hidden">隐私空间</span>
      </button>
      {menu.open && (
        <div className="popover-panel absolute top-11 right-0 z-40 w-48 animate-rise p-1.5 [animation-duration:0.15s]">
          <button className={item} onClick={() => { menu.setOpen(false); privateSpace.lock() }}>
            <LockOpen size={15} className="text-muted" />
            <span className="flex-1">锁定</span>
            <kbd className="font-mono text-xs text-faint">Alt+P</kbd>
          </button>
          <button className={item} onClick={() => { menu.setOpen(false); onAction('password') }}>
            <KeyRound size={15} className="text-muted" />
            修改密码
          </button>
          <button className={`${item} text-danger`} onClick={() => { menu.setOpen(false); void destroy() }}>
            <Trash2 size={15} />
            删除此空间
          </button>
        </div>
      )}
    </div>
  )
}
