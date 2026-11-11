import { Download, FileJson, LoaderCircle, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { backupStats, parseBackup, type ParsedBackup } from '../../shared/backup'
import type { Desktop, DesktopSummary, ImportMode } from '../../shared/types'
import { api } from '../api'
import { useAct, useUi } from '../ui'
import { ChromeImportSettings } from './ChromeImportSettings'

interface Props {
  onClose: () => void
  desktops: DesktopSummary[]
  desktop: Desktop
  /** Called with the first imported desktop once an import has finished */
  onImported: (desktopId: number) => void
  onBusyChange: (busy: boolean) => void
  importBusy: boolean
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Revoking right away can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const MODES: { value: ImportMode; label: string; hint: string }[] = [
  { value: 'append', label: '添加为新桌面', hint: '现有数据保持不变' },
  { value: 'replace', label: '替换全部数据', hint: '先清空现有的全部桌面' },
]

export function BackupSettings({ onClose, desktops, desktop, onImported, onBusyChange, importBusy }: Props) {
  const act = useAct()
  const { confirm, toast } = useUi()
  const fileInput = useRef<HTMLInputElement>(null)
  const [exporting, setExporting] = useState<'all' | 'one' | null>(null)
  const [file, setFile] = useState<{ name: string; raw: unknown; backup: ParsedBackup } | null>(null)
  const [mode, setMode] = useState<ImportMode>('append')
  const [importing, setImporting] = useState(false)
  // Lets an export that finishes after the dialog was closed skip its state update
  const mounted = useRef(true)
  useEffect(
    () => {
      mounted.current = true
      return () => {
        mounted.current = false
      }
    },
    [],
  )

  const exportBackup = async (scope: 'all' | 'one') => {
    if (importBusy) return
    setExporting(scope)
    try {
      const { blob, filename } = await api.exportBackup(scope === 'one' ? desktop.id : undefined)
      download(blob, filename)
    } catch (error) {
      toast(error instanceof Error ? error.message : '导出失败', 'error')
    }
    if (mounted.current) setExporting(null)
  }

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen || importBusy) return
    let raw: unknown
    try {
      raw = JSON.parse(await chosen.text())
    } catch {
      return toast('不是有效的备份文件', 'error')
    }
    const backup = parseBackup(raw, chosen.name.replace(/\.json$/i, '').slice(0, 20))
    if ('error' in backup) return toast(backup.error, 'error')
    // The normalized form is what gets sent, so that a version 1 backup keeps the desktop name picked here
    setFile({ name: chosen.name, raw: { version: 2, desktops: backup.desktops }, backup })
  }

  const runImport = async () => {
    if (!file || importing || importBusy) return
    if (mode === 'replace') {
      const ok = await confirm({
        title: '替换全部数据？',
        message: `现有的 ${desktops.length} 个桌面及其全部分组、卡片和链接会被备份文件中的内容替换，且无法撤销。`,
        confirmText: '替换现有数据',
        danger: true,
      })
      if (!ok) return
    }
    setImporting(true)
    onBusyChange(true)
    let firstDesktop = 0
    const ok = await act(async () => {
      const result = await api.importBackup(file.raw, mode)
      firstDesktop = result.desktopIds[0]
      toast(`已导入 ${result.desktopIds.length} 个桌面、${result.sites} 张卡片`)
    })
    if (!mounted.current) return
    setImporting(false)
    onBusyChange(false)
    if (!ok) return
    onImported(firstDesktop)
    onClose()
  }

  const stats = file && backupStats(file.backup.desktops)
  const exportedAt = file?.backup.exportedAt ? new Date(file.backup.exportedAt) : null

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h3 className="label">导出</h3>
        <p className="mb-2.5 text-xs leading-relaxed text-faint">备份是一个 JSON 文件，包含桌面、分组、卡片、链接和图标。</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-soft" disabled={exporting !== null || importBusy} onClick={() => exportBackup('all')}>
            {exporting === 'all' ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}
            {desktops.length > 1 ? `全部 ${desktops.length} 个桌面` : '导出备份'}
          </button>
          {desktops.length > 1 && (
            <button className="btn btn-soft min-w-0 shrink" disabled={exporting !== null || importBusy} onClick={() => exportBackup('one')}>
              {exporting === 'one' ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}
              <span className="truncate">仅「{desktop.name}」</span>
            </button>
          )}
        </div>
      </section>

      <section className="border-t border-line pt-4">
        <h3 className="label">导入</h3>
        <input ref={fileInput} type="file" accept="application/json,.json" disabled={importBusy} hidden onChange={chooseFile} />
        {!file || !stats ? (
          <button
            className="flex w-full flex-col items-center gap-1.5 rounded-control border border-dashed border-line px-4 py-6 text-sm text-muted transition outline-none hover:border-accent/50 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/50"
            disabled={importBusy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={18} />
            选择备份文件
          </button>
        ) : (
          <>
            <div className="flex items-start gap-3 rounded-control border-[length:var(--border-w)] border-line bg-surface-2/60 p-3">
              <FileJson size={18} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-mono font-medium">{file.name}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {stats.desktops} 个桌面 · {stats.sites} 张卡片 · {stats.links} 个链接
                  {exportedAt && !Number.isNaN(exportedAt.getTime()) && ` · 导出于 ${exportedAt.toLocaleDateString()}`}
                </p>
                <p className="mt-1.5 flex flex-wrap gap-1">
                  {file.backup.desktops.map((item, index) => (
                    <span key={index} className="max-w-full truncate rounded-pill bg-fg/6 px-2 py-0.5 text-xs text-muted">
                      {item.name}
                    </span>
                  ))}
                </p>
              </div>
              <button className="icon-btn-sm -mt-1 -mr-1" aria-label="换一个文件" disabled={importBusy} onClick={() => setFile(null)}>
                <X size={15} />
              </button>
            </div>

            <div role="radiogroup" aria-label="导入方式" className="mt-3 grid grid-cols-2 gap-2">
              {MODES.map((option) => (
                <button
                  key={option.value}
                  role="radio"
                  aria-checked={option.value === mode}
                  disabled={importBusy}
                  className={`rounded-control border-[length:var(--border-w)] px-3 py-2 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                    option.value !== mode
                      ? 'border-line hover:bg-fg/4'
                      : option.value === 'replace'
                        ? 'border-danger/50 bg-danger/8'
                        : 'border-accent/60 bg-accent-soft'
                  }`}
                  onClick={() => setMode(option.value)}
                >
                  <span className={`block text-sm font-medium ${option.value !== mode ? '' : option.value === 'replace' ? 'text-danger' : 'text-accent'}`}>{option.label}</span>
                  <span className="block text-xs text-muted">{option.hint}</span>
                </button>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <button className={`btn ${mode === 'replace' ? 'btn-danger' : 'btn-primary'}`} disabled={importBusy} onClick={runImport}>
                {importing && <LoaderCircle size={15} className="animate-spin" />}
                {mode === 'replace' ? '替换并导入' : '导入'}
              </button>
            </div>
          </>
        )}
      </section>
      <ChromeImportSettings desktops={desktops} onImported={onImported} onClose={onClose} onBusyChange={onBusyChange} importBusy={importBusy} />
    </div>
  )
}
