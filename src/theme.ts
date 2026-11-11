import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const systemDark = matchMedia('(prefers-color-scheme: dark)')

function stored(): Theme {
  const value = localStorage.getItem('theme')
  return value === 'light' || value === 'dark' ? value : 'system'
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && systemDark.matches))
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(stored)

  useEffect(() => {
    apply(theme)
    if (theme === 'system') localStorage.removeItem('theme')
    else localStorage.setItem('theme', theme)

    const onChange = () => apply(theme)
    systemDark.addEventListener('change', onChange)
    return () => systemDark.removeEventListener('change', onChange)
  }, [theme])

  return [theme, setTheme]
}
