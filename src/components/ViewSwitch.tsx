import { Grid3x3, LayoutGrid, List } from 'lucide-react'
import type { View } from '../../shared/types'

export const VIEW_OPTIONS: { value: View; label: string; icon: typeof List }[] = [
  { value: 'large', label: '大卡片', icon: LayoutGrid },
  { value: 'small', label: '小卡片', icon: Grid3x3 },
  { value: 'list', label: '列表', icon: List },
]

export function ViewSwitch({ view, onView, className = '' }: { view: View; onView: (view: View) => void; className?: string }) {
  return (
    <div
      role="radiogroup"
      aria-label="显示方式"
      className={`flex h-9 shrink-0 items-center gap-0.5 rounded-control border-[length:var(--border-w)] border-line bg-surface-2 p-0.5 ${className}`}
    >
      {VIEW_OPTIONS.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={option.value === view}
          aria-label={option.label}
          title={option.label}
          className={`grid h-7 flex-1 place-items-center rounded-[calc(var(--r-control)-2px)] px-2 transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            option.value === view ? 'bg-surface text-accent shadow-xs' : 'text-muted hover:text-fg'
          }`}
          onClick={() => onView(option.value)}
        >
          <option.icon size={16} />
        </button>
      ))}
    </div>
  )
}
