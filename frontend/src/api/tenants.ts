import { adminTenantsApi, type AdminTenantItem } from './adminTenants.ts'

export type AdminTenant = AdminTenantItem

export const tenantsApi = {
  async list(): Promise<AdminTenant[]> {
    return adminTenantsApi.listTenants()
  },
}
