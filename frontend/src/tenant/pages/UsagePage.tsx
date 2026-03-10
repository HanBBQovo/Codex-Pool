import { useMemo, useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { tenantKeysApi } from '@/api/tenantKeys'
import { tenantUsageApi } from '@/api/tenantUsage'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StandardDataTable } from '@/components/ui/standard-data-table'
import { TrendChart } from '@/components/ui/trend-chart'
import { formatExactCount } from '@/lib/count-number-format'
import { currentRangeByDays } from '@/tenant/lib/format'

type RangePreset = 1 | 7 | 30

interface KeyUsageRow {
  apiKeyId: string
  tenantId: string
  requests: number
}

interface HourlyUsageRow {
  hourStart: number
  requests: number
}

export function TenantUsagePage() {
  const { t } = useTranslation()
  const [rangePreset, setRangePreset] = useState<RangePreset>(7)
  const [apiKeyId, setApiKeyId] = useState<string>('all')

  const range = useMemo(() => currentRangeByDays(rangePreset), [rangePreset])
  const selectedApiKeyId = apiKeyId === 'all' ? undefined : apiKeyId

  const { data: keys = [] } = useQuery({
    queryKey: ['tenantKeys', 'usage'],
    queryFn: () => tenantKeysApi.list(),
    staleTime: 60_000,
  })

  const { data: trends } = useQuery({
    queryKey: ['tenantUsageTrends', range.start_ts, range.end_ts, selectedApiKeyId],
    queryFn: () =>
      tenantUsageApi.trendsHourly({
        ...range,
        api_key_id: selectedApiKeyId,
        limit: Math.max(24, rangePreset * 24),
      }),
    refetchInterval: 60_000,
  })

  const { data: apiKeyLeaderboard } = useQuery({
    queryKey: ['tenantApiKeyLeaderboard', range.start_ts, range.end_ts, selectedApiKeyId],
    queryFn: () =>
      tenantUsageApi.leaderboardApiKeys({
        ...range,
        limit: 50,
        api_key_id: selectedApiKeyId,
      }),
    refetchInterval: 60_000,
  })

  const chartData = useMemo(
    () =>
      (trends?.tenant_api_key_totals ?? []).map((point) => ({
        timestamp: point.hour_start * 1000,
        requests: point.request_count,
      })),
    [trends?.tenant_api_key_totals],
  )

  const leaderboardRows = useMemo<KeyUsageRow[]>(
    () =>
      (apiKeyLeaderboard?.items ?? []).map((item) => ({
        apiKeyId: item.api_key_id,
        tenantId: item.tenant_id,
        requests: item.total_requests,
      })),
    [apiKeyLeaderboard?.items],
  )

  const hourlyRows = useMemo<HourlyUsageRow[]>(
    () =>
      (trends?.tenant_api_key_totals ?? []).map((item) => ({
        hourStart: item.hour_start,
        requests: item.request_count,
      })),
    [trends?.tenant_api_key_totals],
  )

  const keyColumns = useMemo<ColumnDef<KeyUsageRow>[]>(
    () => [
      {
        id: 'apiKey',
        header: t('tenantUsage.columns.apiKey', { defaultValue: 'API Key' }),
        accessorFn: (row) => row.apiKeyId.toLowerCase(),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.apiKeyId}</div>
            <div className="text-xs text-muted-foreground">
              {t('tenantUsage.columns.tenantLabel', {
                defaultValue: 'Tenant: {{tenantId}}',
                tenantId: row.original.tenantId,
              })}
            </div>
          </div>
        ),
      },
      {
        id: 'requests',
        header: t('tenantUsage.columns.requests', { defaultValue: 'Requests' }),
        accessorKey: 'requests',
        cell: ({ row }) => <span className="font-mono">{formatExactCount(row.original.requests)}</span>,
      },
    ],
    [t],
  )

  const hourlyColumns = useMemo<ColumnDef<HourlyUsageRow>[]>(
    () => [
      {
        id: 'hour',
        header: t('tenantUsage.columns.time', { defaultValue: 'Time' }),
        accessorFn: (row) => row.hourStart,
        cell: ({ row }) =>
          new Intl.DateTimeFormat(undefined, {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(new Date(row.original.hourStart * 1000)),
      },
      {
        id: 'requests',
        header: t('tenantUsage.columns.requests', { defaultValue: 'Requests' }),
        accessorKey: 'requests',
        cell: ({ row }) => <span className="font-mono">{formatExactCount(row.original.requests)}</span>,
      },
    ],
    [t],
  )

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h2 className="text-3xl font-semibold tracking-tight">
          {t('tenantUsage.title', { defaultValue: 'Title' })}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('tenantUsage.subtitle', { defaultValue: 'Subtitle' })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(rangePreset)}
          onValueChange={(value) => setRangePreset(Number(value) as RangePreset)}
        >
          <SelectTrigger className="w-[170px]" aria-label={t('tenantUsage.filters.rangeAriaLabel', { defaultValue: 'Time range' })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">{t('tenantUsage.filters.range.last24Hours', { defaultValue: 'Last24 Hours' })}</SelectItem>
            <SelectItem value="7">{t('tenantUsage.filters.range.last7Days', { defaultValue: 'Last7 Days' })}</SelectItem>
            <SelectItem value="30">{t('tenantUsage.filters.range.last30Days', { defaultValue: 'Last30 Days' })}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={apiKeyId} onValueChange={setApiKeyId}>
          <SelectTrigger className="min-w-[220px]" aria-label={t('tenantUsage.filters.apiKeyAriaLabel', { defaultValue: 'API key' })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('tenantUsage.filters.apiKeyAll', { defaultValue: 'Api Key All' })}</SelectItem>
            {keys.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name} ({item.key_prefix})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('tenantUsage.trend.title', { defaultValue: 'Title' })}</CardTitle>
          <CardDescription>
            {t('tenantUsage.trend.description', { defaultValue: 'Description' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="h-[280px] rounded-md border border-dashed flex items-center justify-center text-sm text-muted-foreground">
              {t('tenantUsage.trend.empty', { defaultValue: 'Empty' })}
            </div>
          ) : (
            <TrendChart
              data={chartData}
              lines={[
                {
                  dataKey: 'requests',
                  name: t('tenantUsage.columns.requests', { defaultValue: 'Requests' }),
                  stroke: 'var(--chart-1)',
                },
              ]}
              height={280}
              valueFormatter={formatExactCount}
              xAxisFormatter={(value) =>
                new Intl.DateTimeFormat(undefined, {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                }).format(new Date(value))
              }
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('tenantUsage.leaderboard.title', { defaultValue: 'Title' })}</CardTitle>
            <CardDescription>
              {t('tenantUsage.leaderboard.description', { defaultValue: 'Description' })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StandardDataTable
              columns={keyColumns}
              data={leaderboardRows}
              defaultPageSize={10}
              pageSizeOptions={[10, 20, 50]}
              density="compact"
              emptyText={t('tenantUsage.leaderboard.empty', { defaultValue: 'Empty' })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('tenantUsage.hourly.title', { defaultValue: 'Title' })}</CardTitle>
            <CardDescription>
              {t('tenantUsage.hourly.description', { defaultValue: 'Description' })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StandardDataTable
              columns={hourlyColumns}
              data={hourlyRows}
              defaultPageSize={10}
              pageSizeOptions={[10, 20, 50]}
              density="compact"
              emptyText={t('tenantUsage.hourly.empty', { defaultValue: 'Empty' })}
              enableSearch={false}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
