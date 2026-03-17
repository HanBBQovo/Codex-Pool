import type { SystemCapabilitiesResponse } from '../api/types.ts'
import {
  LEGACY_STANDALONE_ADMIN_API_KEYS_PATH,
  STANDALONE_ADMIN_API_KEYS_PATH,
} from '../features/api-keys/admin-capabilities.ts'

export type AppShellTarget = 'loading' | 'tenant' | 'admin'

const CAPABILITY_GATED_ADMIN_PATHS = new Set([
  LEGACY_STANDALONE_ADMIN_API_KEYS_PATH,
  STANDALONE_ADMIN_API_KEYS_PATH,
  '/tenants',
])

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') {
    return '/'
  }

  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

export function resolveAppShellTarget(
  pathname: string,
  capabilities?: SystemCapabilitiesResponse,
): AppShellTarget {
  const normalizedPathname = normalizePathname(pathname)
  const isTenantPath =
    normalizedPathname === '/tenant' || normalizedPathname.startsWith('/tenant/')

  if (!capabilities) {
    if (isTenantPath || CAPABILITY_GATED_ADMIN_PATHS.has(normalizedPathname)) {
      return 'loading'
    }

    return 'admin'
  }

  if (isTenantPath && capabilities.features.tenant_portal) {
    return 'tenant'
  }

  return 'admin'
}
