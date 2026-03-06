import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Gauge, RefreshCcw, Timer, TrendingUp, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Button as NextButton,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Select,
  SelectItem,
  Skeleton,
} from '@heroui/react'
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

import { tenantKeysApi } from '@/api/tenantKeys'
import { tenantUsageApi } from '@/api/tenantUsage'
import AnimatedContent from '@/components/AnimatedContent'
import FadeContent from '@/components/FadeContent'
import Threads from '@/components/Threads'
import {
  buildModelDistributionPoints,
  buildTokenTrendChartPoints,
  computePerMinute,
  type ModelDistributionMode,
  loadTokenComponentSelection,
  persistTokenComponentSelection,
  toggleTokenComponent,
  type TokenComponentSelection,
} from '@/lib/dashboard-metrics'
import { formatTokenCount, formatTokenRate } from '@/lib/token-format'

type RangePreset = 1 | 7 | 30

const TOKEN_COMPONENT_STORAGE_KEY = 'cp:tenant-dashboard-token-components:v1'
const MODEL_MODE_STORAGE_KEY = 'cp:tenant-dashboard-model-mode:v1'

function loadModelMode(): ModelDistributionMode {
  if (typeof window === 'undefined') {
    return 'requests'
  }
  const raw = window.localStorage.getItem(MODEL_MODE_STORAGE_KEY)
  return raw === 'tokens' ? 'tokens' : 'requests'
}

function formatMetric(value: number): string {
  if (value >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function TenantDashboardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [rangePreset, setRangePreset] = useState<RangePreset>(1)
  const [apiKeyId, setApiKeyId] = useState<string>('all')
  const [rangeAnchorMs, setRangeAnchorMs] = useState<number>(() => Date.now())
  const [manualRefreshing, setManualRefreshing] = useState(false)
  const refreshIndicatorTimerRef = useRef<number | null>(null)
  const [tokenComponents, setTokenComponents] = useState<TokenComponentSelection>(() =>
    loadTokenComponentSelection(TOKEN_COMPONENT_STORAGE_KEY),
  )
  const [modelMode, setModelMode] = useState<ModelDistributionMode>(() => loadModelMode())

  useEffect(() => {
    persistTokenComponentSelection(TOKEN_COMPONENT_STORAGE_KEY, tokenComponents)
  }, [tokenComponents])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(MODEL_MODE_STORAGE_KEY, modelMode)
  }, [modelMode])

  const range = useMemo(() => {
    const endTs = Math.floor(rangeAnchorMs / 1000)
    const startTs = endTs - rangePreset * 24 * 60 * 60
    return { start_ts: startTs, end_ts: endTs }
  }, [rangeAnchorMs, rangePreset])
  const selectedApiKeyId = apiKeyId === 'all' ? undefined : apiKeyId

  const { data: keys = [] } = useQuery({
    queryKey: ['tenantKeys', 'dashboard'],
    queryFn: () => tenantKeysApi.list(),
    staleTime: 60_000,
  })

  const {
    data: summary,
    isFetching: isFetchingSummary,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['tenantDashboardSummary', range.start_ts, range.end_ts, selectedApiKeyId],
    queryFn: () => tenantUsageApi.summary({ ...range, api_key_id: selectedApiKeyId }),
    refetchInterval: 30_000,
  })

  const isRefreshing = manualRefreshing || isFetchingSummary

  const rangeLabel = (days: RangePreset) => {
    if (days === 1) {
      return t('tenantDashboard.filters.range.last24Hours', { defaultValue: 'Last 24 hours' })
    }
    if (days === 7) {
      return t('tenantDashboard.filters.range.last7Days', { defaultValue: 'Last 7 days' })
    }
    return t('tenantDashboard.filters.range.last30Days', { defaultValue: 'Last 30 days' })
  }

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
    refetchSummary()
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
    params.set('range', String(rangePreset))
    if (selectedApiKeyId) {
      params.set('api_key_id', selectedApiKeyId)
    }
    return params.toString()
  }, [rangePreset, selectedApiKeyId])

  const billingSearch = useMemo(() => {
    const params = new URLSearchParams()
    params.set('granularity', rangePreset === 30 ? 'month' : 'day')
    return params.toString()
  }, [rangePreset])

  const rangeOptions: Array<{ key: string; label: string }> = [
    { key: '1', label: t('tenantDashboard.filters.range.last24Hours', { defaultValue: 'Last 24 hours' }) },
    { key: '7', label: t('tenantDashboard.filters.range.last7Days', { defaultValue: 'Last 7 days' }) },
    { key: '30', label: t('tenantDashboard.filters.range.last30Days', { defaultValue: 'Last 30 days' }) },
  ]

  const apiKeyOptions = useMemo(() => {
    const options = [
      {
        key: 'all',
        label: t('tenantDashboard.filters.apiKeyAll', { defaultValue: 'All API keys' }),
      },
    ]
    for (const item of keys) {
      options.push({
        key: item.id,
        label: `${item.name} (${item.key_prefix})`,
      })
    }
    return options
  }, [keys, t])

  const dashboardMetrics = summary?.dashboard_metrics
  const tokenBreakdown = dashboardMetrics?.token_breakdown ?? {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
  }
  const totalRequests = dashboardMetrics?.total_requests ?? summary?.tenant_api_key_total_requests ?? 0
  const totalTokens = tokenBreakdown.total_tokens
  const rpm = computePerMinute(totalRequests, range.start_ts, range.end_ts)
  const tpm = computePerMinute(totalTokens, range.start_ts, range.end_ts)
  const avgFirstTokenMs = dashboardMetrics?.avg_first_token_latency_ms
  const avgFirstTokenSec = typeof avgFirstTokenMs === 'number' ? avgFirstTokenMs / 1000 : null

  const tokenTrendData = useMemo(
    () => buildTokenTrendChartPoints(dashboardMetrics),
    [dashboardMetrics],
  )
  const modelDistributionData = useMemo(
    () => buildModelDistributionPoints(dashboardMetrics, modelMode),
    [dashboardMetrics, modelMode],
  )

  const showTokenArea = tokenComponents.input
    || tokenComponents.cached
    || tokenComponents.output
    || tokenComponents.reasoning

  const tokenBreakdownRows = [
    {
      key: 'input' as const,
      label: t('tenantDashboard.tokenComponents.input', { defaultValue: 'Input' }),
      value: tokenBreakdown.input_tokens,
      color: '#0ea5e9',
    },
    {
      key: 'cached' as const,
      label: t('tenantDashboard.tokenComponents.cached', { defaultValue: 'Cached' }),
      value: tokenBreakdown.cached_input_tokens,
      color: '#14b8a6',
    },
    {
      key: 'output' as const,
      label: t('tenantDashboard.tokenComponents.output', { defaultValue: 'Output' }),
      value: tokenBreakdown.output_tokens,
      color: '#f59e0b',
    },
    {
      key: 'reasoning' as const,
      label: t('tenantDashboard.tokenComponents.reasoning', { defaultValue: 'Reasoning' }),
      value: tokenBreakdown.reasoning_tokens,
      color: '#8b5cf6',
    },
  ]

  const kpiCards = [
    {
      title: t('tenantDashboard.kpi.rpm', { defaultValue: 'RPM' }),
      value: formatMetric(rpm),
      desc: t('tenantDashboard.kpi.rpmDesc', { defaultValue: 'Requests per minute' }),
      icon: TrendingUp,
    },
    {
      title: t('tenantDashboard.kpi.tpm', { defaultValue: 'TPM' }),
      value: formatTokenRate(tpm),
      desc: t('tenantDashboard.kpi.tpmDesc', { defaultValue: 'Tokens per minute' }),
      icon: Gauge,
    },
    {
      title: t('tenantDashboard.kpi.totalTokens', { defaultValue: 'Token consumption total' }),
      value: formatTokenCount(totalTokens),
      desc: t('tenantDashboard.kpi.totalTokensDesc', { defaultValue: 'Input + cached + output + reasoning' }),
      icon: Zap,
    },
    {
      title: t('tenantDashboard.kpi.totalRequests', { defaultValue: 'Total requests' }),
      value: totalRequests.toLocaleString(),
      desc: t('tenantDashboard.kpi.totalRequestsDesc', { defaultValue: 'Selected time range' }),
      icon: TrendingUp,
    },
    {
      title: t('tenantDashboard.kpi.avgFirstTokenSpeed', { defaultValue: 'Average first-token speed' }),
      value: avgFirstTokenSec === null ? '--' : `${avgFirstTokenSec.toFixed(2)}s`,
      desc: t('tenantDashboard.kpi.avgFirstTokenSpeedDesc', { defaultValue: 'TTFT (streaming exact / non-stream approximate)' }),
      icon: Timer,
    },
  ]

  const groupOverviewItems = useMemo(() => {
    if (selectedApiKeyId) {
      const key = keys.find((item) => item.id === selectedApiKeyId)
      return key
        ? [
            {
              id: key.id,
              label: `${key.name} (${key.key_prefix})`,
              groupName: key.group.name,
              invalid: key.group.deleted,
            },
          ]
        : []
    }
    const buckets = new Map<string, { label: string; count: number; invalid: boolean }>()
    for (const key of keys) {
      const current = buckets.get(key.group_id) ?? {
        label: key.group.name,
        count: 0,
        invalid: key.group.deleted,
      }
      current.count += 1
      current.invalid = current.invalid || key.group.deleted
      buckets.set(key.group_id, current)
    }
    return Array.from(buckets.entries()).map(([id, item]) => ({
      id,
      label: item.label,
      groupName: t('tenantDashboard.groupOverview.keysBound', {
        defaultValue: '{{count}} API keys bound',
        count: item.count,
      }),
      invalid: item.invalid,
    }))
  }, [keys, selectedApiKeyId, t])

  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 opacity-35 dark:opacity-55">
          <Threads color={[0.14, 0.56, 0.94]} amplitude={0.75} distance={0.2} />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_55%),radial-gradient(circle_at_80%_20%,_rgba(14,116,144,0.14),_transparent_52%),linear-gradient(180deg,_rgba(255,255,255,0.7),_rgba(255,255,255,0.25))] dark:bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.2),_transparent_55%),radial-gradient(circle_at_80%_20%,_rgba(34,197,94,0.16),_transparent_50%),linear-gradient(180deg,_rgba(2,6,23,0.82),_rgba(2,6,23,0.58))]" />
      </div>

      <div className="relative z-10 space-y-4 p-4 sm:space-y-6 sm:p-6 lg:p-8">
        <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
          <FadeContent blur duration={320} className="h-full">
            <Card shadow="lg" className="h-full border border-white/40 bg-white/70 backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/55">
              <CardHeader className="flex flex-col items-start gap-4 p-5 pb-2 sm:p-6 sm:pb-2">
                <Chip color="primary" variant="flat" className="font-medium">
                  {t('tenantDashboard.hero.badge', { defaultValue: 'Tenant Workspace Overview' })}
                </Chip>
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
                    {t('tenantDashboard.title', { defaultValue: 'Tenant Dashboard' })}
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {t('tenantDashboard.hero.summaryPrefix', { defaultValue: 'Scope: current tenant ' })}
                    {selectedApiKeyId
                      ? t('tenantDashboard.hero.summarySingleApiKey', { defaultValue: '(single API key)' })
                      : t('tenantDashboard.hero.summaryAllApiKeys', { defaultValue: '(all API keys)' })}
                    {' · '}
                    {rangeLabel(rangePreset)}
                  </p>
                </div>
              </CardHeader>
              <CardBody className="p-5 pt-3 sm:p-6 sm:pt-3">
                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {t('tenantDashboard.subtitle.metricsFocus', {
                    defaultValue: 'Focus metrics: TPM, RPM, total token consumption, total requests, and first-token speed.',
                  })}
                </p>
              </CardBody>
            </Card>
          </FadeContent>

          <AnimatedContent distance={16} duration={0.28} ease="power3.out" className="h-full">
            <Card shadow="lg" className="h-full border border-white/40 bg-white/70 backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/55">
              <CardHeader className="p-5 pb-3 sm:p-6 sm:pb-3">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t('tenantDashboard.filters.rangeAriaLabel', { defaultValue: 'Time range' })}
                </p>
              </CardHeader>
              <CardBody className="space-y-3 p-5 pt-0 sm:p-6 sm:pt-0">
                <Select
                  aria-label={t('tenantDashboard.filters.rangeAriaLabel', { defaultValue: 'Time range' })}
                  disallowEmptySelection
                  selectedKeys={[String(rangePreset)]}
                  onChange={(event) => setRangePreset(Number(event.target.value) as RangePreset)}
                  variant="bordered"
                  size="sm"
                >
                  {rangeOptions.map((option) => (
                    <SelectItem key={option.key}>{option.label}</SelectItem>
                  ))}
                </Select>
                <Select
                  aria-label={t('tenantDashboard.filters.apiKeyAriaLabel', { defaultValue: 'API key' })}
                  disallowEmptySelection
                  selectedKeys={[apiKeyId]}
                  onChange={(event) => setApiKeyId(event.target.value)}
                  variant="bordered"
                  size="sm"
                  items={apiKeyOptions}
                >
                  {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
                </Select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('tenantDashboard.filters.apiKeyHint', {
                    defaultValue: 'Tip: use API key filter to isolate model and token hotspots quickly.',
                  })}
                </p>
                <Divider className="my-1" />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <NextButton
                    variant="flat"
                    color="primary"
                    onPress={() => navigate({ pathname: '/logs', search: `?${logsSearch}` })}
                  >
                    {t('tenantDashboard.actions.viewRequestLogs', { defaultValue: 'View request logs' })}
                  </NextButton>
                  <NextButton
                    variant="flat"
                    color="default"
                    onPress={() => navigate({ pathname: '/billing', search: `?${billingSearch}` })}
                  >
                    {t('tenantDashboard.actions.viewBilling', { defaultValue: 'View billing' })}
                  </NextButton>
                  <NextButton
                    variant="flat"
                    color="secondary"
                    className="sm:col-span-2"
                    onPress={() => navigate('/api-keys')}
                  >
                    {t('tenantDashboard.actions.manageApiKeys', { defaultValue: 'Manage API keys' })}
                  </NextButton>
                </div>
                <NextButton
                  variant="bordered"
                  size="sm"
                  className="w-full"
                  onPress={handleRefresh}
                  isDisabled={isRefreshing}
                  startContent={<RefreshCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />}
                >
                  {t('tenantDashboard.actions.refresh', { defaultValue: 'Refresh' })}
                </NextButton>
              </CardBody>
            </Card>
          </AnimatedContent>
        </div>

        <AnimatedContent distance={12} duration={0.24} className="h-full">
          <Card className="border border-white/40 bg-white/70 backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/55">
            <CardHeader className="space-y-1">
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {t('tenantDashboard.groupOverview.title', { defaultValue: 'API key group overview' })}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {selectedApiKeyId
                  ? t('tenantDashboard.groupOverview.singleDescription', { defaultValue: 'Current API key group binding and validity state.' })
                  : t('tenantDashboard.groupOverview.allDescription', { defaultValue: 'How your current API keys are distributed across pricing groups.' })}
              </p>
            </CardHeader>
            <CardBody className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {groupOverviewItems.length === 0 ? (
                <div className="rounded-xl border border-dashed px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {t('tenantDashboard.groupOverview.empty', { defaultValue: 'No API key groups to show yet.' })}
                </div>
              ) : (
                groupOverviewItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200/70 bg-white/60 px-4 py-3 dark:border-slate-700/60 dark:bg-slate-950/30">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{item.label}</p>
                      <Chip color={item.invalid ? 'danger' : 'success'} variant="flat">
                        {item.invalid
                          ? t('tenantDashboard.groupOverview.invalid', { defaultValue: 'Invalid' })
                          : t('tenantDashboard.groupOverview.valid', { defaultValue: 'Valid' })}
                      </Chip>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.groupName}</p>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </AnimatedContent>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {kpiCards.map((item) => (
            <AnimatedContent key={item.title} distance={12} duration={0.24} className="h-full">
              <Card className="h-full border border-white/40 bg-white/70 backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/55">
                <CardHeader className="pb-2">
                  <p className="text-sm text-slate-600 dark:text-slate-300">{item.title}</p>
                </CardHeader>
                <CardBody className="pt-0">
                  <div className="min-h-10 flex items-center">
                    {isFetchingSummary && !summary ? (
                      <Skeleton className="h-10 w-32 rounded-xl" />
                    ) : (
                      <p className="flex items-center gap-2 text-3xl font-semibold leading-none text-slate-900 dark:text-slate-100">
                        <item.icon className="h-5 w-5 text-cyan-500" />
                        {item.value}
                      </p>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{item.desc}</p>
                </CardBody>
              </Card>
            </AnimatedContent>
          ))}
        </div>

        <div className="grid gap-4 2xl:grid-cols-[1.65fr_1fr]">
          <FadeContent duration={280} className="h-full">
            <Card className="h-full border border-white/40 bg-white/72 backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/55">
              <CardHeader className="space-y-3">
                <div className="space-y-1">
                  <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {t('tenantDashboard.tokenTrend.title', { defaultValue: 'Token usage trend' })}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {t('tenantDashboard.tokenTrend.description', {
                      defaultValue: 'Hourly token trend by component. Toggle components to focus specific consumption.',
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tokenBreakdownRows.map((item) => (
                    <Chip
                      key={item.key}
                      variant={tokenComponents[item.key] ? 'solid' : 'bordered'}
                      color={tokenComponents[item.key] ? 'primary' : 'default'}
                      className="cursor-pointer"
                      style={tokenComponents[item.key] ? { backgroundColor: item.color, color: '#fff' } : undefined}
                      onClick={() => setTokenComponents((prev) => toggleTokenComponent(prev, item.key))}
                    >
                      {item.label}: {formatTokenCount(item.value)}
                    </Chip>
                  ))}
                </div>
              </CardHeader>
              <CardBody>
                {isFetchingSummary && tokenTrendData.length === 0 ? (
                  <div className="space-y-3">
                    <Skeleton className="h-8 w-48 rounded-xl" />
                    <Skeleton className="h-[300px] w-full rounded-xl" />
                  </div>
                ) : tokenTrendData.length === 0 ? (
                  <div className="flex h-[320px] items-center justify-center rounded-xl border border-dashed border-slate-300/80 text-sm text-slate-500 dark:border-slate-700/80 dark:text-slate-400">
                    {t('tenantDashboard.tokenTrend.empty', { defaultValue: 'No token trend data yet' })}
                  </div>
                ) : (
                  <div style={{ width: '100%', minHeight: 320 }}>
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
                        <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} tickLine={false} axisLine={false} />
                        <Tooltip
                          formatter={(value) =>
                            typeof value === 'number'
                              ? formatTokenCount(value)
                              : String(value ?? '')
                          }
                          labelFormatter={(label) =>
                            new Intl.DateTimeFormat(undefined, {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            }).format(new Date(Number(label)))
                          }
                        />
                        {showTokenArea && tokenComponents.input ? (
                          <Area type="monotone" dataKey="inputTokens" stackId="tokens" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.6} name={t('tenantDashboard.tokenComponents.input', { defaultValue: 'Input' })} />
                        ) : null}
                        {showTokenArea && tokenComponents.cached ? (
                          <Area type="monotone" dataKey="cachedInputTokens" stackId="tokens" stroke="#14b8a6" fill="#14b8a6" fillOpacity={0.6} name={t('tenantDashboard.tokenComponents.cached', { defaultValue: 'Cached' })} />
                        ) : null}
                        {showTokenArea && tokenComponents.output ? (
                          <Area type="monotone" dataKey="outputTokens" stackId="tokens" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} name={t('tenantDashboard.tokenComponents.output', { defaultValue: 'Output' })} />
                        ) : null}
                        {showTokenArea && tokenComponents.reasoning ? (
                          <Area type="monotone" dataKey="reasoningTokens" stackId="tokens" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.6} name={t('tenantDashboard.tokenComponents.reasoning', { defaultValue: 'Reasoning' })} />
                        ) : null}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardBody>
            </Card>
          </FadeContent>

          <AnimatedContent distance={20} duration={0.3} className="h-full">
            <Card className="h-full border border-white/40 bg-white/72 backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/55">
              <CardHeader className="space-y-3">
                <div className="space-y-1">
                  <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {t('tenantDashboard.modelDistribution.title', { defaultValue: 'Model request distribution' })}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {t('tenantDashboard.modelDistribution.description', { defaultValue: 'Top models by request count or token usage.' })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Chip
                    className="cursor-pointer"
                    color={modelMode === 'requests' ? 'primary' : 'default'}
                    variant={modelMode === 'requests' ? 'flat' : 'bordered'}
                    onClick={() => setModelMode('requests')}
                  >
                    {t('tenantDashboard.modelDistribution.modeRequests', { defaultValue: 'By requests' })}
                  </Chip>
                  <Chip
                    className="cursor-pointer"
                    color={modelMode === 'tokens' ? 'primary' : 'default'}
                    variant={modelMode === 'tokens' ? 'flat' : 'bordered'}
                    onClick={() => setModelMode('tokens')}
                  >
                    {t('tenantDashboard.modelDistribution.modeTokens', { defaultValue: 'By tokens' })}
                  </Chip>
                </div>
              </CardHeader>
              <CardBody>
                {isFetchingSummary && modelDistributionData.length === 0 ? (
                  <div className="space-y-3">
                    <Skeleton className="h-8 w-40 rounded-xl" />
                    <Skeleton className="h-[300px] w-full rounded-xl" />
                  </div>
                ) : modelDistributionData.length === 0 ? (
                  <div className="flex h-[320px] items-center justify-center rounded-xl border border-dashed border-slate-300/80 text-sm text-slate-500 dark:border-slate-700/80 dark:text-slate-400">
                    {t('tenantDashboard.modelDistribution.empty', { defaultValue: 'No model distribution data yet' })}
                  </div>
                ) : (
                  <div style={{ width: '100%', minHeight: 320 }}>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart
                        data={modelDistributionData}
                        layout="vertical"
                        margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                        <XAxis type="number" tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} tickLine={false} axisLine={false} />
                        <YAxis
                          dataKey="model"
                          type="category"
                          width={120}
                          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) =>
                            value === 'other'
                              ? t('tenantDashboard.modelDistribution.other', { defaultValue: 'Other' })
                              : String(value)
                          }
                        />
                        <Tooltip
                          formatter={(value) =>
                            typeof value === 'number'
                              ? (modelMode === 'tokens' ? formatTokenCount(value) : value.toLocaleString())
                              : String(value ?? '')
                          }
                          labelFormatter={(label) =>
                            label === 'other'
                              ? t('tenantDashboard.modelDistribution.other', { defaultValue: 'Other' })
                              : String(label)
                          }
                        />
                        <Bar dataKey="value" fill="#0ea5e9" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardBody>
            </Card>
          </AnimatedContent>
        </div>

        <Card className="border border-white/40 bg-white/72 backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/55">
          <CardHeader>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('tenantDashboard.tokenSummary.title', { defaultValue: 'Token component summary' })}
            </p>
          </CardHeader>
          <CardBody className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {tokenBreakdownRows.map((row) => (
              <div key={row.key} className="rounded-xl border border-slate-200/70 bg-white/70 p-3 dark:border-slate-700/70 dark:bg-slate-900/50">
                <p className="text-xs text-slate-500 dark:text-slate-400">{row.label}</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{formatTokenCount(row.value)}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
