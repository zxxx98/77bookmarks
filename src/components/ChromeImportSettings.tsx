import { FileCode2, LoaderCircle, Upload, X } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { backupStats } from '../../shared/backup'
import type { DesktopSummary } from '../../shared/types'
import { api } from '../api'
import { chromeRows, parseChromeBookmarks, type ChromeImport } from '../chrome-import'
import { useUi } from '../ui'

interface Props {
  desktops: DesktopSummary[]
  onImported: (desktopId: number) => void
  onClose: () => void
  onBusyChange: (busy: boolean) => void
  importBusy: boolean
}

const BATCH_SIZE = 20

export function ChromeImportSettings({ desktops, onImported, onClose, onBusyChange, importBusy }: Props) {
  const { toast } = useUi()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; data: ChromeImport } | null>(null)
  const [stage, setStage] = useState<'idle' | 'reading' | 'parsing' | 'importing'>('idle')
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const busy = stage !== 'idle'

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen || busy || importBusy) return
    setFile(null)
    setStage('reading')
    onBusyChange(true)
    setDone(0)
    setTotal(0)
    try {
      // Let the reading state render before parsing a large HTML document.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const html = await chosen.text()
      setStage('parsing')
      const data = await parseChromeBookmarks(html, (count, size) => {
        setDone(count)
        setTotal(size)
      })
      setFile({ name: chosen.name, data })
    } catch (error) {
      toast(error instanceof Error ? error.message : '读取 Chrome 书签失败', 'error')
    } finally {
      setStage('idle')
      onBusyChange(false)
    }
  }

  const runImport = async () => {
    if (!file || busy || importBusy) return
    const groups = file.data.desktop.groups
    const rowCount = backupStats([file.data.desktop])
    const expectedRows = rowCount.sites + rowCount.links
    let desktopId = 0
    setStage('importing')
    onBusyChange(true)
    setDone(0)
    setTotal(groups.length + expectedRows)
    try {
      const created = await api.createDesktop(file.data.desktop.name)
      desktopId = created.id
      const groupIds: number[] = []
      for (let offset = 0; offset < groups.length; offset += BATCH_SIZE) {
        const batch = groups.slice(offset, offset + BATCH_SIZE)
        const result = await api.importChromeGroups(desktopId, offset, batch.map((group) => group.name))
        if (result.groupIds.length !== batch.length) throw new Error('分组导入不完整')
        groupIds.push(...result.groupIds)
        setDone(groupIds.length)
      }
      const rows = chromeRows(file.data.desktop, groupIds)
      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        await api.importChromeRows(desktopId, rows.slice(offset, offset + BATCH_SIZE))
        setDone(groups.length + Math.min(offset + BATCH_SIZE, rows.length))
      }
      toast(`已导入 ${rowCount.sites} 张卡片、${rowCount.links} 个链接${file.data.skipped ? `，跳过 ${file.data.skipped} 个非网页或无效网址` : ''}`)
      onBusyChange(false)
      setStage('idle')
      onImported(desktopId)
      onClose()
    } catch (error) {
      let rollbackFailed = false
      if (desktopId) {
        try {
          await api.deleteDesktop(desktopId)
        } catch {
          rollbackFailed = true
        }
      }
      toast(`${error instanceof Error ? error.message : '导入失败'}${rollbackFailed ? '；清理未完成，请手动删除新建的 Chrome 桌面' : '；本次导入已清理'}`, 'error')
      setStage('idle')
      onBusyChange(false)
    }
  }

  const stats = file && backupStats([file.data.desktop])
  const progress = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <section className="border-t border-line pt-4">
      <h3 className="label">导入 Chrome 书签</h3>
      <p className="mb-2.5 text-xs leading-relaxed text-faint">在 Chrome 的书签管理器中导出 HTML 文件，再选择该文件。书签会添加为新桌面，嵌套文件夹会成为分组；图标不会导入。</p>
      <input ref={input} type="file" accept=".html,.htm,text/html" disabled={importBusy} hidden onChange={chooseFile} />
      {!file ? (
        <button
          className="flex w-full flex-col items-center gap-1.5 rounded-control border border-dashed border-line px-4 py-5 text-sm text-muted transition outline-none hover:border-accent/50 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/50"
          disabled={importBusy}
          onClick={() => input.current?.click()}
        >
          {busy ? <LoaderCircle size={18} className="animate-spin" /> : <Upload size={18} />}
          {stage === 'reading' ? '正在读取文件…' : stage === 'parsing' ? '正在解析书签…' : '选择 Chrome 导出的 HTML 文件'}
        </button>
      ) : (
        <>
          <div className="flex items-start gap-3 rounded-control border border-line bg-surface-2/60 p-3">
            <FileCode2 size={18} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">{file.name}</p>
              <p className="mt-0.5 text-xs text-muted">{file.data.desktop.groups.length} 个分组 · {stats?.sites} 张卡片 · {stats?.links} 个链接</p>
              {file.data.skipped > 0 && <p className="mt-1 text-xs text-muted">已跳过 {file.data.skipped} 个非网页或无效网址</p>}
            </div>
            <button className="icon-btn-sm -mt-1 -mr-1" aria-label="换一个文件" disabled={importBusy} onClick={() => setFile(null)}><X size={15} /></button>
          </div>
          <p className="mt-2 text-xs text-faint">同一网站合并为一张卡片；如果它出现在多个文件夹，卡片放在首次出现的分组中。</p>
          <div className="mt-4 flex justify-end">
            <button className="btn btn-primary" disabled={importBusy || desktops.length >= 20} onClick={runImport}>
              {stage === 'importing' && <LoaderCircle size={15} className="animate-spin" />}
              导入为新桌面
            </button>
          </div>
          {desktops.length >= 20 && <p className="mt-2 text-xs text-danger">已达到 20 个桌面的上限，请先删除一个桌面。</p>}
        </>
      )}
      {busy && (
        <div className="mt-3" role="status" aria-live="polite">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>{stage === 'importing' ? `正在导入 ${done} / ${total} 条记录` : stage === 'parsing' ? `正在解析 ${done} / ${total} 个书签` : '正在读取文件'}</span>
            {total > 0 && <span>{progress}%</span>}
          </div>
          <div
            className="import-progress-track"
            role="progressbar"
            aria-label="Chrome 书签导入进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={total ? progress : undefined}
          >
            <div className={`import-progress-fill ${total ? '' : 'is-indeterminate'}`} style={total ? { width: `${progress}%` } : undefined} />
          </div>
        </div>
      )}
    </section>
  )
}
