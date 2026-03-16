type CapabilityLike = {
  features: {
    multi_tenant: boolean
  }
}

type MenuGroupLike<TItem extends { path: string }> = {
  items: TItem[]
}

export function shouldShowStandaloneAdminApiKeys(capabilities?: CapabilityLike): boolean {
  return !(capabilities?.features.multi_tenant ?? true)
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
        if (item.path === '/api-keys') {
          return showStandaloneAdminApiKeys
        }
        return true
      }),
    }))
    .filter((group) => group.items.length > 0) as TGroup[]
}
