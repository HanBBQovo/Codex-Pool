import { apiClient } from './client'
import { tenantApiClient } from './tenantClient'

export interface ApiKeyGroupBindingItem {
  id: string
  name: string
  is_default: boolean
  enabled: boolean
  allow_all_models: boolean
  deleted: boolean
  description?: string | null
}

export interface ApiKeyGroupModelPolicyItem {
  id: string
  model: string
  enabled: boolean
  input_multiplier_ppm: number
  cached_input_multiplier_ppm: number
  output_multiplier_ppm: number
  input_price_microcredits?: number | null
  cached_input_price_microcredits?: number | null
  output_price_microcredits?: number | null
  created_at: string
  updated_at: string
}

export interface ApiKeyGroupModelPreviewItem {
  model: string
  provider: string
  title?: string | null
  visibility?: string | null
  base_input_price_microcredits?: number | null
  base_cached_input_price_microcredits?: number | null
  base_output_price_microcredits?: number | null
  formula_input_price_microcredits?: number | null
  formula_cached_input_price_microcredits?: number | null
  formula_output_price_microcredits?: number | null
  final_input_price_microcredits?: number | null
  final_cached_input_price_microcredits?: number | null
  final_output_price_microcredits?: number | null
  uses_absolute_pricing: boolean
  policy?: ApiKeyGroupModelPolicyItem | null
}

export interface ApiKeyGroupCatalogItem {
  model: string
  provider: string
  title?: string | null
  visibility?: string | null
  base_input_price_microcredits?: number | null
  base_cached_input_price_microcredits?: number | null
  base_output_price_microcredits?: number | null
  base_price_source?: string | null
}

export interface ApiKeyGroupItem {
  id: string
  name: string
  description?: string | null
  is_default: boolean
  enabled: boolean
  allow_all_models: boolean
  input_multiplier_ppm: number
  cached_input_multiplier_ppm: number
  output_multiplier_ppm: number
  api_key_count: number
  model_count: number
  deleted_at?: string | null
  policies: ApiKeyGroupModelPolicyItem[]
  models: ApiKeyGroupModelPreviewItem[]
  created_at: string
  updated_at: string
}

export interface ApiKeyGroupAdminListResponse {
  groups: ApiKeyGroupItem[]
  catalog: ApiKeyGroupCatalogItem[]
}

export interface ApiKeyGroupUpsertRequest {
  id?: string
  name: string
  description?: string | null
  enabled: boolean
  is_default: boolean
  allow_all_models: boolean
  input_multiplier_ppm: number
  cached_input_multiplier_ppm: number
  output_multiplier_ppm: number
}

export interface ApiKeyGroupModelPolicyUpsertRequest {
  group_id: string
  model: string
  enabled: boolean
  input_multiplier_ppm: number
  cached_input_multiplier_ppm: number
  output_multiplier_ppm: number
  input_price_microcredits?: number | null
  cached_input_price_microcredits?: number | null
  output_price_microcredits?: number | null
}

export const groupsApi = {
  adminList: async () => {
    const response = await apiClient.get<ApiKeyGroupAdminListResponse>('/admin/api-key-groups')
    return response.data
  },
  adminUpsert: async (payload: ApiKeyGroupUpsertRequest) => {
    const response = await apiClient.post<ApiKeyGroupItem>('/admin/api-key-groups', payload)
    return response.data
  },
  adminDelete: (groupId: string) =>
    apiClient.delete<void>(`/admin/api-key-groups/${groupId}`),
  adminUpsertPolicy: async (payload: ApiKeyGroupModelPolicyUpsertRequest) => {
    const response = await apiClient.post<ApiKeyGroupModelPolicyItem>(
      '/admin/api-key-group-model-policies',
      payload,
    )
    return response.data
  },
  adminDeletePolicy: (policyId: string) =>
    apiClient.delete<void>(`/admin/api-key-group-model-policies/${policyId}`),
  tenantList: async () => {
    const response = await tenantApiClient.get<ApiKeyGroupItem[]>('/api-key-groups')
    return response.data
  },
}
