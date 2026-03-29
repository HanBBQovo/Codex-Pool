import { createAuthApiClient, extractApiErrorMessageFrom } from './httpClient'
import { getTenantAccessToken } from '@/lib/tenant-session'

export const TENANT_AUTH_REQUIRED_EVENT = 'cp:tenant-auth-required'
export const TENANT_LOGIN_FAILED_EVENT = 'cp:tenant-login-failed'

function isTenantAuthEndpoint(url?: string): boolean {
  if (!url) {
    return false
  }
  return (
    url.includes('/auth/login') ||
    url.includes('/auth/me') ||
    url.includes('/auth/logout') ||
    url.includes('/auth/register') ||
    url.includes('/auth/verify-email') ||
    url.includes('/auth/password/forgot') ||
    url.includes('/auth/password/reset')
  )
}

export const tenantApiClient = createAuthApiClient({
  baseURL: '/api/v1/tenant',
  timeout: 30_000,
  getAccessToken: getTenantAccessToken,
  isAuthEndpoint: isTenantAuthEndpoint,
  isLoginEndpoint: (url) => Boolean(url?.includes('/auth/login')),
  authRequiredEvent: TENANT_AUTH_REQUIRED_EVENT,
  loginFailedEvent: TENANT_LOGIN_FAILED_EVENT,
  unwrapResponseData: false,
})

export function extractTenantApiErrorMessage(error: unknown): string | null {
  return extractApiErrorMessageFrom(error)
}
