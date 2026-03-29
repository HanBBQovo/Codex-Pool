import { tenantApiClient } from './tenantClient'

export interface TenantCreditBalanceResponse {
  tenant_id: string
  balance_microcredits: number
  updated_at: string
}

export interface TenantCreditSummaryResponse {
  tenant_id: string
  balance_microcredits: number
  today_consumed_microcredits: number
  month_consumed_microcredits: number
  updated_at: string
}

export interface TenantCreditLedgerItem {
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

export interface TenantCreditLedgerResponse {
  items: TenantCreditLedgerItem[]
}

export interface TenantDailyCheckinResponse {
  tenant_id: string
  local_date: string
  reward_microcredits: number
  balance_microcredits: number
}

export const tenantCreditsApi = {
  balance: async () => {
    const response = await tenantApiClient.get<TenantCreditBalanceResponse>('/credits/balance')
    return response.data
  },

  summary: async () => {
    const response = await tenantApiClient.get<TenantCreditSummaryResponse>('/credits/summary')
    return response.data
  },

  ledger: async (limit = 100) => {
    const response = await tenantApiClient.get<TenantCreditLedgerResponse>('/credits/ledger', {
      params: { limit },
    })
    return response.data
  },

  checkin: async () => {
    const response = await tenantApiClient.post<TenantDailyCheckinResponse>('/credits/checkin')
    return response.data
  },
}
