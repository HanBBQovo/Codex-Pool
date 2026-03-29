import { tenantApiClient } from './tenantClient'
import type {
  UsageSummaryQueryResponse,
  UsageHourlyTrendsResponse,
  TenantUsageLeaderboardResponse,
  AccountUsageLeaderboardResponse,
  ApiKeyUsageLeaderboardResponse,
} from './types'

export const tenantUsageApi = {
  summary: async (params: { start_ts: number; end_ts: number; api_key_id?: string }) => {
    const response = await tenantApiClient.get<UsageSummaryQueryResponse>('/usage/summary', {
      params,
    })
    return response.data
  },

  trendsHourly: async (params: {
    start_ts: number
    end_ts: number
    limit?: number
    api_key_id?: string
  }) => {
    const response = await tenantApiClient.get<UsageHourlyTrendsResponse>(
      '/usage/trends/hourly',
      { params },
    )
    return response.data
  },

  leaderboardTenants: async (params: {
    start_ts: number
    end_ts: number
    limit?: number
  }) => {
    const response = await tenantApiClient.get<TenantUsageLeaderboardResponse>(
      '/usage/leaderboard/tenants',
      { params },
    )
    return response.data
  },

  leaderboardAccounts: async (params: {
    start_ts: number
    end_ts: number
    limit?: number
  }) => {
    const response = await tenantApiClient.get<AccountUsageLeaderboardResponse>(
      '/usage/leaderboard/accounts',
      { params },
    )
    return response.data
  },

  leaderboardApiKeys: async (params: {
    start_ts: number
    end_ts: number
    limit?: number
    api_key_id?: string
  }) => {
    const response = await tenantApiClient.get<ApiKeyUsageLeaderboardResponse>(
      '/usage/leaderboard/api-keys',
      { params },
    )
    return response.data
  },
}
