import { useEffect, useMemo, useRef, useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Building2, Gauge, RefreshCcw, Timer, TrendingUp, Users, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { adminKeysApi } from '@/api/adminKeys'
import { adminTenantsApi } from '@/api/adminTenants'
import { dashboardApi } from '@/api/dashboard'
import { usageApi } from '@/api/usage'
import {
  ChartAccessibility,
  type ChartAccessibilityColumn,
} from '@/components/ui/chart-accessibility'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StandardDataTable } from '@/components/ui/standard-data-table'
import { ToggleBadgeButton } from '@/components/ui/toggle-badge-button'
import {
  buildTokenTrendA11yRows,
  getVisibleTokenComponentKeys,
  summarizeModelDistribution,
  summarizeTokenTrendRows,
  type TokenTrendA11yRow,
} from '@/lib/dashboard-chart-a11y'
import {
  MODEL_DISTRIBUTION_BAR_COLOR,
  TOKEN_COMPONENT_CHART_COLORS,
} from '@/lib/dashboard-chart-theme'
import {
  buildModelDistributionPoints,
  buildTokenTrendChartPoints,
  computePerMinute,
  loadTokenComponentSelection,
  persistTokenComponentSelection,
  toggleTokenComponent,
  type ModelDistributionPoint,
  type ModelDistributionMode,
  type TokenComponentKey,
  type TokenComponentSelection,
} from '@/lib/dashboard-metrics'
import {
  formatDashboardCount,
  formatDashboardDurationSeconds,
  formatDashboardExactNumber,
  formatDashboardMetric,
  formatDashboardTokenCount,
  formatDashboardTokenRate,
  formatDashboardTrendTimestampLabel,
} from '@/lib/dashboard-number-format'
import { formatExactCount } from '@/lib/count-number-format'
import { cn } from '@/lib/utils'

type AlertSeverity = 'critical' | 'warning' | 'info'
type AlertStatus = 'open' | 'resolved'
type DashboardScope = 'global' | 'tenant' | 'api_key'
type RangePreset = 1 | 7 | 30

interface AlertRow {
  id: string
  severity: AlertSeverity
  source: 'data_plane' | 'usage_repo'
  status: AlertStatus
  message: string
  actionLabel: string
  happenedAt: string
}

interface DashboardTopKeyRow {
  apiKeyId: string
  tenantId: string
  requests: number
}

interface StoredDashboardFilters {
  scope: DashboardScope
  rangePreset: RangePreset
  tenantId: string
  apiKeyId: string
}

interface TokenBreakdownRow {
  key: TokenComponentKey
  label: string
  value: number
  color: string
}

const DASHBOARD_FILTERS_STORAGE_KEY = 'cp:admin-dashboard-filters:v1'
const ADMIN_TOKEN_COMPONENT_STORAGE_KEY = 'cp:admin-dashboard-token-components:v1'
const ADMIN_MODEL_MODE_STORAGE_KEY = 'cp:admin-dashboard-model-mode:v1'

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
}

function loadStoredFilters(): StoredDashboardFilters {
  if (typeof window === 'undefined') {
    return {
      scope: 'global',
      rangePreset: 1,
      tenantId: '',
      apiKeyId: '',
    }
  }
  try {
    const raw = window.localStorage.getItem(DASHBOARD_FILTERS_STORAGE_KEY)
    if (!raw) {
      return {
        scope: 'global',
        rangePreset: 1,
        tenantId: '',
        apiKeyId: '',
      }
    }
    const parsed = JSON.parse(raw) as Partial<StoredDashboardFilters>
    return {
      // Avoid restoring stale tenant/api-key scoped filters that can easily look like "no data".
      scope: 'global',
      rangePreset: parsed.rangePreset ?? 1,
      tenantId: '',
      apiKeyId: '',
    }
  } catch {
    return {
      scope: 'global',
      rangePreset: 1,
      tenantId: '',
      apiKeyId: '',
    }
  }
}

function loadModelMode(): ModelDistributionMode {
  if (typeof window === 'undefined') {
    return 'requests'
  }
  const raw = window.localStorage.getItem(ADMIN_MODEL_MODE_STORAGE_KEY)
  return raw === 'tokens' ? 'tokens' : 'requests'
}

function compactTenantId(tenantId: string): string {
  if (tenantId.length <= 14) {
    return tenantId
  }
  return `${tenantId.slice(0, 8)}...${tenantId.slice(-4)}`
}

export default function Dashboard() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [scope, setScope] = useState<DashboardScope>(() => loadStoredFilters().scope)
  const [rangePreset, setRangePreset] = useState<RangePreset>(() => loadStoredFilters().rangePreset)
  const [selectedTenantId, setSelectedTenantId] = useState<string>(() => loadStoredFilters().tenantId)
  const [selectedApiKeyId, setSelectedApiKeyId] = useState<string>(() => loadStoredFilters().apiKeyId)
  const [rangeAnchorMs, setRangeAnchorMs] = useState<number>(() => Date.now())
  const [manualRefreshing, setManualRefreshing] = useState(false)
  const refreshIndicatorTimerRef = useRef<number | null>(null)
  const [tokenComponents, setTokenComponents] = useState<TokenComponentSelection>(() =>
    loadTokenComponentSelection(ADMIN_TOKEN_COMPONENT_STORAGE_KEY),
  )
  const [modelMode, setModelMode] = useState<ModelDistributionMode>(() => loadModelMode())

  useEffect(() => {
    if (typeof window === 'undefined') return
    const payload: StoredDashboardFilters = {
      scope,
      rangePreset,
      tenantId: selectedTenantId,
      apiKeyId: selectedApiKeyId,
    }
    window.localStorage.setItem(DASHBOARD_FILTERS_STORAGE_KEY, JSON.stringify(payload))
  }, [scope, rangePreset, selectedTenantId, selectedApiKeyId])

  useEffect(() => {
    persistTokenComponentSelection(ADMIN_TOKEN_COMPONENT_STORAGE_KEY, tokenComponents)
  }, [tokenComponents])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(ADMIN_MODEL_MODE_STORAGE_KEY, modelMode)
  }, [modelMode])

  const { startTs, endTs } = useMemo(() => {
    const end = Math.floor(rangeAnchorMs / 1000)
    const start = end - rangePreset * 24 * 60 * 60
    return { startTs: start, endTs: end }
  }, [rangeAnchorMs, rangePreset])
  const scopeLabel = (currentScope: DashboardScope) => {
    if (currentScope === 'global') {
      return t('dashboard.scope.global', { defaultValue: '全局视角' })
    }
    if (currentScope === 'tenant') {
      return t('dashboard.scope.tenant', { defaultValue: '租户视角' })
    }
    return t('dashboard.scope.apiKey', { defaultValue: 'API密钥视角' })
  }

  const { data: tenants = [] } = useQuery({
    queryKey: ['adminDashboardTenants'],
    queryFn: () => adminTenantsApi.listTenants(),
    staleTime: 60_000,
  })

  const { data: adminApiKeys = [] } = useQuery({
    queryKey: ['adminDashboardApiKeys'],
    queryFn: () => adminKeysApi.list(),
    staleTime: 60_000,
  })

  const effectiveTenantId = useMemo(() => {
    if (scope === 'global') return ''
    if (selectedTenantId) return selectedTenantId
    return tenants[0]?.id ?? ''
  }, [scope, selectedTenantId, tenants])

  const filteredApiKeys = useMemo(() => {
    if (!effectiveTenantId) return adminApiKeys
    return adminApiKeys.filter((key) => key.tenant_id === effectiveTenantId)
  }, [adminApiKeys, effectiveTenantId])

  const effectiveApiKeyId = useMemo(() => {
    if (scope !== 'api_key') return ''
    if (selectedApiKeyId && filteredApiKeys.some((item) => item.id === selectedApiKeyId)) {
      return selectedApiKeyId
    }
    return filteredApiKeys[0]?.id ?? ''
  }, [filteredApiKeys, scope, selectedApiKeyId])

  const usageQueryParams = useMemo(() => {
    const params: {
      start_ts: number
      end_ts: number
      tenant_id?: string
      account_id?: string
      api_key_id?: string
      limit?: number
    } = {
      start_ts: startTs,
      end_ts: endTs,
      limit: Math.max(24, rangePreset * 24),
    }
    if (scope === 'tenant' && effectiveTenantId) {
      params.tenant_id = effectiveTenantId
    }
    if (scope === 'api_key') {
      if (effectiveTenantId) {
        params.tenant_id = effectiveTenantId
      }
      if (effectiveApiKeyId) {
        params.api_key_id = effectiveApiKeyId
      }
    }
    return params
  }, [effectiveApiKeyId, effectiveTenantId, endTs, rangePreset, scope, startTs])

  const {
    data: systemState,
    isLoading: isLoadingSystem,
    refetch: refetchSystem,
    isFetching: isRefetchingSystem,
  } = useQuery({
    queryKey: ['adminSystemState'],
    queryFn: dashboardApi.getSystemState,
    refetchInterval: 30_000,
  })

  const {
    data: summaryData,
    isLoading: isLoadingSummary,
    refetch: refetchSummary,
    isFetching: isRefetchingSummary,
  } = useQuery({
    queryKey: ['usageSummary', usageQueryParams],
    queryFn: () => dashboardApi.getUsageSummary(usageQueryParams),
    refetchInterval: 30_000,
  })

  const {
    data: leaderboardData,
    isLoading: isLoadingLeaderboard,
    refetch: refetchLeaderboard,
    isFetching: isRefetchingLeaderboard,
  } = useQuery({
    queryKey: ['dashboardLeaderboard', usageQueryParams],
    queryFn: () =>
      usageApi.getLeaderboard({
        start_ts: usageQueryParams.start_ts,
        end_ts: usageQueryParams.end_ts,
        limit: 12,
        tenant_id: usageQueryParams.tenant_id,
        api_key_id: usageQueryParams.api_key_id,
      }),
    refetchInterval: 60_000,
  })

  const isRefreshing = manualRefreshing || isRefetchingSystem || isRefetchingSummary || isRefetchingLeaderboard
  const isLoading = isLoadingSystem || isLoadingSummary

  const handleRefresh = () => {
    setRangeAnchorMs(Date.now())
    if (refreshIndicatorTimerRef.current !== null) {
      window.clearTimeout(refreshIndicatorTimerRef.current)
    }
    setManualRefreshing(true)
    refreshIndicatorTimerRef.current = window.setTimeout(() => {
      setManualRefreshing(false)
      refreshIndicatorTimerRef.current = null
    }, 500)
    refetchSystem()
    refetchSummary()
    refetchLeaderboard()
  }

  useEffect(() => {
    return () => {
      if (refreshIndicatorTimerRef.current !== null) {
        window.clearTimeout(refreshIndicatorTimerRef.current)
      }
    }
  }, [])

  const logsSearch = useMemo(() => {
    const params = new URLSearchParams()
    params.set('tab', 'request')
    params.set('range', String(rangePreset))
    if (scope !== 'global' && effectiveTenantId) {
      params.set('tenant_id', effectiveTenantId)
    }
    if (scope === 'api_key' && effectiveApiKeyId) {
      params.set('api_key_id', effectiveApiKeyId)
    }
    return params.toString()
  }, [effectiveApiKeyId, effectiveTenantId, rangePreset, scope])

  const billingSearch = useMemo(() => {
    const params = new URLSearchParams()
    params.set('granularity', rangePreset === 30 ? 'month' : 'day')
    if (effectiveTenantId) {
      params.set('tenant_id', effectiveTenantId)
    }
    return params.toString()
  }, [effectiveTenantId, rangePreset])

  const detailedDateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
    [i18n.resolvedLanguage],
  )

  const dashboardMetrics = summaryData?.dashboard_metrics
  const tokenBreakdown = dashboardMetrics?.token_breakdown ?? {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
  }
  const inputTokens = tokenBreakdown.input_tokens
  const cachedInputTokens = tokenBreakdown.cached_input_tokens
  const outputTokens = tokenBreakdown.output_tokens
  const reasoningTokens = tokenBreakdown.reasoning_tokens
  const totalRequests = dashboardMetrics?.total_requests
    ?? (scope === 'global'
      ? summaryData?.account_total_requests ?? 0
      : summaryData?.tenant_api_key_total_requests ?? 0)
  const totalTokens = tokenBreakdown.total_tokens
  const rpm = computePerMinute(totalRequests, usageQueryParams.start_ts, usageQueryParams.end_ts)
  const tpm = computePerMinute(totalTokens, usageQueryParams.start_ts, usageQueryParams.end_ts)
  const avgFirstTokenSec = typeof dashboardMetrics?.avg_first_token_latency_ms === 'number'
    ? dashboardMetrics.avg_first_token_latency_ms / 1000
    : null
  const tokenTrendData = useMemo(() => buildTokenTrendChartPoints(dashboardMetrics), [dashboardMetrics])
  const modelDistributionData = useMemo(
    () => buildModelDistributionPoints(dashboardMetrics, modelMode),
    [dashboardMetrics, modelMode],
  )

  const metrics = [
    {
      id: 'total_requests',
      title: t('dashboard.kpi.totalRequests', { defaultValue: 'Total requests' }),
      value: formatDashboardCount(totalRequests),
      exactValue: formatExactCount(totalRequests),
      change: `${scopeLabel(scope)} / ${rangePreset === 1 ? '24h' : `${rangePreset}d`}`,
      icon: TrendingUp,
    },
    {
      id: 'total_tokens',
      title: t('dashboard.kpi.totalTokens', { defaultValue: 'Token consumption total' }),
      value: formatDashboardTokenCount(totalTokens),
      exactValue: formatExactCount(totalTokens),
      change: t('dashboard.kpi.totalTokensDesc', { defaultValue: 'Input + cached + output + reasoning' }),
      icon: Zap,
    },
    {
      id: 'rpm',
      title: t('dashboard.kpi.rpm', { defaultValue: 'RPM' }),
      value: formatDashboardMetric(rpm),
      exactValue: formatDashboardExactNumber(rpm),
      change: t('dashboard.kpi.rpmDesc', { defaultValue: 'Requests per minute' }),
      icon: Gauge,
    },
    {
      id: 'tpm',
      title: t('dashboard.kpi.tpm', { defaultValue: 'TPM' }),
      value: formatDashboardTokenRate(tpm),
      exactValue: formatDashboardExactNumber(tpm),
      change: t('dashboard.kpi.tpmDesc', { defaultValue: 'Tokens per minute' }),
      icon: Gauge,
    },
    {
      id: 'avg_first_token_speed',
      title: t('dashboard.kpi.avgFirstTokenSpeed', { defaultValue: 'Average first-token speed' }),
      value: formatDashboardDurationSeconds(avgFirstTokenSec),
      exactValue: formatDashboardDurationSeconds(avgFirstTokenSec),
      change: t('dashboard.kpi.avgFirstTokenSpeedDesc', { defaultValue: 'TTFT (streaming exact / non-stream approximate)' }),
      icon: Timer,
    },
    {
      id: 'tenant_count',
      title: t('dashboard.kpi.tenants', { defaultValue: 'Tenants' }),
      value: formatDashboardCount(systemState?.counts.tenants ?? 0),
      exactValue: formatExactCount(systemState?.counts.tenants ?? 0),
      change: t('dashboard.kpi.tenantsDesc', { defaultValue: 'Admin-only operational metric' }),
      icon: Building2,
    },
    {
      id: 'account_count',
      title: t('dashboard.kpi.accounts', { defaultValue: 'Accounts' }),
      value: formatDashboardCount(systemState?.counts.total_accounts ?? 0),
      exactValue: formatExactCount(systemState?.counts.total_accounts ?? 0),
      change: t('dashboard.kpi.accountsDesc', { defaultValue: 'Admin-only operational metric' }),
      icon: Users,
    },
    {
      id: 'api_key_count',
      title: t('dashboard.kpi.apiKeys', { defaultValue: 'API keys' }),
      value: formatDashboardCount(systemState?.counts.api_keys ?? 0),
      exactValue: formatExactCount(systemState?.counts.api_keys ?? 0),
      change: t('dashboard.kpi.apiKeysDesc', { defaultValue: 'Configured keys in system' }),
      icon: Zap,
    },
  ]

  const alerts = useMemo<AlertRow[]>(() => {
    if (!systemState) {
      return []
    }

    const rows: AlertRow[] = []

    if (systemState.data_plane_error) {
      rows.push({
        id: 'data_plane_error',
        severity: 'critical',
        source: 'data_plane',
        status: 'open',
        message: systemState.data_plane_error,
        actionLabel: t('dashboard.alerts.checkRoutes'),
        happenedAt: systemState.generated_at,
      })
    }

    if (!systemState.usage_repo_available) {
      rows.push({
        id: 'usage_repo_unavailable',
        severity: 'warning',
        source: 'usage_repo',
        status: 'open',
        message: t('dashboard.alerts.usageRepoUnavailable'),
        actionLabel: t('dashboard.alerts.resolve'),
        happenedAt: systemState.generated_at,
      })
    }

    return rows
  }, [systemState, t])

  const openAlertCount = alerts.filter((item) => item.status === 'open').length

  const alertColumns = useMemo<ColumnDef<AlertRow>[]>(() => {
    return [
      {
        id: 'severity',
        header: t('dashboard.alerts.columns.severity'),
        accessorFn: (row) => row.severity,
        cell: ({ row }) => {
          const severity = row.original.severity
          const variant =
            severity === 'critical' ? 'destructive' : severity === 'warning' ? 'warning' : 'secondary'
          return (
            <Badge variant={variant} className="uppercase text-[10px]">
              {t(`dashboard.alerts.severity.${severity}`)}
            </Badge>
          )
        },
      },
      {
        id: 'source',
        header: t('dashboard.alerts.columns.source'),
        accessorFn: (row) => row.source,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {t(`dashboard.alerts.source.${row.original.source}`)}
          </span>
        ),
      },
      {
        id: 'message',
        header: t('dashboard.alerts.columns.message'),
        accessorFn: (row) => row.message.toLowerCase(),
        cell: ({ row }) => <span className="text-sm leading-6">{row.original.message}</span>,
      },
      {
        id: 'status',
        header: t('dashboard.alerts.columns.status'),
        accessorFn: (row) => row.status,
        cell: ({ row }) => {
          const status = row.original.status
          const variant = status === 'open' ? 'warning' : 'success'
          return <Badge variant={variant}>{t(`dashboard.alerts.status.${status}`)}</Badge>
        },
      },
      {
        id: 'happenedAt',
        header: t('dashboard.alerts.columns.time'),
        accessorFn: (row) => new Date(row.happenedAt).getTime(),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {detailedDateTimeFormatter.format(new Date(row.original.happenedAt))}
          </span>
        ),
      },
      {
        id: 'action',
        header: t('dashboard.alerts.columns.action'),
        accessorFn: (row) => row.actionLabel.toLowerCase(),
        cell: ({ row }) => <span className="text-xs text-primary">{row.original.actionLabel}</span>,
      },
    ]
  }, [detailedDateTimeFormatter, t])

  const topKeyRows = useMemo<DashboardTopKeyRow[]>(
    () =>
      (leaderboardData?.api_keys ?? []).map((item) => ({
        apiKeyId: item.api_key_id,
        tenantId: item.tenant_id,
        requests: item.total_requests,
      })),
    [leaderboardData?.api_keys],
  )

  const topKeyColumns = useMemo<ColumnDef<DashboardTopKeyRow>[]>(
    () => [
      {
        id: 'apiKeyId',
        header: t('dashboard.table.apiKey', { defaultValue: 'API Key' }),
        accessorFn: (row) => row.apiKeyId.toLowerCase(),
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="font-medium">{row.original.apiKeyId}</div>
            <div className="text-xs text-muted-foreground">{row.original.tenantId}</div>
          </div>
        ),
      },
      {
        id: 'requests',
        header: t('dashboard.table.requests', { defaultValue: 'Requests' }),
        accessorKey: 'requests',
        cell: ({ row }) => (
          <span
            className="font-mono"
            title={formatExactCount(row.original.requests)}
          >
            {formatDashboardCount(row.original.requests)}
          </span>
        ),
      },
    ],
    [t],
  )

  const tenantSelectValue = effectiveTenantId || '__none__'
  const apiKeySelectValue = effectiveApiKeyId || '__none__'

  const tokenLabelByKey = useMemo<Record<TokenComponentKey, string>>(
    () => ({
      input: t('dashboard.tokenComponents.input', { defaultValue: 'Input' }),
      cached: t('dashboard.tokenComponents.cached', { defaultValue: 'Cached' }),
      output: t('dashboard.tokenComponents.output', { defaultValue: 'Output' }),
      reasoning: t('dashboard.tokenComponents.reasoning', { defaultValue: 'Reasoning' }),
    }),
    [t],
  )
  const tokenBreakdownRows: TokenBreakdownRow[] = [
    {
      key: 'input',
      label: tokenLabelByKey.input,
      value: inputTokens,
      color: TOKEN_COMPONENT_CHART_COLORS.input,
    },
    {
      key: 'cached',
      label: tokenLabelByKey.cached,
      value: cachedInputTokens,
      color: TOKEN_COMPONENT_CHART_COLORS.cached,
    },
    {
      key: 'output',
      label: tokenLabelByKey.output,
      value: outputTokens,
      color: TOKEN_COMPONENT_CHART_COLORS.output,
    },
    {
      key: 'reasoning',
      label: tokenLabelByKey.reasoning,
      value: reasoningTokens,
      color: TOKEN_COMPONENT_CHART_COLORS.reasoning,
    },
  ]
  const dashboardSelectTriggerClassName = 'min-h-11 md:min-h-0 md:h-9'
  const dashboardButtonClassName = 'min-h-11 px-4 md:min-h-0'
  const toggleBadgeButtonClassName = (pressed: boolean) =>
    cn(
      'gap-2 rounded-full border-border/60 bg-background/80 px-3 py-1.5 text-xs font-medium shadow-none',
      pressed
        ? 'bg-accent text-accent-foreground hover:bg-accent/90'
        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
    )
  const visibleTokenComponentKeys = useMemo(
    () => getVisibleTokenComponentKeys(tokenComponents),
    [tokenComponents],
  )
  const tokenTrendA11yRows = useMemo(
    () => buildTokenTrendA11yRows(tokenTrendData, tokenComponents),
    [tokenComponents, tokenTrendData],
  )
  const tokenTrendA11yColumns = useMemo<ChartAccessibilityColumn<TokenTrendA11yRow>[]>(
    () => [
      {
        key: 'timestamp',
        header: t('dashboard.tokenTrend.a11y.timestamp', {
          defaultValue: 'Timestamp',
        }),
        render: (row: TokenTrendA11yRow) =>
          formatDashboardTrendTimestampLabel(row.timestamp, {
            locale: i18n.resolvedLanguage,
          }),
      },
      ...visibleTokenComponentKeys.map(
        (key): ChartAccessibilityColumn<TokenTrendA11yRow> => ({
          key,
          header: tokenLabelByKey[key],
          render: (row: TokenTrendA11yRow) =>
            formatDashboardTokenCount(
              row.values.find(
                (value: TokenTrendA11yRow['values'][number]) => value.key === key,
              )?.value ?? 0,
              i18n.resolvedLanguage,
            ),
        }),
      ),
    ],
    [i18n.resolvedLanguage, t, tokenLabelByKey, visibleTokenComponentKeys],
  )
  const tokenTrendA11ySummary = useMemo(() => {
    const summary = summarizeTokenTrendRows(tokenTrendA11yRows)

    if (summary.rowCount === 0 || summary.startTimestamp === null || summary.endTimestamp === null) {
      return t('dashboard.tokenTrend.a11y.summaryEmpty', {
        defaultValue: 'No token trend data is available for the current selection.',
      })
    }

    return t('dashboard.tokenTrend.a11y.summary', {
      defaultValue: 'Hourly token trend covering {{count}} time points from {{start}} to {{end}}. Accessible data table follows.',
      count: summary.rowCount,
      start: formatDashboardTrendTimestampLabel(summary.startTimestamp, {
        locale: i18n.resolvedLanguage,
      }),
      end: formatDashboardTrendTimestampLabel(summary.endTimestamp, {
        locale: i18n.resolvedLanguage,
      }),
    })
  }, [i18n.resolvedLanguage, t, tokenTrendA11yRows])
  const modelDistributionA11ySummary = useMemo(() => {
    const summary = summarizeModelDistribution(modelDistributionData)

    if (summary.rowCount === 0 || !summary.topLabel) {
      return t('dashboard.modelDistribution.a11y.summaryEmpty', {
        defaultValue: 'No model distribution data is available for the current selection.',
      })
    }

    return t('dashboard.modelDistribution.a11y.summary', {
      defaultValue: 'Model distribution includes {{count}} rows sorted by {{mode}}. Leading model: {{top}}. Accessible data table follows.',
      count: summary.rowCount,
      mode:
        modelMode === 'tokens'
          ? t('dashboard.modelDistribution.modeTokens', { defaultValue: 'By tokens' })
          : t('dashboard.modelDistribution.modeRequests', { defaultValue: 'By requests' }),
      top: summary.topLabel,
    })
  }, [modelDistributionData, modelMode, t])
  const modelDistributionA11yColumns = useMemo<ChartAccessibilityColumn<ModelDistributionPoint>[]>(
    () => [
      {
        key: 'model',
        header: t('dashboard.modelDistribution.a11y.model', {
          defaultValue: 'Model',
        }),
        render: (row) =>
          row.model === 'other'
            ? t('dashboard.modelDistribution.other', { defaultValue: 'Other' })
            : row.model,
      },
      {
        key: 'value',
        header:
          modelMode === 'tokens'
            ? t('dashboard.modelDistribution.modeTokens', {
                defaultValue: 'By tokens',
              })
            : t('dashboard.modelDistribution.modeRequests', {
                defaultValue: 'By requests',
              }),
        render: (row) =>
          modelMode === 'tokens'
            ? formatDashboardTokenCount(row.value, i18n.resolvedLanguage)
            : formatDashboardCount(row.value, i18n.resolvedLanguage),
      },
    ],
    [i18n.resolvedLanguage, modelMode, t],
  )

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 w-full overflow-y-auto">
      <motion.div className="space-y-8" initial="hidden" animate="show" variants={containerVariants}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <motion.div variants={itemVariants}>
            <h2 className="text-3xl font-semibold tracking-tight">{t('dashboard.title')}</h2>
            <p className="text-muted-foreground mt-1">
              {t('dashboard.subtitle')} ·{' '}
              {t('dashboard.currentScope', { defaultValue: 'Current: {{scope}}', scope: scopeLabel(scope) })}
            </p>
          </motion.div>
          <motion.div variants={itemVariants} className="flex w-full flex-wrap items-center gap-2 xl:w-auto">
            <Button
              variant="outline"
              size="sm"
              className={cn('w-full sm:w-auto', dashboardButtonClassName)}
              onClick={() => navigate({ pathname: '/logs', search: `?${logsSearch}` })}
            >
              {t('dashboard.actions.viewLogs', { defaultValue: 'View request logs' })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn('w-full sm:w-auto', dashboardButtonClassName)}
              onClick={() => navigate({ pathname: '/billing', search: `?${billingSearch}` })}
            >
              {t('dashboard.actions.viewBilling', { defaultValue: 'View billing' })}
            </Button>
            <Select value={scope} onValueChange={(value) => setScope(value as DashboardScope)}>
              <SelectTrigger
                className={cn('w-full sm:w-[160px]', dashboardSelectTriggerClassName)}
                aria-label={t('dashboard.filters.scopeAriaLabel', { defaultValue: 'Scope' })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">{scopeLabel('global')}</SelectItem>
                <SelectItem value="tenant">{scopeLabel('tenant')}</SelectItem>
                <SelectItem value="api_key">{scopeLabel('api_key')}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={String(rangePreset)}
              onValueChange={(value) => setRangePreset(Number(value) as RangePreset)}
            >
              <SelectTrigger
                className={cn('w-full sm:w-[170px]', dashboardSelectTriggerClassName)}
                aria-label={t('dashboard.filters.rangeAriaLabel', { defaultValue: 'Time range' })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{t('dashboard.filters.range.last24Hours', { defaultValue: 'Last 24 hours' })}</SelectItem>
                <SelectItem value="7">{t('dashboard.filters.range.last7Days', { defaultValue: 'Last 7 days' })}</SelectItem>
                <SelectItem value="30">{t('dashboard.filters.range.last30Days', { defaultValue: 'Last 30 days' })}</SelectItem>
              </SelectContent>
            </Select>
            {scope !== 'global' ? (
              <Select
                value={tenantSelectValue}
                onValueChange={(value) => {
                  setSelectedTenantId(value === '__none__' ? '' : value)
                  setSelectedApiKeyId('')
                }}
              >
                <SelectTrigger
                  className={cn('w-full sm:min-w-[220px]', dashboardSelectTriggerClassName)}
                  aria-label={t('dashboard.filters.tenantAriaLabel', { defaultValue: 'Tenant' })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    {t('dashboard.filters.tenantPlaceholder', { defaultValue: 'Select tenant' })}
                  </SelectItem>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id} title={`${tenant.name} (${tenant.id})`}>
                      {tenant.name} ({compactTenantId(tenant.id)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {scope === 'api_key' ? (
              <Select
                value={apiKeySelectValue}
                onValueChange={(value) => setSelectedApiKeyId(value === '__none__' ? '' : value)}
              >
                <SelectTrigger
                  className={cn('w-full sm:min-w-[220px]', dashboardSelectTriggerClassName)}
                  aria-label={t('dashboard.filters.apiKeyAriaLabel', { defaultValue: 'API key' })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    {t('dashboard.filters.apiKeyPlaceholder', { defaultValue: 'Select API key' })}
                  </SelectItem>
                  {filteredApiKeys.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} ({item.key_prefix})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={cn('group w-full transition-colors sm:w-auto', dashboardButtonClassName)}
            >
              <RefreshCcw
                className={cn(
                  'mr-2 h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors',
                  isRefreshing && 'animate-spin text-primary',
                )}
              />
              {t('common.refresh')}
            </Button>
          </motion.div>
        </div>

        <motion.div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" variants={containerVariants}>
          {metrics.map((m) => (
            <motion.div key={m.id} variants={itemVariants}>
              <Card className="shadow-sm border-border/50 hover:shadow-md transition-shadow duration-300">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{m.title}</CardTitle>
                  <div className="p-2 bg-primary/5 rounded-md">
                    <m.icon className="h-4 w-4 text-primary/70" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div
                    className="min-h-8 flex items-center text-2xl font-bold font-sans tracking-tight leading-tight"
                    title={isLoading ? undefined : m.exactValue}
                  >
                    {isLoading ? <div className="h-8 w-28 bg-muted animate-pulse rounded" /> : m.value}
                  </div>
                  <div className="h-4 flex items-center">
                    {isLoading ? (
                      <div className="h-3 w-40 bg-muted/80 animate-pulse rounded" />
                    ) : (
                      <p className="text-xs text-muted-foreground">{m.change}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        <div className="grid gap-6 xl:grid-cols-7">
          <motion.div className="xl:col-span-4" variants={itemVariants}>
            <Card className="h-full shadow-sm border-border/50">
              <CardHeader className="space-y-3">
                <div className="space-y-1">
                  <CardTitle>{t('dashboard.tokenTrend.title', { defaultValue: 'Token usage trend' })}</CardTitle>
                  <CardDescription>
                    {t('dashboard.tokenTrend.description', {
                      defaultValue: 'Hourly token trend by component. Toggle components to focus specific consumption.',
                    })}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tokenBreakdownRows.map((row) => (
                    <ToggleBadgeButton
                      key={row.key}
                      variant="outline"
                      pressed={tokenComponents[row.key]}
                      className={toggleBadgeButtonClassName(tokenComponents[row.key])}
                      title={formatExactCount(row.value)}
                      onClick={() => setTokenComponents((prev) => toggleTokenComponent(prev, row.key))}
                    >
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full border border-background/70"
                        style={{ backgroundColor: row.color }}
                      />
                      <span>{row.label}: {formatDashboardTokenCount(row.value)}</span>
                    </ToggleBadgeButton>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <ChartAccessibility
                  summaryId="admin-dashboard-token-trend-a11y"
                  summary={tokenTrendA11ySummary}
                  tableLabel={t('dashboard.tokenTrend.a11y.tableLabel', {
                    defaultValue: 'Token usage trend data table',
                  })}
                  columns={tokenTrendA11yColumns}
                  rows={tokenTrendA11yRows}
                />
                {isLoading ? (
                  <div className="w-full h-[320px] bg-muted/50 animate-pulse rounded-md" />
                ) : tokenTrendData.length === 0 ? (
                  <div className="flex h-[320px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                    {t('dashboard.tokenTrend.empty', { defaultValue: 'No token trend data yet' })}
                  </div>
                ) : (
                  <div aria-hidden="true" style={{ width: '100%', minHeight: 320 }}>
                    <ResponsiveContainer width="100%" height={320}>
                      <AreaChart data={tokenTrendData} margin={{ top: 8, right: 12, left: 6, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis
                          dataKey="timestamp"
                          tickFormatter={(value) =>
                            new Intl.DateTimeFormat(undefined, {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            }).format(new Date(value))
                          }
                          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                          tickFormatter={(value) =>
                            typeof value === 'number'
                              ? formatDashboardTokenCount(value)
                              : String(value ?? '')
                          }
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          labelFormatter={(label) => formatDashboardTrendTimestampLabel(label)}
                          formatter={(value) =>
                            typeof value === 'number'
                              ? formatDashboardTokenCount(value)
                              : String(value ?? '')
                          }
                        />
                        {tokenComponents.input ? (
                          <Area type="monotone" dataKey="inputTokens" stackId="tokens" stroke={TOKEN_COMPONENT_CHART_COLORS.input} fill={TOKEN_COMPONENT_CHART_COLORS.input} fillOpacity={0.6} name={t('dashboard.tokenComponents.input', { defaultValue: 'Input' })} />
                        ) : null}
                        {tokenComponents.cached ? (
                          <Area type="monotone" dataKey="cachedInputTokens" stackId="tokens" stroke={TOKEN_COMPONENT_CHART_COLORS.cached} fill={TOKEN_COMPONENT_CHART_COLORS.cached} fillOpacity={0.6} name={t('dashboard.tokenComponents.cached', { defaultValue: 'Cached' })} />
                        ) : null}
                        {tokenComponents.output ? (
                          <Area type="monotone" dataKey="outputTokens" stackId="tokens" stroke={TOKEN_COMPONENT_CHART_COLORS.output} fill={TOKEN_COMPONENT_CHART_COLORS.output} fillOpacity={0.6} name={t('dashboard.tokenComponents.output', { defaultValue: 'Output' })} />
                        ) : null}
                        {tokenComponents.reasoning ? (
                          <Area type="monotone" dataKey="reasoningTokens" stackId="tokens" stroke={TOKEN_COMPONENT_CHART_COLORS.reasoning} fill={TOKEN_COMPONENT_CHART_COLORS.reasoning} fillOpacity={0.6} name={t('dashboard.tokenComponents.reasoning', { defaultValue: 'Reasoning' })} />
                        ) : null}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div className="xl:col-span-3" variants={itemVariants}>
            <Card className="h-full shadow-sm border-border/50">
              <CardHeader className="space-y-3">
                <div className="space-y-1">
                  <CardTitle>{t('dashboard.modelDistribution.title', { defaultValue: 'Model request distribution' })}</CardTitle>
                  <CardDescription>{t('dashboard.modelDistribution.description', { defaultValue: 'Top models by request count or token usage.' })}</CardDescription>
                </div>
                <div className="flex gap-2">
                  <ToggleBadgeButton
                    variant="outline"
                    pressed={modelMode === 'requests'}
                    className={toggleBadgeButtonClassName(modelMode === 'requests')}
                    onClick={() => setModelMode('requests')}
                  >
                    {t('dashboard.modelDistribution.modeRequests', { defaultValue: 'By requests' })}
                  </ToggleBadgeButton>
                  <ToggleBadgeButton
                    variant="outline"
                    pressed={modelMode === 'tokens'}
                    className={toggleBadgeButtonClassName(modelMode === 'tokens')}
                    onClick={() => setModelMode('tokens')}
                  >
                    {t('dashboard.modelDistribution.modeTokens', { defaultValue: 'By tokens' })}
                  </ToggleBadgeButton>
                </div>
              </CardHeader>
              <CardContent>
                <ChartAccessibility
                  summaryId="admin-dashboard-model-distribution-a11y"
                  summary={modelDistributionA11ySummary}
                  tableLabel={t('dashboard.modelDistribution.a11y.tableLabel', {
                    defaultValue: 'Model distribution data table',
                  })}
                  columns={modelDistributionA11yColumns}
                  rows={modelDistributionData}
                />
                {isLoading ? (
                  <div className="w-full h-[320px] bg-muted/50 animate-pulse rounded-md" />
                ) : modelDistributionData.length === 0 ? (
                  <div className="flex h-[320px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                    {t('dashboard.modelDistribution.empty', { defaultValue: 'No model distribution data yet' })}
                  </div>
                ) : (
                  <div aria-hidden="true" style={{ width: '100%', minHeight: 320 }}>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={modelDistributionData} layout="vertical" margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                        <XAxis
                          type="number"
                          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                          tickFormatter={(value) =>
                            typeof value === 'number'
                              ? (modelMode === 'tokens'
                                  ? formatDashboardTokenCount(value)
                                  : formatDashboardCount(value))
                              : String(value ?? '')
                          }
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          type="category"
                          dataKey="model"
                          width={110}
                          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                          tickFormatter={(value) =>
                            value === 'other'
                              ? t('dashboard.modelDistribution.other', { defaultValue: 'Other' })
                              : String(value)
                          }
                        />
                        <Tooltip
                          formatter={(value) =>
                            typeof value === 'number'
                              ? (modelMode === 'tokens'
                                  ? formatDashboardTokenCount(value)
                                  : formatDashboardCount(value))
                              : String(value ?? '')
                          }
                          labelFormatter={(label) =>
                            label === 'other'
                              ? t('dashboard.modelDistribution.other', { defaultValue: 'Other' })
                              : String(label)
                          }
                        />
                        <Bar dataKey="value" fill={MODEL_DISTRIBUTION_BAR_COLOR} radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="grid gap-6 xl:grid-cols-7">
          <motion.div className="xl:col-span-4" variants={itemVariants}>
            <Card className="h-full shadow-sm border-border/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {t('dashboard.alerts.title')}
                  {openAlertCount > 0 && (
                    <Badge variant="destructive" className="ml-auto rounded-full px-2">
                      {openAlertCount}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>{t('dashboard.alerts.subtitle')}</CardDescription>
              </CardHeader>
              <CardContent className="h-[320px] min-h-0">
                {isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="h-9 rounded bg-muted animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <StandardDataTable
                    columns={alertColumns}
                    data={alerts}
                    density="compact"
                    defaultPageSize={6}
                    pageSizeOptions={[6, 12, 24, 48]}
                    className="h-full"
                    emptyText={t('dashboard.alerts.empty')}
                    searchPlaceholder={t('dashboard.alerts.searchPlaceholder')}
                    searchFn={(row, keyword) =>
                      `${row.message} ${row.source} ${row.severity} ${row.status}`
                        .toLowerCase()
                        .includes(keyword)
                    }
                  />
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div className="xl:col-span-3" variants={itemVariants}>
            <Card className="h-full shadow-sm border-border/50">
              <CardHeader>
                <CardTitle>{t('dashboard.topApiKeys.title', { defaultValue: 'Top API Keys' })}</CardTitle>
                <CardDescription>
                  {t('dashboard.topApiKeys.scopeDescription', {
                    defaultValue: 'Scope: {{scope}} / selected time window',
                    scope: scopeLabel(scope),
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[320px] min-h-0">
                {isLoadingLeaderboard ? (
                  <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="h-8 bg-muted rounded" />
                    ))}
                  </div>
                ) : (
                  <StandardDataTable
                    columns={topKeyColumns}
                    data={topKeyRows}
                    density="compact"
                    defaultPageSize={8}
                    pageSizeOptions={[8, 16, 32]}
                    emptyText={t('dashboard.topApiKeys.empty', { defaultValue: 'No ranking data yet' })}
                  />
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </motion.div>
    </div>
  )
}
