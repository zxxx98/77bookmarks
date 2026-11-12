import { Copy, KeyRound, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AccessTokenStatus } from '../../shared/types'
import type { Platform } from '../platform'
import { useUi } from '../ui'
import { formatAgo, formatDate } from '../usage'

/** Connects the right-click extension: hands out the connection code it needs, and takes it back */
export function ClipperSettings({ clipper }: { clipper: NonNullable<Platform['clipper']> }) {
  const { toast, confirm } = useUi()
  const [status, setStatus] = useState<AccessTokenStatus | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  // The token can't be read back from the server, so the code only exists until this panel closes
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const codeInput = useRef<HTMLInputElement>(null)

  const load = () => {
    setFailed(false)
    clipper.status().then(setStatus, () => setFailed(true))
  }
  useEffect(load, [clipper])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast(error instanceof Error ? error.message : '操作失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const generate = async () => {
    if (status) {
      const ok = await confirm({
        title: '重新生成连接码？',
        message: '已经连接的浏览器会立即断开，需要用新的连接码重新连接。',
        confirmText: '重新生成',
        danger: true,
      })
      if (!ok) return
    }
    await run(async () => {
      const created = await clipper.create()
      setCode(created.code)
      setStatus({ createdAt: created.createdAt, lastUsedAt: null })
    })
  }

  const revoke = async () => {
    const ok = await confirm({ title: '撤销连接码？', message: '已经连接的浏览器将不能再添加书签。', confirmText: '撤销', danger: true })
    if (!ok) return
    await run(async () => {
      await clipper.revoke()
      setCode(null)
      setStatus(null)
      toast('连接码已撤销')
    })
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code ?? '')
      toast('连接码已复制')
    } catch {
      // No clipboard access on plain http: leave the text selected for a manual copy
      codeInput.current?.select()
      toast('无法自动复制，请手动复制选中的内容', 'error')
    }
  }

  const now = Date.now()
  const mono = 'rounded-control border border-line px-1 font-mono text-xs'
  return (
    <div className="text-sm">
      <p className="leading-relaxed text-muted">安装右键插件后，在任意网页或链接上点右键，就能把它添加到这里。</p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 leading-relaxed text-muted">
        <li>
          在项目里运行 <code className={mono}>npm run build:clipper</code>，在 Chrome 或 Edge 打开 <code className={mono}>chrome://extensions</code>，开启「开发者模式」，点击「加载已解压的扩展程序」并选择 <code className={mono}>dist-clipper</code> 目录。
        </li>
        <li>在下面生成连接码，粘贴到插件的选项页。</li>
      </ol>

      <div className="mt-5 rounded-control border border-line bg-surface-2 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound size={15} className="shrink-0 text-muted" />
          <p className="min-w-0 flex-1" role="status">
            {failed ? '连接状态加载失败' : status === undefined ? '正在加载…' : status ? (
              <>
                连接码创建于 {formatDate(status.createdAt)}
                <span className="text-faint">，{status.lastUsedAt === null ? '还没有使用过' : `插件上次使用于${formatAgo(status.lastUsedAt, now)}`}</span>
              </>
            ) : '还没有连接码'}
          </p>
          {failed ? (
            <button className="btn btn-soft h-8" onClick={load}>重试</button>
          ) : (
            <>
              {status && <button className="btn btn-soft h-8" disabled={busy} onClick={() => void revoke()}>撤销</button>}
              <button className="btn btn-primary h-8" disabled={busy || status === undefined} onClick={() => void generate()}>
                {busy && <LoaderCircle size={14} className="animate-spin" />}
                {status ? '重新生成' : '生成连接码'}
              </button>
            </>
          )}
        </div>

        {code && (
          <div className="mt-3">
            <label className="label" htmlFor="connection-code">连接码</label>
            <div className="flex gap-2">
              <input
                ref={codeInput}
                id="connection-code"
                className="input h-9 flex-1 font-mono text-xs"
                value={code}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <button className="btn btn-soft" onClick={() => void copy()}>
                <Copy size={14} />
                复制
              </button>
            </div>
            <p className="mt-2 text-xs text-faint">只显示这一次，关闭后无法再查看；忘了可以重新生成。</p>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-faint">
        连接码只能读取桌面与分组、添加书签，不能修改、删除、导出数据或更改设置。同一时间只有一个连接码有效，多个浏览器可以共用它。
      </p>
    </div>
  )
}
