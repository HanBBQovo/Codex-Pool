import { createContext } from 'react'

import type { Theme } from '@/lib/theme-preferences'

export interface ThemeProviderState {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

export const ThemeContext = createContext<ThemeProviderState>({
  theme: 'system',
  resolvedTheme: 'dark',
  setTheme: () => {},
})
