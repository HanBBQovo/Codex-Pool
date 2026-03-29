import { useEffect, useState } from 'react'

import { UiPreferencesContext } from './ui-preferences-context'
import {
  DEFAULT_DRAWER_PLACEMENT,
  DEFAULT_THEME_DENSITY,
  DEFAULT_THEME_RADIUS,
  readStoredDrawerPlacement,
  readStoredThemeDensity,
  readStoredThemeRadius,
  type DrawerPlacement,
  type ThemeDensity,
  type ThemeRadius,
} from '@/lib/ui-preferences'

interface UiPreferencesProviderProps {
  children: React.ReactNode
  storageKeyPrefix?: string
}

export function UiPreferencesProvider({
  children,
  storageKeyPrefix = 'codex-ui-preferences',
}: UiPreferencesProviderProps) {
  const drawerPlacementStorageKey = `${storageKeyPrefix}.drawer-placement`
  const themeDensityStorageKey = `${storageKeyPrefix}.theme-density`
  const themeRadiusStorageKey = `${storageKeyPrefix}.theme-radius`

  const [drawerPlacement, setDrawerPlacementState] = useState<DrawerPlacement>(() => {
    if (typeof window === 'undefined') return DEFAULT_DRAWER_PLACEMENT
    return readStoredDrawerPlacement(
      localStorage.getItem(drawerPlacementStorageKey),
      DEFAULT_DRAWER_PLACEMENT,
    )
  })
  const [themeDensity, setThemeDensityState] = useState<ThemeDensity>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME_DENSITY
    return readStoredThemeDensity(
      localStorage.getItem(themeDensityStorageKey),
      DEFAULT_THEME_DENSITY,
    )
  })
  const [themeRadius, setThemeRadiusState] = useState<ThemeRadius>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME_RADIUS
    return readStoredThemeRadius(
      localStorage.getItem(themeRadiusStorageKey),
      DEFAULT_THEME_RADIUS,
    )
  })

  const setDrawerPlacement = (placement: DrawerPlacement) => {
    setDrawerPlacementState(placement)
    localStorage.setItem(drawerPlacementStorageKey, placement)
  }

  const setThemeDensity = (density: ThemeDensity) => {
    setThemeDensityState(density)
    localStorage.setItem(themeDensityStorageKey, density)
  }

  const setThemeRadius = (radius: ThemeRadius) => {
    setThemeRadiusState(radius)
    localStorage.setItem(themeRadiusStorageKey, radius)
  }

  useEffect(() => {
    const root = document.documentElement
    root.dataset.uiDensity = themeDensity
    root.dataset.uiRadius = themeRadius

    if (themeDensity === 'compact') {
      root.style.setProperty('--spacing', '0.235rem')
      root.style.setProperty('--app-page-padding', '0.875rem')
      root.style.setProperty('--app-page-padding-sm', '1.25rem')
      root.style.setProperty('--app-page-padding-lg', '1.25rem')
      root.style.setProperty('--app-panel-padding', '0.875rem')
      root.style.setProperty('--app-panel-padding-sm', '1rem')
      root.style.setProperty('--app-panel-padding-lg', '1rem')
    } else {
      root.style.setProperty('--spacing', '0.25rem')
      root.style.setProperty('--app-page-padding', '1rem')
      root.style.setProperty('--app-page-padding-sm', '1.5rem')
      root.style.setProperty('--app-page-padding-lg', '1.5rem')
      root.style.setProperty('--app-panel-padding', '1rem')
      root.style.setProperty('--app-panel-padding-sm', '1.25rem')
      root.style.setProperty('--app-panel-padding-lg', '1.25rem')
    }

    if (themeRadius === 'compact') {
      root.style.setProperty('--radius-sm', '0.2rem')
      root.style.setProperty('--radius-md', '0.325rem')
      root.style.setProperty('--radius-lg', '0.45rem')
      root.style.setProperty('--radius-xl', '0.65rem')
      root.style.setProperty('--radius-2xl', '0.85rem')
      root.style.setProperty('--heroui-radius-small', '6px')
      root.style.setProperty('--heroui-radius-medium', '10px')
      root.style.setProperty('--heroui-radius-large', '12px')
    } else if (themeRadius === 'relaxed') {
      root.style.setProperty('--radius-sm', '0.35rem')
      root.style.setProperty('--radius-md', '0.5rem')
      root.style.setProperty('--radius-lg', '0.75rem')
      root.style.setProperty('--radius-xl', '1rem')
      root.style.setProperty('--radius-2xl', '1.25rem')
      root.style.setProperty('--heroui-radius-small', '10px')
      root.style.setProperty('--heroui-radius-medium', '14px')
      root.style.setProperty('--heroui-radius-large', '18px')
    } else {
      root.style.setProperty('--radius-sm', '0.25rem')
      root.style.setProperty('--radius-md', '0.375rem')
      root.style.setProperty('--radius-lg', '0.5rem')
      root.style.setProperty('--radius-xl', '0.75rem')
      root.style.setProperty('--radius-2xl', '1rem')
      root.style.setProperty('--heroui-radius-small', '8px')
      root.style.setProperty('--heroui-radius-medium', '12px')
      root.style.setProperty('--heroui-radius-large', '14px')
    }
  }, [themeDensity, themeRadius])

  return (
    <UiPreferencesContext.Provider
      value={{
        drawerPlacement,
        setDrawerPlacement,
        themeDensity,
        setThemeDensity,
        themeRadius,
        setThemeRadius,
      }}
    >
      {children}
    </UiPreferencesContext.Provider>
  )
}
