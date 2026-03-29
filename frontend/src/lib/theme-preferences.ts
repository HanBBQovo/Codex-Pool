export type Theme = 'light' | 'dark' | 'system'

const VALID_THEMES = new Set<Theme>(['light', 'dark', 'system'])

export function readStoredTheme(stored: string | null | undefined, fallback: Theme): Theme {
  if (stored && VALID_THEMES.has(stored as Theme)) {
    return stored as Theme
  }
  return fallback
}

export function resolveTheme(theme: Theme, systemTheme: 'light' | 'dark'): 'light' | 'dark' {
  return theme === 'system' ? systemTheme : theme
}

export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') {
    return 'dark'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
