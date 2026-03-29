import { useEffect, useMemo, useState } from 'react'

import { ThemeContext } from './theme-context'
import { getSystemTheme, readStoredTheme, resolveTheme, type Theme } from '@/lib/theme-preferences'

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'codex-ui-theme',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return defaultTheme
    return readStoredTheme(localStorage.getItem(storageKey), defaultTheme)
  })

  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => getSystemTheme())
  const resolvedTheme = useMemo(() => resolveTheme(theme, systemTheme), [theme, systemTheme])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(resolvedTheme)
    root.dataset.theme = resolvedTheme
    root.dataset.themeMode = theme
    root.style.colorScheme = resolvedTheme
  }, [resolvedTheme, theme])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
    localStorage.setItem(storageKey, newTheme)
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
