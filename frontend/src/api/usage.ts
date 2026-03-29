import { apiClient } from './client'
import type {
  UsageHourlyTenantTrendsResponse,
  UsageLeaderboardOverviewResponse,
} from './types.ts'

export const usageApi = {
  async getLeaderboard(params: {
    start_ts: number
    end_ts: number
    limit?: number
    tenant_id?: string
    api_key_id?: string
  }): Promise<UsageLeaderboardOverviewResponse> {
    const response = await apiClient.get<UsageLeaderboardOverviewResponse>(
      '/usage/leaderboard/overview',
      { params },
    )
    return response.data
  },

  async getHourlyTenantTrends(params: {
    start_ts: number
    end_ts: number
    limit?: number
    tenant_id?: string
    api_key_id?: string
  }): Promise<UsageHourlyTenantTrendsResponse> {
    const response = await apiClient.get<UsageHourlyTenantTrendsResponse>(
      '/usage/trends/hourly/tenants',
      { params },
    )
    return response.data
  },
}
