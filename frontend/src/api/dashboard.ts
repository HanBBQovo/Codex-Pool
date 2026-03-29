import { apiClient } from './client'
import type {
  UsageSummaryQueryResponse,
  UsageHourlyTrendsResponse,
} from './types.ts'

export interface DashboardUsageQueryParams {
  start_ts?: number
  end_ts?: number
  tenant_id?: string
  account_id?: string
  api_key_id?: string
  limit?: number
}

export const dashboardApi = {
  async getUsageSummary(params: DashboardUsageQueryParams): Promise<UsageSummaryQueryResponse> {
    const response = await apiClient.get<UsageSummaryQueryResponse>('/admin/usage/summary', {
      params: {
        start_ts: params.start_ts,
        end_ts: params.end_ts,
        tenant_id: params.tenant_id,
        account_id: params.account_id,
        api_key_id: params.api_key_id,
      },
    })
    return response.data
  },

  async getHourlyTrends(params: DashboardUsageQueryParams): Promise<UsageHourlyTrendsResponse> {
    const response = await apiClient.get<UsageHourlyTrendsResponse>(
      '/admin/usage/trends/hourly',
      {
        params: {
          start_ts: params.start_ts,
          end_ts: params.end_ts,
          tenant_id: params.tenant_id,
          account_id: params.account_id,
          api_key_id: params.api_key_id,
          limit: params.limit ?? 24,
        },
      },
    )
    return response.data
  },
}
