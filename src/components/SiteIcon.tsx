import { useState } from 'react'
import type { Site } from '../../shared/types'
import { hostOf } from '../../shared/url'

function hueOf(text: string): number {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 360
}

/** Shows the custom icon address, then the stored icon, then a letter avatar, moving on when an image fails to load */
export function SiteIcon({ site, size = 40 }: { site: Pick<Site, 'id' | 'origin' | 'title' | 'iconVersion' | 'iconUrl'>; size?: number }) {
  const [failed, setFailed] = useState<string[]>([])
  const stored = site.iconVersion > 0 ? `/api/icon/${site.id}?v=${site.iconVersion}` : null
  const src = [site.iconUrl, stored].find((source) => source && !failed.includes(source))
  const style = { width: size, height: size, borderRadius: size * 0.26 }

  if (src) {
    return (
      <span className="grid shrink-0 place-items-center overflow-hidden border border-line bg-white" style={style}>
        <img
          key={src}
          src={src}
          alt=""
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
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center font-semibold text-white uppercase"
      style={{
        ...style,
        fontSize: size * 0.45,
        background: `linear-gradient(135deg, hsl(${hue} 70% 62%), hsl(${(hue + 40) % 360} 65% 48%))`,
      }}
    >
      {[...site.title.trim()][0] ?? '?'}
    </span>
  )
}
