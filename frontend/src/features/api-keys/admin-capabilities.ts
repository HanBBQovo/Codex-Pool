type CapabilityLike = {
  features: {
    multi_tenant: boolean
  }
}

type MenuGroupLike<TItem extends { path: string }> = {
  items: TItem[]
}

export const STANDALONE_ADMIN_API_KEYS_PATH = '/admin-api-keys'
export const LEGACY_STANDALONE_ADMIN_API_KEYS_PATH = '/access-keys'

export function shouldShowStandaloneAdminApiKeys(capabilities?: CapabilityLike): boolean {
  return !(capabilities?.features.multi_tenant ?? true)
}

export function resolveAdminCapabilityRedirect(
  path: string,
  capabilities?: CapabilityLike,
): string | null {
  const allowsMultiTenant = capabilities?.features.multi_tenant ?? true

  if (path === STANDALONE_ADMIN_API_KEYS_PATH && !shouldShowStandaloneAdminApiKeys(capabilities)) {
    return '/dashboard'
  }

  if (path === '/tenants' && !allowsMultiTenant) {
    return '/dashboard'
  }

  return null
}

export function filterAdminMenuGroupsByCapabilities<
  TItem extends { path: string },
  TGroup extends MenuGroupLike<TItem>,
>(groups: TGroup[], capabilities?: CapabilityLike): TGroup[] {
  const allowsMultiTenant = capabilities?.features.multi_tenant ?? true
  const showStandaloneAdminApiKeys = shouldShowStandaloneAdminApiKeys(capabilities)

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.path === '/tenants') {
          return allowsMultiTenant
        }
        if (item.path === STANDALONE_ADMIN_API_KEYS_PATH) {
          return showStandaloneAdminApiKeys
        }
        return true
      }),
    }))
    .filter((group) => group.items.length > 0) as TGroup[]
}
