import { tenantApiClient } from './tenantClient'
import type { ApiKeyGroupBindingItem } from './groups'

export interface TenantApiKeyRecord {
  id: string
  tenant_id: string
  name: string
  key_prefix: string
  enabled: boolean
  created_at: string
  ip_allowlist: string[]
  model_allowlist: string[]
  group_id: string
  group: ApiKeyGroupBindingItem
}

export interface TenantCreateApiKeyResponse {
  record: TenantApiKeyRecord
  plaintext_key: string
}

export const tenantKeysApi = {
  list: async () => {
    const response = await tenantApiClient.get<TenantApiKeyRecord[]>('/keys')
    return response.data
  },

  create: async (payload: {
    name: string
    ip_allowlist: string[]
    model_allowlist?: string[]
    group_id?: string
  }) => {
    const response = await tenantApiClient.post<TenantCreateApiKeyResponse>('/keys', payload)
    return response.data
  },

  patch: (
    keyId: string,
    payload: { enabled?: boolean; ip_allowlist?: string[]; model_allowlist?: string[]; group_id?: string },
  ) =>
    tenantApiClient
      .patch<TenantApiKeyRecord>(`/keys/${keyId}`, payload)
      .then((response) => response.data),

  remove: async (keyId: string) => {
    await tenantApiClient.delete<void>(`/keys/${keyId}`)
  },
}
