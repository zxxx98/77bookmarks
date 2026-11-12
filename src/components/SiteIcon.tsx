import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useState, type CSSProperties } from 'react'
import type { Site } from '../../shared/types'
import { hostOf } from '../../shared/url'
import { useIsDark, useStyle, type StyleId } from '../theme'

function hueOf(text: string): number {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 360
}

function avatarStyle(styleId: StyleId, hue: number, dark: boolean): CSSProperties {
  if (styleId === 'swiss') {
    return {
      background: 'var(--fg)',
      color: 'var(--bg)',
      border: '1px solid var(--fg)',
    }
  }
  if (styleId === 'linear') {
    return {
      background: 'var(--surface-2)',
      color: 'var(--fg)',
      border: '1px solid var(--line)',
    }
  }
  if (styleId === 'brutalist') {
    return {
      background: dark ? `hsl(${hue} 42% 30%)` : `hsl(${hue} 58% 86%)`,
      color: dark ? '#f3f1ec' : '#1e242b',
      border: 'var(--border-w) solid var(--line)',
    }
  }
  // Default: 'paper' — warm botanical / mineral paper stamp
  return {
    background: dark ? `hsl(${hue} 18% 22%)` : `hsl(${hue} 24% 90%)`,
    color: dark ? `hsl(${hue} 28% 80%)` : `hsl(${hue} 32% 28%)`,
    border: dark ? `1px solid hsl(${hue} 18% 30%)` : `1px solid hsl(${hue} 22% 81%)`,
  }
}

/** Shows the custom icon address, then the stored icon, then a letter avatar, moving on when an image fails to load */
export function SiteIcon({ site, size = 40 }: { site: Pick<Site, 'id' | 'origin' | 'title' | 'iconVersion' | 'iconUrl'>; size?: number }) {
  const [failed, setFailed] = useState<string[]>([])
  const [styleId] = useStyle()
  const dark = useIsDark()
  const cached = useQuery({ queryKey: ['icon', site.id, site.iconVersion], queryFn: () => api.icon(site.id), enabled: site.iconVersion > 0, staleTime: Infinity })
  const stored = cached.data
  const src = [site.iconUrl, stored].find((source) => source && !failed.includes(source))
  const borderRadius = styleId === 'swiss' ? 0 : Math.round(size * 0.22)
  const boxStyle: CSSProperties = { width: size, height: size, borderRadius }

  if (src) {
    return (
      <span
        className="grid shrink-0 place-items-center overflow-hidden bg-white dark:bg-white/95"
        style={{ ...boxStyle, border: 'var(--border-w) solid var(--line)' }}
      >
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          // Custom icons live on other sites, which don't need to know where they are shown
          referrerPolicy="no-referrer"
          className="size-[70%] object-contain"
          onError={() => setFailed((list) => [...list, src])}
        />
      </span>
    )
  }

  const hue = hueOf(hostOf(site.origin))
  const useMono = styleId === 'linear' || styleId === 'swiss'
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center font-semibold uppercase ${useMono ? 'font-mono' : ''}`}
      style={{
        ...boxStyle,
        fontSize: Math.round(size * 0.43),
        ...avatarStyle(styleId, hue, dark),
      }}
    >
      {[...site.title.trim()][0] ?? '?'}
    </span>
  )
}
