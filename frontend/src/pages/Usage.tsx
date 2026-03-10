import { useMemo, useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { motion, useReducedMotion } from 'framer-motion'
import { Cpu, Download, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { usageApi } from '@/api/usage'
import type { HourlyTenantUsageTotalPoint } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card'
import { StandardDataTable } from '@/components/ui/standard-data-table'
import { TrendChart } from '@/components/ui/trend-chart'
import { formatExactCount } from '@/lib/count-number-format'
import { formatPercent, resolveLocale } from '@/lib/i18n-format'
import { cn } from '@/lib/utils'

interface TopKeyRow {
    name: string
    tenantId: string
    apiKeyId: string
    requests: number
    share: number
}

function shareBarClass(share: number) {
    if (share >= 60) {
        return 'bg-rose-500'
    }
    if (share >= 30) {
        return 'bg-warning'
    }
    return 'bg-success'
}

export default function Usage() {
    const { t, i18n } = useTranslation()
    const locale = resolveLocale(i18n.resolvedLanguage ?? i18n.language)
    const [{ startTs, endTs }] = useState(() => {
        const endTs = Math.floor(Date.now() / 1000)
        const startTs = Math.floor(subDays(new Date(), 30).getTime() / 1000)
        return { startTs, endTs }
    })
    const xAxisDateFormatter = useMemo(
        () =>
            new Intl.DateTimeFormat(locale, {
                month: 'short',
                day: 'numeric',
            }),
        [locale],
    )
    const prefersReducedMotion = useReducedMotion()

    const { data: trendData, isLoading: isLoadingTrends } = useQuery({
        queryKey: ['tenantHourlyTrends', startTs, endTs],
        queryFn: () => usageApi.getHourlyTenantTrends({ start_ts: startTs, end_ts: endTs, limit: 30 * 24 }),
        refetchInterval: 60000
    })

    const { data: leaderboard, isLoading: isLoadingLeaderboard } = useQuery({
        queryKey: ['usageLeaderboard', startTs, endTs],
        queryFn: () => usageApi.getLeaderboard({ start_ts: startTs, end_ts: endTs }),
        refetchInterval: 60000
    })

    // Aggregate hourly data over the 30-day window per day for the chart
    const dailyVolume = trendData?.items.reduce((acc: Record<string, number>, curr: HourlyTenantUsageTotalPoint) => {
        const dayStr = format(new Date(curr.hour_start * 1000), 'yyyy-MM-dd')
        acc[dayStr] = (acc[dayStr] || 0) + curr.request_count
        return acc
    }, {}) || {}

    const chartData = Object.entries(dailyVolume).map(([date, tokens]) => ({
        timestamp: new Date(date).toISOString(),
        requests: tokens
    })).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    const keysUsage = useMemo(
        () => leaderboard?.api_keys ?? [],
        [leaderboard?.api_keys],
    )
    const totalRequests = useMemo(
        () => keysUsage.reduce((sum, item) => sum + item.total_requests, 0),
        [keysUsage],
    )

    const topKeyRows = useMemo<TopKeyRow[]>(() => {
        return keysUsage
            .map((item) => {
                const tenantLabel = item.tenant_id?.trim()
                const share = totalRequests > 0 ? (item.total_requests / totalRequests) * 100 : 0
                return {
                    name: tenantLabel || t('usage.topKeys.keyFallback', { keyId: item.api_key_id.split('-')[0] }),
                    tenantId: item.tenant_id,
                    apiKeyId: item.api_key_id,
                    requests: item.total_requests,
                    share,
                }
            })
            .sort((left, right) => right.requests - left.requests)
    }, [keysUsage, t, totalRequests])

    const topKeyColumns = useMemo<ColumnDef<TopKeyRow>[]>(() => {
        return [
            {
                id: 'name',
                header: t('usage.topKeys.columns.name'),
                accessorFn: (row) => row.name.toLowerCase(),
                cell: ({ row }) => (
                    <div className="space-y-1 min-w-[220px]">
                        <div className="font-medium">{row.original.name}</div>
                        <div className="text-xs font-mono text-muted-foreground truncate">
                            {t('usage.topKeys.columns.apiKey')}: {row.original.apiKeyId}
                        </div>
                    </div>
                ),
            },
            {
                id: 'requests',
                header: t('usage.topKeys.columns.requests'),
                accessorKey: 'requests',
                cell: ({ row }) => (
                    <span className="font-mono tabular-nums">
                        {formatExactCount(row.original.requests, locale)}
                    </span>
                ),
            },
            {
                id: 'share',
                header: t('usage.topKeys.columns.share'),
                accessorKey: 'share',
                cell: ({ row }) => {
                    const share = Math.max(0, Math.min(100, row.original.share))
                    return (
                        <div className="space-y-1 min-w-[140px]">
                            <div className="text-xs text-muted-foreground tabular-nums">
                                {formatPercent(share, {
                                    locale,
                                    inputScale: 'percent',
                                    minimumFractionDigits: 1,
                                    maximumFractionDigits: 1,
                                })}
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                    className={cn('h-full transition-[width] duration-300', shareBarClass(share))}
                                    style={{ width: `${share}%` }}
                                />
                            </div>
                        </div>
                    )
                },
            },
        ]
    }, [locale, t])

    const container = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    }

    const item = {
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
    }

    const handleExportTopKeysCsv = () => {
        const rows = [
            [
                t('usage.topKeys.columns.name', { defaultValue: 'Name' }),
                t('usage.topKeys.columns.requests', { defaultValue: 'Requests' }),
                t('usage.topKeys.columns.share', { defaultValue: 'Share' }),
                t('usage.topKeys.columns.apiKey', { defaultValue: 'API Key' }),
                t('usage.topKeys.columns.tenant', { defaultValue: 'Tenant' }),
            ],
            ...topKeyRows.map((row) => [
                row.name,
                String(row.requests),
                row.share.toFixed(4),
                row.apiKeyId,
                row.tenantId,
            ]),
        ]
        const escapeCsvField = (value: string) => {
            if (value.includes('"') || value.includes(',') || value.includes('\n')) {
                return `"${value.replaceAll('"', '""')}"`
            }
            return value
        }
        const csvContent = `${rows.map((line) => line.map(escapeCsvField).join(',')).join('\n')}\n`
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `usage-top-keys-${Date.now()}.csv`
        anchor.click()
        URL.revokeObjectURL(url)
    }

    return (
        <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            transition={prefersReducedMotion ? { duration: 0 } : undefined}
            className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto w-full"
        >
            <motion.div variants={item} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">{t('usage.title')}</h2>
                    <p className="text-muted-foreground mt-1">{t('usage.subtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        className="hover:bg-muted/50 transition-colors"
                        onClick={handleExportTopKeysCsv}
                        disabled={topKeyRows.length === 0}
                    >
                        <Download className="mr-2 h-4 w-4" /> {t('usage.actions.export')}
                    </Button>
                </div>
            </motion.div>

            <div className="grid gap-6 md:grid-cols-3">
                <motion.div variants={item} className="col-span-2">
                    <Card className="h-full shadow-sm border-border/50 hover:shadow-md transition-shadow duration-300 relative overflow-hidden">
                        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 relative z-10">
                            <div>
                                <CardTitle>{t('usage.chart.title')}</CardTitle>
                                <CardDescription className="mt-1">{t('usage.chart.subtitle')}</CardDescription>
                            </div>
                            <div className="p-2 bg-primary/5 rounded-md relative z-10">
                                <TrendingUp className="h-4 w-4 text-primary/70" />
                            </div>
                        </CardHeader>
                        <CardContent className="relative z-10">
                            {isLoadingTrends ? (
                                <div className="w-full h-[320px] bg-muted/50 animate-pulse rounded-md" />
                            ) : chartData.length === 0 ? (
                                <div className="w-full h-[320px] flex items-center justify-center text-muted-foreground bg-muted/20 rounded-md border border-dashed border-border/50">
                                    {t('usage.chart.empty')}
                                </div>
                            ) : (
                                <TrendChart
                                    data={chartData}
                                    lines={[{ dataKey: 'requests', name: t('usage.chart.requests'), stroke: 'var(--chart-1)' }]}
                                    height={320}
                                    locale={locale}
                                    valueFormatter={(value) => formatExactCount(value, locale)}
                                    xAxisFormatter={(val) => xAxisDateFormatter.format(new Date(val))}
                                />
                            )}
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div variants={item}>
                    <Card className="h-full shadow-sm border-border/50 hover:shadow-md transition-shadow duration-300">
                        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                            <div>
                                <CardTitle>{t('usage.topKeys.title')}</CardTitle>
                                <CardDescription className="mt-1">{t('usage.topKeys.subtitle')}</CardDescription>
                            </div>
                            <div className="p-2 bg-muted rounded-md text-muted-foreground">
                                <Cpu className="h-4 w-4" />
                            </div>
                        </CardHeader>
                        <CardContent className="h-[360px] min-h-0">
                            {isLoadingLeaderboard ? (
                                <div className="space-y-3">
                                    {Array.from({ length: 6 }).map((_, index) => (
                                        <div key={index} className="h-9 rounded bg-muted animate-pulse" />
                                    ))}
                                </div>
                            ) : (
                                <StandardDataTable
                                    columns={topKeyColumns}
                                    data={topKeyRows}
                                    density="compact"
                                    defaultPageSize={8}
                                    pageSizeOptions={[8, 16, 32, 64]}
                                    className="h-full"
                                    emptyText={t('usage.topKeys.empty')}
                                    searchPlaceholder={t('usage.topKeys.searchPlaceholder')}
                                    searchFn={(row, keyword) => (
                                        `${row.name} ${row.tenantId} ${row.apiKeyId}`.toLowerCase().includes(keyword)
                                    )}
                                />
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        </motion.div>
    )
}
