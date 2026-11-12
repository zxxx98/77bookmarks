import { preferences } from './preferences'
import { useSyncExternalStore } from 'react'

export type Theme = 'system' | 'light' | 'dark'
export type StyleId = 'paper' | 'linear' | 'swiss' | 'brutalist'

export interface StylePalette {
  bg: string
  surface: string
  surface2: string
  line: string
  lineStrong: string
  fg: string
  muted: string
  faint: string
  accent: string
  accentSolid: string
  accentFg: string
  accentSoft: string
  danger: string
  cardShadow: string
  cardShadowHover: string
  popShadow: string
}

export interface StyleShape {
  radiusCard: string
  radiusControl: string
  radiusPill: string
  borderWidth: string
  cardHoverX: string
  cardHoverY: string
  btnShadow: string
  chipBorder: string
  fontDisplay: string
}

export interface StylePreset {
  id: StyleId
  name: string
  tag: string
  description: string
  /** Four preview colors [bg, surface, accent, fg] shown in the style switcher */
  swatches: [string, string, string, string]
  shape: StyleShape
  light: StylePalette
  dark: StylePalette
}

const FONT_SANS = "'Inter Variable', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif"
const FONT_SERIF = "'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', Georgia, 'Times New Roman', serif"

/**
 * Declarative configuration for all 4 UI styles.
 * Add or tweak tokens here to customize any style's colors, typography, radii, and elevation.
 */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'paper',
    name: '温润纸感',
    tag: 'Notion / 北欧',
    description: '暖白亚麻纸底配炭墨字与鼠尾草绿，温润耐看',
    swatches: ['#f6f4ef', '#ffffff', '#3b6956', '#242320'],
    shape: {
      radiusCard: '0.625rem',
      radiusControl: '0.5rem',
      radiusPill: '0.375rem',
      borderWidth: '1px',
      cardHoverX: '0px',
      cardHoverY: '-1px',
      btnShadow: '0 1px 2px rgb(36 35 32 / 0.08)',
      chipBorder: 'transparent',
      fontDisplay: FONT_SANS,
    },
    light: {
      bg: '#f6f4ef',
      surface: '#ffffff',
      surface2: '#edeae2',
      line: '#e2ddd3',
      lineStrong: '#c9c2b5',
      fg: '#242320',
      muted: '#6b675e',
      faint: '#9b9589',
      accent: '#3b6956',
      accentSolid: '#262522',
      accentFg: '#faf8f5',
      accentSoft: 'rgb(59 105 86 / 0.12)',
      danger: '#c43c35',
      cardShadow: '0 1px 2px rgb(36 35 32 / 0.04)',
      cardShadowHover: '0 6px 18px rgb(36 35 32 / 0.07)',
      popShadow: '0 10px 28px rgb(36 35 32 / 0.12), 0 2px 6px rgb(36 35 32 / 0.06)',
    },
    dark: {
      bg: '#151513',
      surface: '#1e1e1b',
      surface2: '#282723',
      line: '#33312b',
      lineStrong: '#4a473f',
      fg: '#eceae3',
      muted: '#9e998e',
      faint: '#6e6a60',
      accent: '#7cb39b',
      accentSolid: '#3b6956',
      accentFg: '#faf8f5',
      accentSoft: 'rgb(124 179 155 / 0.16)',
      danger: '#e06560',
      cardShadow: '0 1px 2px rgb(0 0 0 / 0.25)',
      cardShadowHover: '0 8px 24px rgb(0 0 0 / 0.4)',
      popShadow: '0 20px 50px rgb(0 0 0 / 0.55)',
    },
  },
  {
    id: 'linear',
    name: '精密工作台',
    tag: 'Linear / 极客',
    description: '纯正中性灰阶、1px 锐利微边框与等宽字体细节',
    swatches: ['#09090b', '#18181b', '#2563eb', '#f4f4f5'],
    shape: {
      radiusCard: '0.5rem',
      radiusControl: '0.375rem',
      radiusPill: '0.25rem',
      borderWidth: '1px',
      cardHoverX: '0px',
      cardHoverY: '0px',
      btnShadow: '0 1px 1px rgb(0 0 0 / 0.06)',
      chipBorder: 'var(--line)',
      fontDisplay: FONT_SANS,
    },
    light: {
      bg: '#fafafa',
      surface: '#ffffff',
      surface2: '#f1f1f4',
      line: '#e4e4e7',
      lineStrong: '#b8b8c2',
      fg: '#09090b',
      muted: '#52525b',
      faint: '#8e8e99',
      accent: '#2563eb',
      accentSolid: '#18181b',
      accentFg: '#fafafa',
      accentSoft: 'rgb(37 99 235 / 0.1)',
      danger: '#dc2626',
      cardShadow: '0 1px 2px rgb(9 9 11 / 0.03)',
      cardShadowHover: '0 4px 12px rgb(9 9 11 / 0.06)',
      popShadow: '0 12px 32px rgb(9 9 11 / 0.12), 0 2px 6px rgb(9 9 11 / 0.06)',
    },
    dark: {
      bg: '#09090b',
      surface: '#121215',
      surface2: '#1c1c21',
      line: 'rgb(255 255 255 / 0.08)',
      lineStrong: 'rgb(255 255 255 / 0.18)',
      fg: '#f4f4f5',
      muted: '#a1a1aa',
      faint: '#63636e',
      accent: '#60a5fa',
      accentSolid: '#f4f4f5',
      accentFg: '#09090b',
      accentSoft: 'rgb(96 165 250 / 0.15)',
      danger: '#f87171',
      cardShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.04)',
      cardShadowHover: 'inset 0 1px 0 rgb(255 255 255 / 0.08), 0 8px 24px rgb(0 0 0 / 0.45)',
      popShadow: '0 24px 60px rgb(0 0 0 / 0.65)',
    },
  },
  {
    id: 'swiss',
    name: '瑞士目录',
    tag: 'Swiss / 报刊',
    description: '零圆角理性网格、衬线标题排版与唯一国际橙信号色',
    swatches: ['#f3f2ed', '#141413', '#e03c11', '#faf9f5'],
    shape: {
      radiusCard: '0px',
      radiusControl: '0px',
      radiusPill: '0px',
      borderWidth: '1px',
      cardHoverX: '0px',
      cardHoverY: '0px',
      btnShadow: 'none',
      chipBorder: 'var(--line)',
      fontDisplay: FONT_SERIF,
    },
    light: {
      bg: '#f3f2ed',
      surface: '#faf9f5',
      surface2: '#e8e6df',
      line: 'rgb(20 20 19 / 0.2)',
      lineStrong: '#141413',
      fg: '#141413',
      muted: '#52504c',
      faint: '#827e77',
      accent: '#e03c11',
      accentSolid: '#e03c11',
      accentFg: '#ffffff',
      accentSoft: 'rgb(224 60 17 / 0.1)',
      danger: '#c81e1e',
      cardShadow: 'none',
      cardShadowHover: 'none',
      popShadow: '0 12px 30px rgb(20 20 19 / 0.14)',
    },
    dark: {
      bg: '#10100f',
      surface: '#171715',
      surface2: '#22211e',
      line: 'rgb(245 243 238 / 0.18)',
      lineStrong: '#f5f3ee',
      fg: '#f5f3ee',
      muted: '#a39f96',
      faint: '#6e6b64',
      accent: '#ff5a2d',
      accentSolid: '#ff5a2d',
      accentFg: '#10100f',
      accentSoft: 'rgb(255 90 45 / 0.15)',
      danger: '#f05252',
      cardShadow: 'none',
      cardShadowHover: 'none',
      popShadow: '0 20px 50px rgb(0 0 0 / 0.65)',
    },
  },
  {
    id: 'brutalist',
    name: '柔和野兽派',
    tag: 'Neo-Brutalist',
    description: '实线深色描边与硬边偏移阴影，真实按键按压手感',
    swatches: ['#f2efe9', '#fffdf9', '#e06338', '#1e242b'],
    shape: {
      radiusCard: '0.5rem',
      radiusControl: '0.375rem',
      radiusPill: '9999px',
      borderWidth: '1.5px',
      cardHoverX: '1.5px',
      cardHoverY: '1.5px',
      btnShadow: '2px 2px 0px var(--line)',
      chipBorder: 'var(--line)',
      fontDisplay: FONT_SANS,
    },
    light: {
      bg: '#f2efe9',
      surface: '#fffdf9',
      surface2: '#e9e4d8',
      line: '#1e242b',
      lineStrong: '#1e242b',
      fg: '#1e242b',
      muted: '#4d5661',
      faint: '#78818c',
      accent: '#c85228',
      accentSolid: '#e06338',
      accentFg: '#ffffff',
      accentSoft: '#fde5d6',
      danger: '#d9383a',
      cardShadow: '3px 3px 0px #1e242b',
      cardShadowHover: '1.5px 1.5px 0px #1e242b',
      popShadow: '4px 4px 0px #1e242b',
    },
    dark: {
      bg: '#16181d',
      surface: '#20232a',
      surface2: '#2b2f38',
      line: '#525a69',
      lineStrong: '#8b95a7',
      fg: '#f3f1ec',
      muted: '#a6adb9',
      faint: '#707885',
      accent: '#f48c66',
      accentSolid: '#e06338',
      accentFg: '#ffffff',
      accentSoft: 'rgb(244 140 102 / 0.2)',
      danger: '#f06264',
      cardShadow: '3px 3px 0px #525a69',
      cardShadowHover: '1.5px 1.5px 0px #8b95a7',
      popShadow: '4px 4px 0px #525a69',
    },
  },
]

const THEME_KEY = 'theme'
const STYLE_KEY = 'style'
const DEFAULT_STYLE: StyleId = 'paper'

const systemDark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

function storedTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'system'
  const value = localStorage.getItem(THEME_KEY)
  return value === 'light' || value === 'dark' ? value : 'system'
}

function storedStyle(): StyleId {
  if (typeof localStorage === 'undefined') return DEFAULT_STYLE
  const value = localStorage.getItem(STYLE_KEY)
  return STYLE_PRESETS.some((p) => p.id === value) ? (value as StyleId) : DEFAULT_STYLE
}

let currentTheme: Theme = storedTheme()
let currentStyle: StyleId = storedStyle()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function paletteVars(p: StylePalette): string {
  return `
    --bg: ${p.bg};
    --surface: ${p.surface};
    --surface-2: ${p.surface2};
    --line: ${p.line};
    --line-strong: ${p.lineStrong};
    --fg: ${p.fg};
    --muted: ${p.muted};
    --faint: ${p.faint};
    --accent: ${p.accent};
    --accent-solid: ${p.accentSolid};
    --accent-fg: ${p.accentFg};
    --accent-soft: ${p.accentSoft};
    --danger: ${p.danger};
    --card-shadow: ${p.cardShadow};
    --card-shadow-hover: ${p.cardShadowHover};
    --pop-shadow: ${p.popShadow};
  `
}

function ensurePresetStylesheet() {
  if (typeof document === 'undefined' || document.getElementById('stylekit-presets')) return
  const styleEl = document.createElement('style')
  styleEl.id = 'stylekit-presets'
  styleEl.textContent = STYLE_PRESETS.map(
    (preset) => `
      :root[data-style="${preset.id}"] {
        --r-card: ${preset.shape.radiusCard};
        --r-control: ${preset.shape.radiusControl};
        --r-pill: ${preset.shape.radiusPill};
        --border-w: ${preset.shape.borderWidth};
        --card-hover-x: ${preset.shape.cardHoverX};
        --card-hover-y: ${preset.shape.cardHoverY};
        --btn-shadow: ${preset.shape.btnShadow};
        --chip-border: ${preset.shape.chipBorder};
        --font-display: ${preset.shape.fontDisplay};
        ${paletteVars(preset.light)}
      }
      :root[data-style="${preset.id}"].dark {
        ${paletteVars(preset.dark)}
      }
    `,
  ).join('\n')
  document.head.appendChild(styleEl)
}

function applyDom() {
  if (typeof document === 'undefined') return
  ensurePresetStylesheet()
  const isDark = currentTheme === 'dark' || (currentTheme === 'system' && (systemDark?.matches ?? false))
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.dataset.style = currentStyle
}

// Initialize immediately on module load
applyDom()
systemDark?.addEventListener('change', () => {
  applyDom()
  notify()
})

export function setTheme(theme: Theme) {
  currentTheme = theme
  if (theme === 'system') preferences.removeItem(THEME_KEY)
  else preferences.setItem(THEME_KEY, theme)
  applyDom()
  notify()
}

export function setStyle(style: StyleId) {
  currentStyle = style
  preferences.setItem(STYLE_KEY, style)
  applyDom()
  notify()
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, () => currentTheme)
  return [theme, setTheme]
}

export function useStyle(): [StyleId, (style: StyleId) => void, StylePreset] {
  const style = useSyncExternalStore(subscribe, () => currentStyle)
  const preset = STYLE_PRESETS.find((p) => p.id === style) ?? STYLE_PRESETS[0]
  return [style, setStyle, preset]
}

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, () => currentTheme === 'dark' || (currentTheme === 'system' && (systemDark?.matches ?? false)))
}

if (typeof window !== 'undefined') window.addEventListener('77bookmarks:preferences-restored', () => { currentTheme = storedTheme(); currentStyle = storedStyle(); applyDom(); notify() })
