export type DrawerPlacement = 'bottom' | 'right' | 'left' | 'top'
export type ThemeRadius = 'compact' | 'default' | 'relaxed'
export type ThemeDensity = 'compact' | 'comfortable'

export const DEFAULT_DRAWER_PLACEMENT: DrawerPlacement = 'bottom'
export const DEFAULT_THEME_RADIUS: ThemeRadius = 'default'
export const DEFAULT_THEME_DENSITY: ThemeDensity = 'comfortable'

const VALID_DRAWER_PLACEMENTS = new Set<DrawerPlacement>(['bottom', 'right', 'left', 'top'])
const VALID_THEME_RADII = new Set<ThemeRadius>(['compact', 'default', 'relaxed'])
const VALID_THEME_DENSITIES = new Set<ThemeDensity>(['compact', 'comfortable'])

export function readStoredDrawerPlacement(
  stored: string | null | undefined,
  fallback: DrawerPlacement = DEFAULT_DRAWER_PLACEMENT,
): DrawerPlacement {
  if (stored && VALID_DRAWER_PLACEMENTS.has(stored as DrawerPlacement)) {
    return stored as DrawerPlacement
  }
  return fallback
}

export function readStoredThemeRadius(
  stored: string | null | undefined,
  fallback: ThemeRadius = DEFAULT_THEME_RADIUS,
): ThemeRadius {
  if (stored && VALID_THEME_RADII.has(stored as ThemeRadius)) {
    return stored as ThemeRadius
  }
  return fallback
}

export function readStoredThemeDensity(
  stored: string | null | undefined,
  fallback: ThemeDensity = DEFAULT_THEME_DENSITY,
): ThemeDensity {
  if (stored && VALID_THEME_DENSITIES.has(stored as ThemeDensity)) {
    return stored as ThemeDensity
  }
  return fallback
}

export type UiPreferences = {
  drawerPlacement: DrawerPlacement
  themeDensity: ThemeDensity
  themeRadius: ThemeRadius
}
