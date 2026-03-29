import { apiClient } from './client'

export interface AdminTenantItem {
  id: string
  name: string
  status: string
  plan: string
  expires_at?: string | null
  created_at: string
  updated_at: string
}

export interface AdminTenantCreateRequest {
  name: string
  status?: string
  plan?: string
  expires_at?: string | null
}

export interface AdminTenantPatchRequest {
  status?: string
  plan?: string
  expires_at?: string | null
}

export interface AdminRechargeRequest {
  amount_microcredits: number
  reason?: string
}

export interface AdminRechargeResponse {
  tenant_id: string
  amount_microcredits: number
  balance_microcredits: number
}

export interface AdminTenantCreditBalanceResponse {
  tenant_id: string
  balance_microcredits: number
  updated_at: string
}

export interface AdminTenantCreditSummaryResponse {
  tenant_id: string
  balance_microcredits: number
  today_consumed_microcredits: number
  month_consumed_microcredits: number
  updated_at: string
}

export interface AdminTenantCreditLedgerItem {
  id: string
  event_type: string
  api_key_id?: string
  request_id?: string
  delta_microcredits: number
  balance_after_microcredits: number
  model?: string
  unit_price_microcredits?: number
  input_tokens?: number
  output_tokens?: number
  meta_json?: Record<string, unknown>
  created_at: string
}

export interface AdminTenantCreditLedgerResponse {
  items: AdminTenantCreditLedgerItem[]
}

export interface ModelPricingItem {
  id: string
  model: string
  input_price_microcredits: number
  cached_input_price_microcredits: number
  output_price_microcredits: number
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface ModelPricingUpsertRequest {
  model: string
  input_price_microcredits: number
  cached_input_price_microcredits: number
  output_price_microcredits: number
  enabled: boolean
}

export interface AdminImpersonateRequest {
  tenant_id: string
  reason: string
}

export interface AdminImpersonateResponse {
  session_id: string
  access_token: string
  expires_in: number
  tenant_id: string
}

export const adminTenantsApi = {
  listTenants: async () => {
    const response = await apiClient.get<AdminTenantItem[]>('/admin/tenants')
    return response.data
  },
  ensureDefaultTenant: async () => {
    const response = await apiClient.post<AdminTenantItem>('/admin/tenants/ensure-default')
    return response.data
  },
  createTenant: async (payload: AdminTenantCreateRequest) => {
    const response = await apiClient.post<AdminTenantItem>('/admin/tenants', payload)
    return response.data
  },
  patchTenant: async (tenantId: string, payload: AdminTenantPatchRequest) => {
    const response = await apiClient.patch<AdminTenantItem>(`/admin/tenants/${tenantId}`, payload)
    return response.data
  },
  rechargeTenant: async (tenantId: string, payload: AdminRechargeRequest) => {
    const response = await apiClient.post<AdminRechargeResponse>(
      `/admin/tenants/${tenantId}/credits/recharge`,
      payload,
    )
    return response.data
  },
  getTenantCreditBalance: async (tenantId: string) => {
    const response = await apiClient.get<AdminTenantCreditBalanceResponse>(
      `/admin/tenants/${tenantId}/credits/balance`,
    )
    return response.data
  },
  getTenantCreditSummary: async (tenantId: string) => {
    const response = await apiClient.get<AdminTenantCreditSummaryResponse>(
      `/admin/tenants/${tenantId}/credits/summary`,
    )
    return response.data
  },
  getTenantCreditLedger: async (tenantId: string, limit = 200) => {
    const response = await apiClient.get<AdminTenantCreditLedgerResponse>(`/admin/tenants/${tenantId}/credits/ledger`, {
      params: { limit },
    })
    return response.data
  },
  listModelPricing: async () => {
    const response = await apiClient.get<ModelPricingItem[]>('/admin/model-pricing')
    return response.data
  },
  upsertModelPricing: async (payload: ModelPricingUpsertRequest) => {
    const response = await apiClient.post<ModelPricingItem>('/admin/model-pricing', payload)
    return response.data
  },
  createImpersonation: async (payload: AdminImpersonateRequest) => {
    const response = await apiClient.post<AdminImpersonateResponse>('/admin/impersonations', payload)
    return response.data
  },
  deleteImpersonation: (sessionId: string) =>
    apiClient.delete<void>(`/admin/impersonations/${sessionId}`),
}
