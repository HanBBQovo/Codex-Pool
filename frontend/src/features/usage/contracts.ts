import type {
  AdminSystemCounts,
  HourlyTenantUsageTotalPoint,
  UsageHourlyTrendsResponse,
  UsageLeaderboardOverviewResponse,
  UsageSummaryQueryResponse,
} from '../../api/types.ts'

export interface DashboardKpis {
  totalRequests: number
  totalTokens: number
  rpm: number
  tpm: number
  avgFirstTokenMs: number
  tenantCount: number
  accountCount: number
  apiKeyCount: number
  activeAccounts: number
  estimatedCostUsd: number
}

export interface DashboardTrafficPoint {
  hour: string
  accounts: number
  apiKeys: number
}

export interface DashboardTokenTrendPoint {
  hour: string
  input: number
  cached: number
  output: number
  reasoning: number
}

export interface DashboardTopApiKey {
  apiKeyId: string
  tenantId: string
  requests: number
}

export interface DashboardModelDistributionItem {
  model: string
  requests: number
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

export function buildDashboardKpis(
  summary: UsageSummaryQueryResponse | undefined,
  counts?: AdminSystemCounts,
): DashboardKpis {
  const durationMinutes = summary
    ? Math.max((summary.end_ts - summary.start_ts) / 60, 1)
    : 1
  const totalRequests =
    summary?.dashboard_metrics?.total_requests ??
    ((summary?.account_total_requests ?? 0) + (summary?.tenant_api_key_total_requests ?? 0))
  const totalTokens = summary?.dashboard_metrics?.token_breakdown.total_tokens ?? 0

  return {
    totalRequests,
    totalTokens,
    rpm: roundToTwo(totalRequests / durationMinutes),
    tpm: roundToTwo(totalTokens / durationMinutes),
    avgFirstTokenMs: summary?.dashboard_metrics?.avg_first_token_latency_ms ?? 0,
    tenantCount: counts?.tenants ?? 0,
    accountCount: counts?.total_accounts ?? 0,
    apiKeyCount: counts?.api_keys ?? 0,
    activeAccounts: counts?.enabled_accounts ?? 0,
    estimatedCostUsd: roundToTwo((summary?.estimated_cost_microusd ?? 0) / 1_000_000),
  }
}

export function groupTenantHourlyUsageByDay(
  items: HourlyTenantUsageTotalPoint[],
): Array<{ date: string; requests: number }> {
  const grouped = new Map<string, number>()

  items.forEach((item) => {
    const date = new Date(item.hour_start * 1000).toISOString().slice(0, 10)
    grouped.set(date, (grouped.get(date) ?? 0) + item.request_count)
  })

  return [...grouped.entries()]
    .map(([date, requests]) => ({ date, requests }))
    .sort((left, right) => left.date.localeCompare(right.date))
}

export function buildTrafficData(
  hourlyTrends: UsageHourlyTrendsResponse | undefined,
): DashboardTrafficPoint[] {
  const hourlyMap = new Map<number, DashboardTrafficPoint>()

  safeArray(hourlyTrends?.account_totals).forEach((point) => {
    const hour = `${String(new Date(point.hour_start * 1000).getHours()).padStart(2, '0')}:00`
    hourlyMap.set(point.hour_start, {
      hour,
      accounts: point.request_count,
      apiKeys: hourlyMap.get(point.hour_start)?.apiKeys ?? 0,
    })
  })

  safeArray(hourlyTrends?.tenant_api_key_totals).forEach((point) => {
    const hour = `${String(new Date(point.hour_start * 1000).getHours()).padStart(2, '0')}:00`
    hourlyMap.set(point.hour_start, {
      hour,
      accounts: hourlyMap.get(point.hour_start)?.accounts ?? 0,
      apiKeys: point.request_count,
    })
  })

  return [...hourlyMap.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, value]) => value)
}

export function buildTokenTrend(
  summary: UsageSummaryQueryResponse | undefined,
): DashboardTokenTrendPoint[] {
  return safeArray(summary?.dashboard_metrics?.token_trends).map((point) => ({
    hour: `${String(new Date(point.hour_start * 1000).getHours()).padStart(2, '0')}:00`,
    input: point.input_tokens,
    cached: point.cached_input_tokens,
    output: point.output_tokens,
    reasoning: point.reasoning_tokens,
  }))
}

export function buildTopApiKeys(
  leaderboard: UsageLeaderboardOverviewResponse | undefined,
): DashboardTopApiKey[] {
  return safeArray(leaderboard?.api_keys).map((item) => ({
    apiKeyId: item.api_key_id,
    tenantId: item.tenant_id,
    requests: item.total_requests,
  }))
}

export function buildModelDistribution(
  summary: UsageSummaryQueryResponse | undefined,
): DashboardModelDistributionItem[] {
  return safeArray(summary?.dashboard_metrics?.model_request_distribution).map((item) => ({
    model: item.model,
    requests: item.request_count,
  }))
}
