import { Icon } from '@iconify/react'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Progress,
  Spinner,
} from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Archive,
  Gauge,
  RefreshCcw,
  ShieldCheck,
  Timer,
  TriangleAlert,
} from 'lucide-react'
import { useMemo, useState } from 'react'
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

import { useSpringNumber } from '@/lib/use-spring-number'
import { accountPoolApi } from '@/api/accounts'
import { dashboardApi } from '@/api/dashboard'
import { adminApi } from '@/api/settings'
import { usageApi } from '@/api/usage'
import {
  DockedPageIntro,
  PageContent,
} from '@/components/layout/page-archetypes'
import { CHART_SERIES_COLORS, useChartTheme } from '@/lib/chart-theme'
import {
  buildDashboardKpis,
  buildModelDistribution,
  buildTopApiKeys,
  buildTokenTrend,
  buildTrafficData,
} from '@/features/usage/contracts'
import { formatDurationMs } from '@/lib/duration-format'
import { cn } from '@/lib/utils'

const POOL_TONE_CLASS_NAMES = {
  brand: 'border-primary-200 bg-primary-50 text-primary-700 dark:bg-primary/10 dark:text-primary-300',
  success: 'border-success-200 bg-success-50 text-success-700 dark:bg-success/10 dark:text-success-300',
  warning: 'border-warning-200 bg-warning-50 text-warning-700 dark:bg-warning/10 dark:text-warning-300',
  danger: 'border-danger-200 bg-danger-50 text-danger-700 dark:bg-danger/10 dark:text-danger-300',
} as const

const POOL_PROGRESS_COLORS = {
  brand: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
} as const

const POOL_ACCENT_CLASS_NAMES = {
  brand: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
} as const

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

/** 弹簧动画数字：从旧值平滑过渡到新值，刷新时有触感反馈 */
function SpringKpiValue({ rawValue, format }: { rawValue: number; format: (n: number) => string }) {
  const animated = useSpringNumber(rawValue, { stiffness: 100, damping: 18 })
  return <>{format(animated)}</>
}

export default function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { textColor: chartTextColor, gridColor: chartGridColor, tooltipStyle: chartTooltipStyle } = useChartTheme()
  const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [{ startTs, endTs }] = useState(() => {
    const endTs = Math.floor(Date.now() / 1000)
    const startTs = endTs - 86400
    return { startTs, endTs }
  })

  const { data: systemState, isLoading: isLoadingSystem } = useQuery({
    queryKey: ['dashboardSystemState'],
    queryFn: adminApi.getSystemState,
    refetchInterval: 30_000,
  })

  const { data: summaryData, isLoading: isLoadingSummary } = useQuery({
    queryKey: ['dashboardUsageSummary', startTs, endTs],
    queryFn: () => dashboardApi.getUsageSummary({ start_ts: startTs, end_ts: endTs }),
    refetchInterval: 30_000,
  })

  const { data: hourlyTrends, isLoading: isLoadingTrends } = useQuery({
    queryKey: ['dashboardHourlyTrends', startTs, endTs],
    queryFn: () =>
      dashboardApi.getHourlyTrends({
        start_ts: startTs,
        end_ts: endTs,
        limit: 24,
      }),
    refetchInterval: 30_000,
  })

  const { data: leaderboard, isLoading: isLoadingLeaderboard } = useQuery({
    queryKey: ['dashboardLeaderboard', startTs, endTs],
    queryFn: () =>
      usageApi.getLeaderboard({
        start_ts: startTs,
        end_ts: endTs,
        limit: 5,
      }),
    refetchInterval: 60_000,
  })

  const { data: accountPoolSummary } = useQuery({
    queryKey: ['dashboardAccountPoolSummary'],
    queryFn: accountPoolApi.getSummary,
    refetchInterval: 60_000,
  })

  const kpis = buildDashboardKpis(summaryData, systemState?.counts)
  const alerts = useMemo(() => {
    const next: Array<{
      id: string
      severity: 'critical' | 'warning'
      status: 'open' | 'resolved'
      message: string
    }> = []

    if (systemState?.data_plane_error) {
      next.push({
        id: 'data-plane-error',
        severity: 'critical',
        status: 'open',
        message: t('dashboard.alerts.dataPlaneDisconnected', {
          defaultValue: 'Data plane is disconnected',
        }),
      })
    }
    if (systemState && !systemState.usage_repo_available) {
      next.push({
        id: 'usage-repo-unavailable',
        severity: 'warning',
        status: 'open',
        message: t('dashboard.alerts.usageRepoUnavailable', {
          defaultValue: 'Usage analytics storage is unavailable',
        }),
      })
    }

    return next
  }, [systemState, t])

  const trafficData = useMemo(() => buildTrafficData(hourlyTrends), [hourlyTrends])
  const tokenTrend = useMemo(() => buildTokenTrend(summaryData), [summaryData])
  const topApiKeys = useMemo(() => buildTopApiKeys(leaderboard), [leaderboard])
  const topApiKeysMax = topApiKeys[0]?.requests ?? 0
  const modelDistribution = useMemo(() => buildModelDistribution(summaryData), [summaryData])

  // 图表版本号：数据更新时递增，用作 key 强制重新运行入场动画
  const chartAnimKey = useMemo(() => ({
    traffic: `traffic-${hourlyTrends?.account_totals?.length ?? 0}-${hourlyTrends?.account_totals?.[0]?.hour_start ?? 0}`,
    token: `token-${summaryData?.dashboard_metrics?.token_trends?.length ?? 0}`,
    model: `model-${modelDistribution.length}-${modelDistribution[0]?.requests ?? 0}`,
  }), [hourlyTrends, summaryData, modelDistribution])

  const overviewMetrics = useMemo(
    () => [
      {
        title: t('dashboard.kpi.totalRequests'),
        rawValue: kpis.totalRequests,
        format: formatNumber,
        description: t('dashboard.antigravity.last24Hours', { defaultValue: 'Last 24 hours' }),
      },
      {
        title: t('dashboard.kpi.totalTokens'),
        rawValue: kpis.totalTokens,
        format: formatNumber,
        description: t('dashboard.kpi.totalTokensDesc'),
      },
      {
        title: t('dashboard.kpi.rpm'),
        rawValue: kpis.rpm,
        format: (n: number) => n.toString(),
        description: t('dashboard.kpi.rpmDesc'),
      },
      {
        title: t('dashboard.kpi.avgFirstTokenSpeed'),
        rawValue: kpis.avgFirstTokenMs,
        format: formatDurationMs,
        description: t('dashboard.kpi.avgFirstTokenSpeedDesc'),
      },
      {
        title: t('dashboard.kpi.tenants'),
        rawValue: kpis.tenantCount,
        format: (n: number) => n.toString(),
        description: t('dashboard.kpi.tenantsDesc'),
      },
      {
        title: t('dashboard.kpi.accounts'),
        rawValue: kpis.accountCount,
        format: (n: number) => n.toString(),
        description: t('dashboard.antigravity.activeAccounts', {
          count: kpis.activeAccounts,
          defaultValue: '{{count}} active',
        }),
      },
      {
        title: t('dashboard.kpi.apiKeys'),
        rawValue: kpis.apiKeyCount,
        format: (n: number) => n.toString(),
        description: t('dashboard.kpi.apiKeysDesc'),
      },
      {
        title: t('dashboard.kpi.tpm'),
        rawValue: kpis.tpm,
        format: formatNumber,
        description: t('dashboard.kpi.tpmDesc'),
      },
    ],
    [kpis, t],
  )

  const poolOverviewMetrics = useMemo(
    () => [
      {
        title: t('dashboard.poolOverview.inventory'),
        value: accountPoolSummary?.inventory ?? 0,
        description: t('dashboard.poolOverview.inventoryDesc'),
        tone: 'brand' as const,
        icon: <Archive aria-hidden="true" className="h-5 w-5" />,
      },
      {
        title: t('dashboard.poolOverview.routable'),
        value: accountPoolSummary?.routable ?? 0,
        description: t('dashboard.poolOverview.routableDesc'),
        tone: 'success' as const,
        icon: <ShieldCheck aria-hidden="true" className="h-5 w-5" />,
      },
      {
        title: t('dashboard.poolOverview.cooling'),
        value: accountPoolSummary?.cooling ?? 0,
        description: t('dashboard.poolOverview.coolingDesc'),
        tone: 'warning' as const,
        icon: <Gauge aria-hidden="true" className="h-5 w-5" />,
      },
      {
        title: t('dashboard.poolOverview.pendingDelete'),
        value: accountPoolSummary?.pending_delete ?? 0,
        description: t('dashboard.poolOverview.pendingDeleteDesc'),
        tone: 'danger' as const,
        icon: <TriangleAlert aria-hidden="true" className="h-5 w-5" />,
      },
    ],
    [accountPoolSummary, t],
  )

  const totalManagedPool = useMemo(
    () => poolOverviewMetrics.reduce((sum, metric) => sum + metric.value, 0),
    [poolOverviewMetrics],
  )

  const poolOverviewSummaryMetrics = useMemo(
    () =>
      poolOverviewMetrics.map((metric) => ({
        ...metric,
        ratio: totalManagedPool > 0
          ? Math.round((metric.value / totalManagedPool) * 100)
          : 0,
      })),
    [poolOverviewMetrics, totalManagedPool],
  )

  const healthSignalMetrics = useMemo(
    () => [
      {
        title: t('dashboard.healthSignals.healthy'),
        value: accountPoolSummary?.healthy ?? 0,
        description: t('dashboard.healthSignals.healthyDesc'),
        icon: <ShieldCheck aria-hidden="true" className="h-4 w-4 text-success" />,
      },
      {
        title: t('dashboard.healthSignals.quota'),
        value: accountPoolSummary?.quota ?? 0,
        description: t('dashboard.healthSignals.quotaDesc'),
        icon: <Timer aria-hidden="true" className="h-4 w-4 text-warning" />,
      },
      {
        title: t('dashboard.healthSignals.fatal'),
        value: accountPoolSummary?.fatal ?? 0,
        description: t('dashboard.healthSignals.fatalDesc'),
        icon: <TriangleAlert aria-hidden="true" className="h-4 w-4 text-danger" />,
      },
      {
        title: t('dashboard.healthSignals.transient'),
        value: accountPoolSummary?.transient ?? 0,
        description: t('dashboard.healthSignals.transientDesc'),
        icon: <RefreshCcw aria-hidden="true" className="h-4 w-4 text-secondary" />,
      },
      {
        title: t('dashboard.healthSignals.admin'),
        value: accountPoolSummary?.admin ?? 0,
        description: t('dashboard.healthSignals.adminDesc'),
        icon: <Archive aria-hidden="true" className="h-4 w-4 text-primary" />,
      },
    ],
    [accountPoolSummary, t],
  )

  const isLoading = isLoadingSystem || isLoadingSummary || isLoadingTrends || isLoadingLeaderboard

  const handlePoolOverviewAction = (actionKey: string | number) => {
    switch (String(actionKey)) {
      case 'accounts':
        navigate('/accounts')
        break
      case 'logs':
        navigate('/logs')
        break
      case 'imports':
        navigate('/imports')
        break
      default:
        break
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-100px)] w-full items-center justify-center">
        <Spinner
          size="lg"
          color="primary"
          label={t('dashboard.antigravity.loading', { defaultValue: 'Loading dashboard data…' })}
        />
      </div>
    )
  }

  return (
    <PageContent className="space-y-10">
      <DockedPageIntro
        archetype="workspace"
        title={t('dashboard.title')}
        description={t('dashboard.subtitle')}
      />

      {/* ── Pool 数据概览（紧凑分组） ── */}
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {overviewMetrics.map((metric) => (
            <Card
              key={metric.title}
              className="border-small border-default-200 bg-content1 shadow-small"
            >
              <CardBody className="space-y-2 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-default-500">
                  {metric.title}
                </div>
                <div className="text-[clamp(1.8rem,4vw,2.5rem)] font-semibold leading-none tracking-[-0.04em] text-foreground tabular-nums">
                  <SpringKpiValue rawValue={metric.rawValue} format={metric.format} />
                </div>
                <p className="text-sm leading-6 text-default-600">
                  {metric.description}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>

        <Card className="border-small border-default-200 bg-content1 shadow-small">
          <CardHeader className="flex flex-col gap-4 px-5 pb-0 pt-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                {t('dashboard.poolOverview.title')}
              </h2>
              <p className="text-sm leading-6 text-default-600">
                {t('dashboard.poolOverview.description')}
              </p>
            </div>

            <div className="w-full rounded-large border border-default-200 bg-content2/55 px-4 py-4 lg:max-w-[520px]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-default-500">
                    {t('dashboard.poolOverview.totalLabel', { defaultValue: '总计' })}
                  </div>
                  <div className="tabular-nums text-[clamp(1.8rem,3vw,2.5rem)] font-semibold leading-none tracking-[-0.05em] text-foreground">
                    {formatNumber(totalManagedPool)}
                  </div>
                </div>

                <Dropdown placement="bottom-end">
                  <DropdownTrigger>
                    <Button
                      aria-label={t('dashboard.actions.openMenu', { defaultValue: 'Open actions menu' })}
                      radius="full"
                      size="sm"
                      variant="flat"
                    >
                      <Icon icon="solar:menu-dots-bold" className="text-lg text-default-500" />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu aria-label={t('dashboard.poolOverview.title')} onAction={handlePoolOverviewAction}>
                    <DropdownItem key="accounts">
                      {t('dashboard.actions.viewAccounts', { defaultValue: 'View accounts' })}
                    </DropdownItem>
                    <DropdownItem key="logs">
                      {t('dashboard.actions.viewLogs', { defaultValue: 'View request logs' })}
                    </DropdownItem>
                    <DropdownItem key="imports">
                      {t('dashboard.actions.viewImports', { defaultValue: 'View imports' })}
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex h-2 overflow-hidden rounded-full bg-default-100">
                  {poolOverviewSummaryMetrics.map((metric) => (
                    metric.value > 0 ? (
                      <span
                        key={metric.title}
                        aria-hidden="true"
                        className={cn('h-full', POOL_ACCENT_CLASS_NAMES[metric.tone])}
                        style={{ flexBasis: 0, flexGrow: metric.value }}
                      />
                    ) : null
                  ))}
                  {totalManagedPool === 0 ? (
                    <span aria-hidden="true" className="h-full flex-1 bg-default-200" />
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {poolOverviewSummaryMetrics.map((metric) => (
                    <div key={metric.title} className="flex items-center gap-2 text-xs text-default-600">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', POOL_ACCENT_CLASS_NAMES[metric.tone])} />
                      <span>{metric.title}</span>
                      <span className="tabular-nums text-default-500">{metric.ratio}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>

          <CardBody className="grid gap-5 px-5 pb-5 pt-5 sm:grid-cols-2 xl:grid-cols-4">
            {poolOverviewSummaryMetrics.map((metric) => (
              <div
                key={metric.title}
                className="flex h-full flex-col gap-5 rounded-large border-small border-default-200 bg-content1 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-large border-small',
                      POOL_TONE_CLASS_NAMES[metric.tone],
                    )}
                  >
                    {metric.icon}
                  </div>
                  <Chip color={POOL_PROGRESS_COLORS[metric.tone]} size="sm" variant="flat">
                    {metric.ratio}%
                  </Chip>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-default-500">
                    {metric.title}
                  </div>
                  <div className="text-[clamp(2rem,4vw,2.8rem)] font-semibold leading-none tracking-[-0.045em] text-foreground">
                    {formatNumber(metric.value)}
                  </div>
                  <p className="text-sm leading-6 text-default-600">
                    {metric.description}
                  </p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {/* ── 监控区域 ── */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
        <Card className="border-small border-default-200 bg-content1 shadow-small">
          <CardHeader className="px-5 pb-3 pt-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                {t('dashboard.healthSignals.title')}
              </h2>
              <p className="text-sm leading-6 text-default-600">
                {t('dashboard.healthSignals.description')}
              </p>
            </div>
          </CardHeader>
          <CardBody className="grid gap-3 px-5 pb-5 pt-1 md:grid-cols-2 xl:grid-cols-5">
            {healthSignalMetrics.map((metric) => (
              <div
                key={metric.title}
                className="rounded-large border border-default-200 bg-content2/55 px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-large bg-content1">
                    {metric.icon}
                  </div>
                  <Chip size="sm" variant="flat">
                    {formatNumber(metric.value)}
                  </Chip>
                </div>
                <div className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-default-500">
                  {metric.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-default-600">
                  {metric.description}
                </p>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card className="border-small border-warning/20 bg-warning/[0.04] shadow-small dark:bg-warning/[0.07]">
          <CardHeader className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                {t('dashboard.alerts.title')}
              </h2>
              <p className="text-sm leading-6 text-default-600">
                {alerts.length > 0
                  ? t('dashboard.overview.attentionNeeded')
                  : t('dashboard.overview.stable')}
              </p>
            </div>
            <Chip
              color={alerts.length > 0 ? 'warning' : 'success'}
              size="sm"
              variant="flat"
            >
              {alerts.length}
            </Chip>
          </CardHeader>
          <CardBody className="gap-3 px-5 pb-5 pt-1">
            {alerts.length > 0 ? (
              alerts.map((alert, index) => (
                <div key={alert.id}>
                  <div className="flex items-start gap-3 rounded-large bg-content1/85 px-3 py-3">
                    <div className={cn(
                      'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-large',
                      alert.severity === 'warning' ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger',
                    )}
                    >
                      <AlertTriangle aria-hidden="true" className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip
                          color={alert.severity === 'warning' ? 'warning' : 'danger'}
                          size="sm"
                          variant="flat"
                        >
                          {t(`dashboard.alerts.severity.${alert.severity}`, {
                            defaultValue: alert.severity,
                          })}
                        </Chip>
                        <Chip
                          color={alert.status === 'open' ? 'warning' : 'success'}
                          size="sm"
                          variant="flat"
                        >
                          {t(`dashboard.alerts.status.${alert.status}`, {
                            defaultValue: alert.status,
                          })}
                        </Chip>
                      </div>
                      <div className="text-sm leading-6 text-foreground">{alert.message}</div>
                    </div>
                  </div>
                  {index < alerts.length - 1 ? <div className="h-2" /> : null}
                </div>
              ))
            ) : (
              <div className="rounded-large border border-dashed border-default-200 bg-content1/85 px-4 py-6 text-sm text-default-600">
                {t('dashboard.alerts.emptyDescription', {
                  defaultValue: 'No active infrastructure or usage pipeline alerts are visible in the current window.',
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <Card className="border-small border-default-200 bg-content1 shadow-small">
          <CardHeader className="px-5 pb-3 pt-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                {t('dashboard.trafficChart.title')}
              </h2>
              <p className="text-sm leading-6 text-default-600">
                {t('dashboard.trafficChart.subtitle')}
              </p>
            </div>
          </CardHeader>
          <CardBody className="px-5 pb-5 pt-1">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart key={chartAnimKey.traffic} data={trafficData}>
                <defs>
                  <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--heroui-success))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--heroui-success))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dangerGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--heroui-danger))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--heroui-danger))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="hour" tick={{ fill: chartTextColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: chartTextColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Area type="monotone" dataKey="accounts" stroke="hsl(var(--heroui-success))" fill="url(#successGradient)" strokeWidth={2} isAnimationActive={!prefersReducedMotion} animationDuration={1000} animationEasing="ease-out" animationBegin={0} />
                <Area type="monotone" dataKey="apiKeys" stroke="hsl(var(--heroui-danger))" fill="url(#dangerGradient)" strokeWidth={2} isAnimationActive={!prefersReducedMotion} animationDuration={1000} animationEasing="ease-out" animationBegin={120} />
              </AreaChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card className="border-small border-default-200 bg-content1 shadow-small">
          <CardHeader className="px-5 pb-3 pt-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                {t('dashboard.tokenTrend.title')}
              </h2>
              <p className="text-sm leading-6 text-default-600">
                {t('dashboard.tokenTrend.description')}
              </p>
            </div>
          </CardHeader>
          <CardBody className="px-5 pb-5 pt-1">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart key={chartAnimKey.token} data={tokenTrend}>
                <defs>
                  <linearGradient id="inputGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_SERIES_COLORS.input} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_SERIES_COLORS.input} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="outputGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_SERIES_COLORS.output} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_SERIES_COLORS.output} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="hour" tick={{ fill: chartTextColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: chartTextColor, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value: number | string | readonly (number | string)[] | undefined) =>
                    formatNumber(Number(Array.isArray(value) ? value[0] ?? 0 : value ?? 0))}
                />
                <Area type="monotone" dataKey="input" stroke={CHART_SERIES_COLORS.input} fill="url(#inputGradient)" strokeWidth={2} isAnimationActive={!prefersReducedMotion} animationDuration={1100} animationEasing="ease-out" animationBegin={0} />
                <Area type="monotone" dataKey="cached" stroke={CHART_SERIES_COLORS.cached} fill="none" strokeWidth={1.5} strokeDasharray="4 4" isAnimationActive={!prefersReducedMotion} animationDuration={1100} animationEasing="ease-out" animationBegin={100} />
                <Area type="monotone" dataKey="output" stroke={CHART_SERIES_COLORS.output} fill="url(#outputGradient)" strokeWidth={2} isAnimationActive={!prefersReducedMotion} animationDuration={1100} animationEasing="ease-out" animationBegin={200} />
                <Area type="monotone" dataKey="reasoning" stroke={CHART_SERIES_COLORS.reasoning} fill="none" strokeWidth={1.5} isAnimationActive={!prefersReducedMotion} animationDuration={1100} animationEasing="ease-out" animationBegin={300} />
              </AreaChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-small border-default-200 bg-content1 shadow-small">
          <CardHeader className="px-5 pb-3 pt-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                {t('dashboard.modelDistribution.title')}
              </h2>
              <p className="text-sm leading-6 text-default-600">
                {t('dashboard.modelDistribution.description')}
              </p>
            </div>
          </CardHeader>
          <CardBody className="px-5 pb-5 pt-1">
            {modelDistribution.length === 0 ? (
              <div className="flex h-[280px] items-center justify-center text-sm text-default-600">
                {t('dashboard.modelDistribution.empty')}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart key={chartAnimKey.model} data={modelDistribution} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} horizontal={false} />
                  <XAxis type="number" tick={{ fill: chartTextColor, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
                  <YAxis type="category" dataKey="model" tick={{ fill: chartTextColor, fontSize: 11 }} axisLine={false} tickLine={false} width={120} />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(value: number | string | readonly (number | string)[] | undefined) =>
                      formatNumber(Number(Array.isArray(value) ? value[0] ?? 0 : value ?? 0))}
                  />
                  <Bar dataKey="requests" fill="hsl(var(--heroui-primary))" radius={[0, 6, 6, 0]} barSize={20} isAnimationActive={!prefersReducedMotion} animationDuration={900} animationEasing="ease-out" animationBegin={0} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        <Card className="border-small border-default-200 bg-content1 shadow-small">
          <CardHeader className="px-5 pb-3 pt-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                {t('dashboard.topApiKeys.title')}
              </h2>
              <p className="text-sm leading-6 text-default-600">
                {t('dashboard.topApiKeys.scopeDescription', {
                  scope: t('dashboard.scope.global'),
                })}
              </p>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-3 px-5 pb-5 pt-1">
            {topApiKeys.length === 0 ? (
              <div className="flex h-[280px] items-center justify-center text-sm text-default-600">
                {t('dashboard.topApiKeys.empty')}
              </div>
            ) : (
              topApiKeys.map((key, index) => {
                const progressValue = topApiKeysMax > 0 ? (key.requests / topApiKeysMax) * 100 : 0

                return (
                  <div key={key.apiKeyId} className="rounded-large border border-default-200 bg-content2/55 px-4 py-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-default-100 text-xs font-semibold text-default-600">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {key.apiKeyId}
                        </div>
                        <div className="text-xs text-default-500">{key.tenantId}</div>
                      </div>
                      <Chip color="primary" size="sm" variant="flat">
                        {formatNumber(key.requests)}
                      </Chip>
                    </div>
                    <div className="mt-3">
                      <Progress
                        aria-label={key.apiKeyId}
                        color="primary"
                        radius="full"
                        size="sm"
                        value={progressValue}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </CardBody>
        </Card>
      </div>
      </div>
    </PageContent>
  )
}
