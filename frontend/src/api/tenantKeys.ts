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
  list: () => tenantApiClient.get<TenantApiKeyRecord[]>('/keys'),

  create: (payload: { name: string; ip_allowlist: string[]; model_allowlist?: string[]; group_id?: string }) =>
    tenantApiClient.post<TenantCreateApiKeyResponse>('/keys', payload),

  patch: (
    keyId: string,
    payload: { enabled?: boolean; ip_allowlist?: string[]; model_allowlist?: string[]; group_id?: string }
  ) => tenantApiClient.patch<TenantApiKeyRecord>(`/keys/${keyId}`, payload),

  remove: (keyId: string) => tenantApiClient.delete<void>(`/keys/${keyId}`),
}
