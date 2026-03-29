import { createContext } from 'react'

import {
  DEFAULT_DRAWER_PLACEMENT,
  DEFAULT_THEME_DENSITY,
  DEFAULT_THEME_RADIUS,
  type DrawerPlacement,
  type ThemeDensity,
  type ThemeRadius,
} from '@/lib/ui-preferences'

export interface UiPreferencesContextValue {
  drawerPlacement: DrawerPlacement
  setDrawerPlacement: (placement: DrawerPlacement) => void
  themeDensity: ThemeDensity
  setThemeDensity: (density: ThemeDensity) => void
  themeRadius: ThemeRadius
  setThemeRadius: (radius: ThemeRadius) => void
}

export const UiPreferencesContext = createContext<UiPreferencesContextValue>({
  drawerPlacement: DEFAULT_DRAWER_PLACEMENT,
  setDrawerPlacement: () => {},
  themeDensity: DEFAULT_THEME_DENSITY,
  setThemeDensity: () => {},
  themeRadius: DEFAULT_THEME_RADIUS,
  setThemeRadius: () => {},
})
