import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import type { TFunction } from 'i18next'
import {
  FileText,
  HardDriveDownload,
  Loader2,
  PlayCircle,
  RotateCcw,
  Search,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { importJobsApi, type OAuthImportItemStatus, type OAuthImportJobItem } from '@/api/importJobs'
import { localizeApiErrorDisplay } from '@/api/errorI18n'
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

import type { ConfirmAction } from './types'
import {
  calcProgress,
  formatPercent,
  getEtaLabel,
  getImportStatusFilterOptions,
  getImportStatusLabel,
} from './utils'

function normalizeImportErrorCode(code: string | undefined | null): string {
  return (code ?? '').trim().toLowerCase()
}

function localizeImportErrorCode(errorCode: string | undefined | null, t: TFunction): string {
  switch (normalizeImportErrorCode(errorCode)) {
    case 'invalid_record':
      return t('importJobs.errors.invalidRecord', { defaultValue: 'Invalid record' })
    case 'missing_access_token':
      return t('importJobs.errors.missingAccessToken', { defaultValue: 'Missing access token' })
    case 'missing_refresh_token':
      return t('importJobs.errors.missingRefreshToken', { defaultValue: 'Missing refresh token' })
    case 'missing_credentials':
      return t('importJobs.errors.missingCredentials', { defaultValue: 'Missing credentials' })
    case 'refresh_token_reused':
      return t('importJobs.errors.refreshTokenReused', { defaultValue: 'Refresh token already used' })
    case 'invalid_refresh_token':
      return t('importJobs.errors.invalidRefreshToken', { defaultValue: 'Invalid refresh token' })
    case 'oauth_provider_not_configured':
      return t('importJobs.errors.oauthProviderNotConfigured', {
        defaultValue: 'OAuth provider not configured',
      })
    case 'rate_limited':
      return t('importJobs.errors.rateLimited', { defaultValue: 'Rate limited' })
    case 'upstream_network_error':
      return t('importJobs.errors.upstreamNetworkError', { defaultValue: 'Upstream network error' })
    case 'upstream_unavailable':
      return t('importJobs.errors.upstreamUnavailable', { defaultValue: 'Upstream service unavailable' })
    case 'import_failed':
      return t('importJobs.errors.importFailed', { defaultValue: 'Import failed' })
    default:
      return t('importJobs.errors.unknown', { defaultValue: 'Unknown import error' })
  }
}

export function LiveProgressPanel({
  jobId,
  confirmAction,
}: {
  jobId: string | null
  confirmAction: ConfirmAction
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const {
    data: summary,
    isLoading,
    isError,
    error: summaryQueryError,
  } = useQuery({
    queryKey: ['jobSummary', jobId],
    queryFn: () => importJobsApi.getJobSummary(jobId!),
    enabled: !!jobId,
    staleTime: 180000,
    refetchInterval: 180000,
  })

  const retryMutation = useMutation({
    mutationFn: () => importJobsApi.retryFailed(jobId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobSummary', jobId] })
      queryClient.invalidateQueries({ queryKey: ['jobItems', jobId] })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => importJobsApi.cancelJob(jobId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobSummary', jobId] })
    },
  })

  if (!jobId) {
    return (
      <Card className="border-border/60 shadow-sm">
        <CardContent className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
          {t('importJobs.progress.noJobSelected')}
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    const errorDisplay = localizeApiErrorDisplay(
      t,
      summaryQueryError,
      t('importJobs.messages.unknownError'),
    )
    return (
      <Card className="border-border/60 shadow-sm">
        <CardContent className="h-[200px] flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <div>{t('importJobs.messages.queryFailed', { defaultValue: 'Query Failed' })}</div>
          <div
            className="max-w-[520px] text-center text-xs text-destructive"
            title={errorDisplay.tooltip}
          >
            {errorDisplay.label}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['jobSummary', jobId] })}
          >
            {t('importJobs.detail.retryQuery')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const progress = calcProgress(summary)
  const running = summary?.status === 'queued' || summary?.status === 'running'
  const errorSummary = summary?.error_summary ?? []
  const statusVariant =
    summary?.status === 'completed'
      ? 'success'
      : summary?.status === 'failed' || summary?.status === 'cancelled'
        ? 'destructive'
        : 'warning'

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg">{t('importJobs.progress.title')}</CardTitle>
            <CardDescription className="mt-1 font-mono text-xs">
              {t('importJobs.progress.jobIdLabel', {
                defaultValue: 'Job ID: {{jobId}}',
                jobId,
              })}
            </CardDescription>
          </div>
          {summary ? (
            <Badge variant={statusVariant} className="uppercase text-[10px]">
              {getImportStatusLabel(t, summary.status)}
            </Badge>
          ) : null}
        </div>

        {summary ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                <span>
                  {summary.processed}/{summary.total}
                </span>
                <span>{formatPercent(progress)}</span>
              </div>
              <div
                className="h-2.5 rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
              >
                <div
                  className="h-full bg-primary transition-[width] duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MiniMetric title={t('importJobs.metrics.created')} value={summary.created_count} />
              <MiniMetric title={t('importJobs.metrics.updated')} value={summary.updated_count} />
              <MiniMetric title={t('importJobs.metrics.failed')} value={summary.failed_count} />
              <MiniMetric
                title={t('importJobs.metrics.throughput')}
                value={
                  summary.throughput_per_min ? `${summary.throughput_per_min.toFixed(1)}/min` : '-'
                }
              />
            </div>

            <div className="text-xs text-muted-foreground">
              {t('importJobs.progress.etaLabel')}
              {getEtaLabel(summary, t)}
            </div>

            {errorSummary.length > 0 ? (
              <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <div className="font-medium text-foreground">{t('importJobs.progress.topErrors')}</div>
                {errorSummary.slice(0, 3).map((entry) => (
                  <div
                    key={`${entry.error_code}-${entry.count}`}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate" title={entry.error_code}>
                      {localizeImportErrorCode(entry.error_code, t)}
                    </span>
                    <span>{entry.count}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('importJobs.detail.summaryLoading')}
          </div>
        ) : null}
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['jobSummary', jobId] })}
          >
            <Search className="h-3.5 w-3.5 mr-1" />
            {t('importJobs.actions.refreshItems')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            onClick={() => retryMutation.mutate()}
            disabled={(summary?.failed_count ?? 0) <= 0 || retryMutation.isPending}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            {t('importJobs.actions.retryFailed')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            disabled={!running || cancelMutation.isPending}
            onClick={() => {
              void (async () => {
                const confirmed = await confirmAction({
                  title: t('importJobs.actions.cancelJob'),
                  description: t('importJobs.actions.confirmCancelJob'),
                  cancelText: t('common.cancel', { defaultValue: 'Cancel' }),
                  confirmText: t('common.confirm', { defaultValue: 'Confirm' }),
                  variant: 'destructive',
                })
                if (!confirmed) {
                  return
                }
                cancelMutation.mutate()
              })()
            }}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" />
            {t('importJobs.actions.cancelJob')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function JobDetailPanel({
  jobId,
  confirmAction,
}: {
  jobId: string | null
  confirmAction: ConfirmAction
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<OAuthImportItemStatus | 'all'>('all')
  const statusFilterOptions = useMemo(() => getImportStatusFilterOptions(t), [t])

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    error: summaryQueryError,
  } = useQuery({
    queryKey: ['jobSummary', jobId],
    queryFn: () => importJobsApi.getJobSummary(jobId!),
    enabled: !!jobId,
    staleTime: 180000,
    refetchInterval: 180000,
  })

  const retryMutation = useMutation({
    mutationFn: () => importJobsApi.retryFailed(jobId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobSummary', jobId] })
      queryClient.invalidateQueries({ queryKey: ['jobItems', jobId] })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => importJobsApi.cancelJob(jobId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobSummary', jobId] })
    },
  })

  const itemsQuery = useInfiniteQuery({
    queryKey: ['jobItems', jobId, statusFilter],
    enabled: !!jobId,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      importJobsApi.getJobItems(jobId!, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        cursor: pageParam,
        limit: 100,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  })

  const allItems = useMemo(() => {
    return itemsQuery.data?.pages.flatMap((page) => page.items) ?? []
  }, [itemsQuery.data])

  const itemColumns = useMemo<ColumnDef<OAuthImportJobItem>[]>(
    () => [
      {
        id: 'line_no',
        accessorFn: (row) => row.line_no,
        header: t('importJobs.detail.columns.line'),
        cell: ({ row }) => (
          <span className="font-mono text-muted-foreground">{row.original.line_no}</span>
        ),
      },
      {
        id: 'label',
        accessorFn: (row) => row.label.toLowerCase(),
        header: t('importJobs.detail.columns.label'),
        cell: ({ row }) => (
          <div className="min-w-[220px]">
            <div className="truncate font-medium" title={row.original.label}>
              {row.original.label}
            </div>
            {row.original.email ? (
              <div className="mt-1 truncate text-[11px] text-muted-foreground" title={row.original.email}>
                {row.original.email}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'error',
        accessorFn: (row) =>
          `${localizeImportErrorCode(row.error_code, t)} ${row.error_code ?? ''} ${row.error_message ?? ''}`.toLowerCase(),
        header: t('importJobs.detail.columns.error'),
        cell: ({ row }) => {
          const rawCode = row.original.error_code?.trim() || ''
          const rawMessage = row.original.error_message?.trim() || ''
          if (!rawCode && !rawMessage) {
            return <span className="text-muted-foreground">-</span>
          }
          const label = rawCode
            ? localizeImportErrorCode(rawCode, t)
            : t('importJobs.errors.unknown', { defaultValue: 'Unknown import error' })
          return (
            <div className="max-w-[520px] space-y-0.5">
              <div className="truncate text-sm" title={rawCode || undefined}>
                {label}
              </div>
              {rawMessage ? (
                <div className="truncate text-xs text-muted-foreground" title={rawMessage}>
                  {rawMessage}
                </div>
              ) : null}
            </div>
          )
        },
      },
      {
        id: 'status',
        accessorFn: (row) => row.status,
        header: t('importJobs.detail.columns.status'),
        cell: ({ row }) => {
          const statusVariant =
            row.original.status === 'created' || row.original.status === 'updated'
              ? 'success'
              : row.original.status === 'failed'
                ? 'destructive'
                : row.original.status === 'cancelled'
                  ? 'secondary'
                  : 'warning'
          return (
            <Badge
              variant={
                statusVariant as 'success' | 'destructive' | 'secondary' | 'warning'
              }
              className="uppercase text-[10px]"
            >
              {getImportStatusLabel(t, row.original.status)}
            </Badge>
          )
        },
      },
    ],
    [t],
  )

  const exportFailedAsJsonl = () => {
    const failed = allItems.filter((item) => item.status === 'failed')
    if (failed.length === 0) {
      return
    }
    const blob = new Blob([failed.map((item) => JSON.stringify(item)).join('\n') + '\n'], {
      type: 'application/jsonl',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `failed-items-${jobId}.jsonl`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (!jobId) {
    return (
      <Card className="border-border/60 shadow-sm min-h-[360px]">
        <CardContent className="h-full flex items-center justify-center text-sm text-muted-foreground">
          {t('importJobs.detail.selectHint')}
        </CardContent>
      </Card>
    )
  }

  if (summaryError) {
    const errorDisplay = localizeApiErrorDisplay(
      t,
      summaryQueryError,
      t('importJobs.messages.unknownError'),
    )
    return (
      <Card className="border-border/60 shadow-sm min-h-[360px]">
        <CardContent className="h-full flex flex-col items-center justify-center text-sm text-muted-foreground gap-3">
          <div>{t('importJobs.messages.queryFailed', { defaultValue: 'Query Failed' })}</div>
          <div
            className="max-w-[520px] text-center text-xs text-destructive"
            title={errorDisplay.tooltip}
          >
            {errorDisplay.label}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['jobSummary', jobId] })}
          >
            {t('importJobs.detail.retryQuery')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const running = summary?.status === 'queued' || summary?.status === 'running'
  const summaryProgress = calcProgress(summary)

  return (
    <Card className="border-border/60 shadow-sm min-h-[360px]">
      <CardHeader className="pb-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {t('importJobs.detail.title')}
            </CardTitle>
            <CardDescription className="mt-1 font-mono text-xs">
              {t('importJobs.detail.jobIdLabel', {
                defaultValue: 'Job ID: {{jobId}}',
                jobId,
              })}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={() => itemsQuery.refetch()}
              disabled={itemsQuery.isFetching}
            >
              <Search className="h-3.5 w-3.5 mr-1" />
              {t('importJobs.actions.refreshItems')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={() => retryMutation.mutate()}
              disabled={(summary?.failed_count ?? 0) <= 0 || retryMutation.isPending}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              {t('importJobs.actions.retryFailed')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              disabled={!running || cancelMutation.isPending}
              onClick={() => {
                void (async () => {
                  const confirmed = await confirmAction({
                    title: t('importJobs.actions.cancelJob'),
                    description: t('importJobs.actions.confirmCancelJob'),
                    cancelText: t('common.cancel', { defaultValue: 'Cancel' }),
                    confirmText: t('common.confirm', { defaultValue: 'Confirm' }),
                    variant: 'destructive',
                  })
                  if (!confirmed) {
                    return
                  }
                  cancelMutation.mutate()
                })()
              }}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              {t('importJobs.actions.cancelJob')}
            </Button>
            <Button size="sm" variant="outline" className="cursor-pointer" onClick={exportFailedAsJsonl}>
              <HardDriveDownload className="h-3.5 w-3.5 mr-1" />
              {t('importJobs.actions.exportFailed')}
            </Button>
          </div>
        </div>

        {summary ? (
          <div className="space-y-3 mt-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                <span>
                  {summary.processed}/{summary.total}
                </span>
                <span>{formatPercent(summaryProgress)}</span>
              </div>
              <div
                className="h-2.5 rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(summaryProgress)}
              >
                <div
                  className="h-full bg-primary transition-[width] duration-300"
                  style={{ width: `${summaryProgress}%` }}
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-5 gap-2">
              <MiniMetric
                title={t('importJobs.metrics.status')}
                value={getImportStatusLabel(t, summary.status)}
              />
              <MiniMetric title={t('importJobs.metrics.total')} value={summary.total} />
              <MiniMetric title={t('importJobs.metrics.processed')} value={summary.processed} />
              <MiniMetric title={t('importJobs.metrics.failed')} value={summary.failed_count} />
              <MiniMetric
                title={t('importJobs.metrics.throughput')}
                value={
                  summary.throughput_per_min ? `${summary.throughput_per_min.toFixed(1)}/min` : '-'
                }
              />
            </div>
          </div>
        ) : summaryLoading ? (
          <div className="text-sm text-muted-foreground mt-2">{t('importJobs.detail.summaryLoading')}</div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3 min-h-0">
        <div className="h-[340px]">
          <StandardDataTable
            columns={itemColumns}
            data={allItems}
            density="compact"
            defaultPageSize={20}
            pageSizeOptions={[20, 50, 100]}
            searchPlaceholder={t('importJobs.detail.searchPlaceholderModern')}
            searchFn={(row, keyword) => {
              const haystack =
                `${row.label} ${row.email ?? ''} ${row.error_code ?? ''} ${row.error_message ?? ''}`.toLowerCase()
              return haystack.includes(keyword)
            }}
            emptyText={
              itemsQuery.isLoading
                ? t('importJobs.detail.itemsLoading')
                : t('importJobs.detail.itemsEmpty')
            }
            filters={(
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {t('importJobs.detail.filterLabel')}
                </span>
                <Select
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value as OAuthImportItemStatus | 'all')}
                >
                  <SelectTrigger
                    className="w-[200px]"
                    aria-label={t('importJobs.detail.filterLabel')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusFilterOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {t('importJobs.detail.loadedCount', { count: allItems.length })}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            disabled={!itemsQuery.hasNextPage || itemsQuery.isFetchingNextPage}
            onClick={() => itemsQuery.fetchNextPage()}
          >
            {itemsQuery.isFetchingNextPage ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                {t('importJobs.detail.loadingMore')}
              </>
            ) : (
              <>
                <PlayCircle className="h-3.5 w-3.5 mr-1" />
                {t('importJobs.detail.loadMore')}
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function MiniMetric({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{title}</div>
      <div className="text-sm font-semibold mt-1 tabular-nums">{value}</div>
    </div>
  )
}
