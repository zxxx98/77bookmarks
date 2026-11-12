import { LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Dialog, useAct } from '../ui'

export function CreateGroupDialog({ desktop, onClose, onCreated }: {
  desktop: { id: number; name: string }
  onClose: () => void
  onCreated: () => void
}) {
  const act = useAct()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    const ok = await act(() => api.createGroup(desktop.id, name.trim()), `已创建分组「${name.trim()}」`)
    setBusy(false)
    if (ok) onCreated()
  }

  return (
    <Dialog open onClose={onClose} closeDisabled={busy} title="新建分组" width="max-w-sm">
      <form onSubmit={submit}>
        <p className="mb-4 text-sm text-muted">添加到桌面「{desktop.name}」</p>
        <label className="label" htmlFor="new-group-name">分组名称</label>
        <input
          id="new-group-name"
          className="input"
          placeholder="例如 工作、学习"
          autoFocus
          maxLength={40}
          disabled={busy}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-soft" disabled={busy} onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={!name.trim() || busy}>
            {busy && <LoaderCircle size={15} className="animate-spin" />}
            创建
          </button>
        </div>
      </form>
    </Dialog>
  )
}
