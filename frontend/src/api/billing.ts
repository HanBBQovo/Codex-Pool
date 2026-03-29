import {
  adminTenantsApi,
  type AdminTenantCreditLedgerResponse,
  type AdminTenantCreditSummaryResponse,
} from './adminTenants.ts'
import { tenantCreditsApi, type TenantCreditLedgerItem } from './tenantCredits.ts'

export interface TenantBillingSummaryResponse {
  balance_microcredits: number
  today_consumed_microcredits: number
  month_consumed_microcredits: number
}

export interface TenantBillingLedgerResponse {
  items: TenantCreditLedgerItem[]
}

export const billingApi = {
  async getTenantSummary(tenantId: string): Promise<AdminTenantCreditSummaryResponse> {
    return adminTenantsApi.getTenantCreditSummary(tenantId)
  },

  async getTenantLedger(tenantId: string, limit = 200): Promise<AdminTenantCreditLedgerResponse> {
    return adminTenantsApi.getTenantCreditLedger(tenantId, limit)
  },

  async tenantSummary(): Promise<TenantBillingSummaryResponse> {
    const summary = await tenantCreditsApi.summary()
    return {
      balance_microcredits: summary.balance_microcredits,
      today_consumed_microcredits: summary.today_consumed_microcredits,
      month_consumed_microcredits: summary.month_consumed_microcredits,
    }
  },

  async tenantLedger(limit = 200): Promise<TenantBillingLedgerResponse> {
    const response = await tenantCreditsApi.ledger(limit)
    return { items: response.items }
  },
}
