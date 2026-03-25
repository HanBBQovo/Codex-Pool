import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import {
  Archive,
  CheckCircle2,
  Eye,
  Gauge,
  RefreshCcw,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Snowflake,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  accountPoolApi,
  type AccountPoolAction,
  type AccountPoolOperatorState,
  type AccountPoolReasonClass,
  type AccountPoolRecord,
  type AccountPoolRecordScope,
} from '@/api/accounts'
import { localizeApiErrorDisplay, localizeOAuthErrorCodeDisplay } from '@/api/errorI18n'
import {
  DashboardMetricCard,
  DashboardMetricGrid,
  PageIntro,
  PagePanel,
  SectionHeader,
} from '@/components/layout/page-archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StandardDataTable } from '@/components/ui/standard-data-table'
import { PLAN_UNKNOWN_VALUE } from '@/features/accounts/types'
import {
  bucketLabel,
  extractRateLimitDisplaysFromSnapshots,
  formatAbsoluteDateTime,
  formatRateLimitResetText,
  normalizePlanValue,
} from '@/features/accounts/utils'
import { formatExactCount } from '@/lib/count-number-format'
import { notify } from '@/lib/notification'

type StateFilter = 'all' | AccountPoolOperatorState
type ScopeFilter = 'all' | AccountPoolRecordScope
type ReasonClassFilter = 'all' | AccountPoolReasonClass

function formatOptionalDateTime(value?: string) {
  if (!value) {
    return '-'
  }
  return formatAbsoluteDateTime(value)
}

function getStateBadgeVariant(state: AccountPoolOperatorState) {
  switch (state) {
    case 'routable':
      return 'success'
    case 'cooling':
      return 'warning'
    case 'pending_delete':
      return 'destructive'
    case 'inventory':
    default:
      return 'secondary'
  }
}

function getReasonBadgeVariant(reasonClass: AccountPoolReasonClass) {
  switch (reasonClass) {
    case 'healthy':
      return 'success'
    case 'quota':
      return 'warning'
    case 'fatal':
      return 'destructive'
    case 'transient':
      return 'info'
    case 'admin':
    default:
      return 'secondary'
  }
}

function getScopeBadgeVariant(scope: AccountPoolRecordScope) {
  return scope === 'runtime' ? 'outline' : 'secondary'
}

function getModeLabel(mode: string | undefined, t: ReturnType<typeof useTranslation>['t']) {
  switch ((mode ?? '').trim().toLowerCase()) {
    case 'chat_gpt_session':
      return t('accounts.mode.chatgptSession')
    case 'codex_oauth':
      return t('accounts.mode.codexOauth')
    case 'open_ai_api_key':
      return t('accounts.mode.apiKey')
    default:
      return t('accounts.mode.unknown')
  }
}

function getAuthProviderLabel(
  provider: AccountPoolRecord['auth_provider'],
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (provider) {
    case 'legacy_bearer':
      return t('accounts.oauth.provider.legacyBearer')
    case 'oauth_refresh_token':
      return t('accounts.oauth.provider.refreshToken')
    default:
      return '-'
  }
}

function getCredentialKindLabel(
  kind: AccountPoolRecord['credential_kind'],
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (kind) {
    case 'refresh_rotatable':
      return t('accounts.oauth.kind.refreshRotatable')
    case 'one_time_access_token':
      return t('accounts.oauth.kind.oneTime')
    default:
      return '-'
  }
}

function getRefreshCredentialStateLabel(
  state: AccountPoolRecord['refresh_credential_state'],
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (state) {
    case 'healthy':
      return t('accounts.refreshCredentialState.healthy')
    case 'degraded':
      return t('accounts.refreshCredentialState.degraded')
    case 'invalid':
      return t('accounts.refreshCredentialState.invalid')
    case 'missing':
      return t('accounts.refreshCredentialState.missing')
    default:
      return '-'
  }
}

function getStateLabel(
  state: AccountPoolOperatorState,
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (state) {
    case 'inventory':
      return t('accountPool.state.inventory')
    case 'routable':
      return t('accountPool.state.routable')
    case 'cooling':
      return t('accountPool.state.cooling')
    case 'pending_delete':
      return t('accountPool.state.pendingDelete')
  }
}

function getScopeLabel(
  scope: AccountPoolRecordScope,
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (scope) {
    case 'runtime':
      return t('accountPool.scope.runtime')
    case 'inventory':
      return t('accountPool.scope.inventory')
  }
}

function getReasonClassLabel(
  reasonClass: AccountPoolReasonClass,
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (reasonClass) {
    case 'healthy':
      return t('accountPool.reasonClass.healthy')
    case 'quota':
      return t('accountPool.reasonClass.quota')
    case 'fatal':
      return t('accountPool.reasonClass.fatal')
    case 'transient':
      return t('accountPool.reasonClass.transient')
    case 'admin':
      return t('accountPool.reasonClass.admin')
  }
}

function getSignalSourceLabel(
  source: AccountPoolRecord['last_signal_source'],
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (source) {
    case 'active':
      return t('accountPool.signalSource.active')
    case 'passive':
      return t('accountPool.signalSource.passive')
    default:
      return t('accountPool.signalSource.unknown')
  }
}

function getReasonCodeLabel(
  reasonCode: string | undefined,
  t: ReturnType<typeof useTranslation>['t'],
) {
  const normalized = (reasonCode ?? '').trim().toLowerCase()
  if (!normalized) {
    return t('accountPool.reasonCode.none')
  }

  switch (normalized) {
    case 'token_invalidated':
      return t('accountPool.reasonCode.tokenInvalidated')
    case 'account_deactivated':
      return t('accountPool.reasonCode.accountDeactivated')
    case 'invalid_refresh_token':
      return t('accountPool.reasonCode.invalidRefreshToken')
    case 'refresh_token_revoked':
      return t('accountPool.reasonCode.refreshTokenRevoked')
    case 'refresh_token_reused':
      return t('accountPool.reasonCode.refreshTokenReused')
    case 'rate_limited':
      return t('accountPool.reasonCode.rateLimited')
    case 'quota_exhausted':
      return t('accountPool.reasonCode.quotaExhausted')
    case 'upstream_unavailable':
      return t('accountPool.reasonCode.upstreamUnavailable')
    case 'transport_error':
      return t('accountPool.reasonCode.transportError')
    case 'overloaded':
      return t('accountPool.reasonCode.overloaded')
    case 'operator_retired_invalid_refresh_token':
      return t('accountPool.reasonCode.operatorRetiredInvalidRefreshToken')
    default: {
      const display = localizeOAuthErrorCodeDisplay(t, normalized)
      if (display.label && display.label !== t('errors.common.failed')) {
        return display.label
      }
      return t('accountPool.reasonCode.unknown')
    }
  }
}

function buildQuotaSummary(
  record: AccountPoolRecord,
  locale: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  const displays = extractRateLimitDisplaysFromSnapshots(record.rate_limits)
  if (displays.length === 0) {
    return '-'
  }

  return displays
    .map((item) => {
      const remaining = `${Math.max(0, Math.min(100, item.remainingPercent)).toFixed(0)}%`
      const reset = formatRateLimitResetText({ resetsAt: item.resetsAt, locale, t })
      return `${bucketLabel(item.bucket, t)} ${remaining} · ${reset}`
    })
    .join('\n')
}

function matchesAccountPoolSearch(record: AccountPoolRecord, keyword: string) {
  const values = [
    record.email,
    record.label,
    record.chatgpt_account_id,
    record.chatgpt_plan_type,
    record.source_type,
    record.reason_code,
    record.mode,
    record.auth_provider,
    record.record_scope,
    record.operator_state,
  ]
  return values.some((value) => value?.toLowerCase().includes(keyword))
}

function canRunAccountPoolAction(record: AccountPoolRecord, action: AccountPoolAction) {
  switch (action) {
    case 'delete':
      return true
    case 'restore':
      return record.record_scope === 'inventory'
    case 'reprobe':
      if (record.record_scope === 'inventory') {
        return true
      }
      return record.auth_provider === 'oauth_refresh_token'
  }
}

export default function Accounts() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { confirm, confirmDialog } = useConfirmDialog()

  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [reasonClassFilter, setReasonClassFilter] = useState<ReasonClassFilter>('all')
  const [detailRecordId, setDetailRecordId] = useState<string | null>(null)

  const {
    data: summary,
    isLoading: isSummaryLoading,
    isFetching: isSummaryFetching,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['accountPoolSummary'],
    queryFn: accountPoolApi.getSummary,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: 'always',
  })

  const {
    data: records = [],
    isLoading: isRecordsLoading,
    isFetching: isRecordsFetching,
    refetch: refetchRecords,
  } = useQuery({
    queryKey: ['accountPoolRecords'],
    queryFn: accountPoolApi.listRecords,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: 'always',
  })

  const detailRecordFallback = useMemo(
    () => records.find((record) => record.id === detailRecordId),
    [detailRecordId, records],
  )

  const {
    data: detailRecordData,
    isFetching: isDetailFetching,
    refetch: refetchDetailRecord,
  } = useQuery({
    queryKey: ['accountPoolRecord', detailRecordId],
    queryFn: () => accountPoolApi.getRecord(detailRecordId!),
    enabled: Boolean(detailRecordId),
    staleTime: 15_000,
    refetchOnWindowFocus: 'always',
  })

  const detailRecord = detailRecordData ?? detailRecordFallback ?? null

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (stateFilter !== 'all' && record.operator_state !== stateFilter) {
        return false
      }
      if (scopeFilter !== 'all' && record.record_scope !== scopeFilter) {
        return false
      }
      if (reasonClassFilter !== 'all' && record.reason_class !== reasonClassFilter) {
        return false
      }
      return true
    })
  }, [reasonClassFilter, records, scopeFilter, stateFilter])

  const invalidateAccountPoolQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['accountPoolSummary'] }),
      queryClient.invalidateQueries({ queryKey: ['accountPoolRecords'] }),
      queryClient.invalidateQueries({ queryKey: ['accountPoolRecord'] }),
      queryClient.invalidateQueries({ queryKey: ['upstreamAccounts'] }),
      queryClient.invalidateQueries({ queryKey: ['oauthInventorySummary'] }),
      queryClient.invalidateQueries({ queryKey: ['oauthRuntimePoolSummary'] }),
      queryClient.invalidateQueries({ queryKey: ['oauthHealthSignalsSummary'] }),
    ])
  }, [queryClient])

  const actionMutation = useMutation({
    mutationFn: async ({
      action,
      record,
    }: {
      action: AccountPoolAction
      record: AccountPoolRecord
    }) => {
      if (action === 'delete') {
        const confirmed = await confirm({
          title: t('accountPool.messages.confirmDeleteTitle', {
            label: record.email?.trim() || record.label,
          }),
          description: t('accountPool.messages.confirmDeleteDescription'),
          confirmText: t('accountPool.actions.delete'),
          variant: 'destructive',
        })
        if (!confirmed) {
          return null
        }
      }

      return accountPoolApi.runAction(action, [record.id])
    },
    onSuccess: async (response, variables) => {
      if (!response) {
        return
      }

      await invalidateAccountPoolQueries()

      const failedItem = response.items.find((item) => !item.ok)
      if (failedItem?.error) {
        const localized = localizeApiErrorDisplay(
          t,
          failedItem.error,
          t('accountPool.messages.actionFailed'),
        )
        notify({
          variant: 'warning',
          title: t('accountPool.messages.actionPartialTitle', {
            action: t(`accountPool.actions.${variables.action}`),
          }),
          description: localized.label,
        })
        return
      }

      if (variables.action === 'delete' && detailRecordId === variables.record.id) {
        setDetailRecordId(null)
      }

      notify({
        variant: 'success',
        title: t('accountPool.messages.actionSuccessTitle', {
          action: t(`accountPool.actions.${variables.action}`),
        }),
        description: t('accountPool.messages.actionSuccessDescription', {
          label: variables.record.email?.trim() || variables.record.label,
        }),
      })
    },
    onError: (error, variables) => {
      const localized = localizeApiErrorDisplay(
        t,
        error,
        t('accountPool.messages.actionFailed'),
      )
      notify({
        variant: 'error',
        title: t('accountPool.messages.actionFailedTitle', {
          action: t(`accountPool.actions.${variables.action}`),
        }),
        description: localized.label,
      })
    },
  })

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      refetchSummary({ throwOnError: false }),
      refetchRecords({ throwOnError: false }),
      detailRecordId
        ? refetchDetailRecord({ throwOnError: false })
        : Promise.resolve(undefined),
    ])
  }, [detailRecordId, refetchDetailRecord, refetchRecords, refetchSummary])

  const metricCards = [
    {
      id: 'inventory',
      title: t('accountPool.metrics.inventory'),
      value: summary?.inventory ?? 0,
      icon: Archive,
    },
    {
      id: 'routable',
      title: t('accountPool.metrics.routable'),
      value: summary?.routable ?? 0,
      icon: CheckCircle2,
    },
    {
      id: 'cooling',
      title: t('accountPool.metrics.cooling'),
      value: summary?.cooling ?? 0,
      icon: Snowflake,
    },
    {
      id: 'pendingDelete',
      title: t('accountPool.metrics.pendingDelete'),
      value: summary?.pending_delete ?? 0,
      icon: ShieldAlert,
    },
  ]

  const reasonCards = [
    {
      id: 'healthy',
      title: t('accountPool.metrics.healthy'),
      value: summary?.healthy ?? 0,
      icon: CheckCircle2,
    },
    {
      id: 'quota',
      title: t('accountPool.metrics.quota'),
      value: summary?.quota ?? 0,
      icon: Gauge,
    },
    {
      id: 'fatal',
      title: t('accountPool.metrics.fatal'),
      value: summary?.fatal ?? 0,
      icon: ShieldAlert,
    },
    {
      id: 'transient',
      title: t('accountPool.metrics.transient'),
      value: summary?.transient ?? 0,
      icon: RefreshCcw,
    },
    {
      id: 'admin',
      title: t('accountPool.metrics.admin'),
      value: summary?.admin ?? 0,
      icon: Archive,
    },
  ]

  const columns = useMemo<ColumnDef<AccountPoolRecord>[]>(
    () => [
      {
        id: 'account',
        accessorFn: (row) =>
          `${row.email ?? ''} ${row.label} ${row.chatgpt_account_id ?? ''}`.toLowerCase(),
        header: t('accountPool.columns.account'),
        cell: ({ row }) => {
          const record = row.original
          const planValue = normalizePlanValue(record.chatgpt_plan_type)
          return (
            <div className="min-w-[230px] space-y-1">
              <div className="font-medium text-foreground">
                {record.email?.trim() || record.label}
              </div>
              <div className="text-xs text-muted-foreground">{record.label}</div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={getScopeBadgeVariant(record.record_scope)}>
                  {getScopeLabel(record.record_scope, t)}
                </Badge>
                <Badge variant="secondary">
                  {planValue === PLAN_UNKNOWN_VALUE
                    ? t('accounts.filters.planUnknown')
                    : planValue}
                </Badge>
                {record.source_type ? (
                  <Badge variant="outline" className="text-[11px] font-normal">
                    {record.source_type}
                  </Badge>
                ) : null}
              </div>
            </div>
          )
        },
      },
      {
        id: 'state',
        accessorFn: (row) => row.operator_state,
        header: t('accountPool.columns.state'),
        cell: ({ row }) => {
          const record = row.original
          return (
            <div className="min-w-[180px] space-y-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant={getStateBadgeVariant(record.operator_state)}>
                  {getStateLabel(record.operator_state, t)}
                </Badge>
                <Badge variant={record.route_eligible ? 'success' : 'secondary'}>
                  {record.route_eligible
                    ? t('accountPool.routeEligible.yes')
                    : t('accountPool.routeEligible.no')}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {t('accountPool.fields.nextAction')}: {formatOptionalDateTime(record.next_action_at)}
              </div>
            </div>
          )
        },
      },
      {
        id: 'reason',
        accessorFn: (row) => `${row.reason_class}:${row.reason_code ?? ''}`,
        header: t('accountPool.columns.reason'),
        cell: ({ row }) => {
          const record = row.original
          return (
            <div className="min-w-[220px] space-y-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant={getReasonBadgeVariant(record.reason_class)}>
                  {getReasonClassLabel(record.reason_class, t)}
                </Badge>
              </div>
              <div className="text-sm text-foreground/88">
                {getReasonCodeLabel(record.reason_code, t)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('accountPool.fields.lastSignalAt')}: {formatOptionalDateTime(record.last_signal_at)}
                {' · '}
                {getSignalSourceLabel(record.last_signal_source, t)}
              </div>
            </div>
          )
        },
      },
      {
        id: 'credentials',
        accessorFn: (row) =>
          `${row.mode ?? ''} ${row.auth_provider ?? ''} ${row.credential_kind ?? ''}`.toLowerCase(),
        header: t('accountPool.columns.credentials'),
        cell: ({ row }) => {
          const record = row.original
          return (
            <div className="min-w-[220px] space-y-1.5 text-xs text-muted-foreground">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{getModeLabel(record.mode, t)}</Badge>
                <Badge variant="outline">{getAuthProviderLabel(record.auth_provider, t)}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{getCredentialKindLabel(record.credential_kind, t)}</Badge>
                <Badge variant="secondary">
                  {getRefreshCredentialStateLabel(record.refresh_credential_state, t)}
                </Badge>
              </div>
            </div>
          )
        },
      },
      {
        id: 'quota',
        accessorFn: (row) =>
          row.rate_limits.map((item) => item.limit_id ?? item.limit_name ?? '').join(' '),
        header: t('accountPool.columns.quota'),
        cell: ({ row }) => (
          <div className="min-w-[250px] whitespace-pre-line text-xs leading-5 text-muted-foreground">
            {buildQuotaSummary(row.original, i18n.resolvedLanguage ?? i18n.language, t)}
          </div>
        ),
      },
      {
        id: 'timeline',
        accessorFn: (row) => row.next_action_at ?? row.updated_at,
        header: t('accountPool.columns.nextAction'),
        cell: ({ row }) => (
          <div className="min-w-[170px] space-y-1 text-xs text-muted-foreground">
            <div>
              {t('accountPool.fields.nextAction')}: {formatOptionalDateTime(row.original.next_action_at)}
            </div>
            <div>
              {t('accountPool.fields.updatedAt')}: {formatOptionalDateTime(row.original.updated_at)}
            </div>
          </div>
        ),
      },
      {
        id: 'actions',
        header: t('accountPool.columns.actions'),
        accessorFn: (row) => row.id,
        cell: ({ row }) => {
          const record = row.original
          const busy =
            actionMutation.isPending && actionMutation.variables?.record.id === record.id
          return (
            <div className="flex min-w-[220px] flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDetailRecordId(record.id)}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                {t('accountPool.actions.inspect')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!canRunAccountPoolAction(record, 'reprobe') || busy}
                onClick={() => actionMutation.mutate({ action: 'reprobe', record })}
              >
                <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                {t('accountPool.actions.reprobe')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!canRunAccountPoolAction(record, 'restore') || busy}
                onClick={() => actionMutation.mutate({ action: 'restore', record })}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {t('accountPool.actions.restore')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={!canRunAccountPoolAction(record, 'delete') || busy}
                onClick={() => actionMutation.mutate({ action: 'delete', record })}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {t('accountPool.actions.delete')}
              </Button>
            </div>
          )
        },
      },
    ],
    [actionMutation, i18n.language, i18n.resolvedLanguage, t],
  )

  return (
    <div className="flex-1 w-full overflow-y-auto px-4 py-4 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <PageIntro
          archetype="workspace"
          eyebrow={t('accountPool.eyebrow')}
          title={t('accountPool.title')}
          description={t('accountPool.subtitle')}
          meta={(
            <div className="flex flex-wrap gap-2 text-sm leading-6">
              <span className="inline-flex items-center rounded-full border border-border/70 bg-background/74 px-3 py-1 text-[12px] font-medium tracking-[0.01em]">
                {t('accountPool.meta.total', { count: summary?.total ?? 0 })}
              </span>
              <span className="inline-flex items-center rounded-full border border-border/70 bg-background/74 px-3 py-1 text-[12px] font-medium tracking-[0.01em]">
                {t('accountPool.meta.filtered', { count: filteredRecords.length })}
              </span>
            </div>
          )}
          actions={(
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={isSummaryFetching || isRecordsFetching}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('accountPool.actions.refresh')}
            </Button>
          )}
        />

        <PagePanel className="space-y-4">
          <SectionHeader
            eyebrow={t('accountPool.sections.stateOverview')}
            title={t('accountPool.sections.stateOverviewTitle')}
            description={t('accountPool.sections.stateOverviewDescription')}
          />
          <DashboardMetricGrid className="xl:grid-cols-4">
            {metricCards.map((metric) => (
              <DashboardMetricCard
                key={metric.id}
                title={metric.title}
                value={formatExactCount(metric.value)}
                valueTitle={formatExactCount(metric.value)}
                description={t('accountPool.metrics.stateDescription', {
                  state: metric.title,
                })}
                icon={<metric.icon className="h-4 w-4" />}
                loading={isSummaryLoading}
              />
            ))}
          </DashboardMetricGrid>
        </PagePanel>

        <PagePanel className="space-y-4">
          <SectionHeader
            eyebrow={t('accountPool.sections.reasonOverview')}
            title={t('accountPool.sections.reasonOverviewTitle')}
            description={t('accountPool.sections.reasonOverviewDescription')}
          />
          <DashboardMetricGrid className="xl:grid-cols-5">
            {reasonCards.map((metric) => (
              <DashboardMetricCard
                key={metric.id}
                title={metric.title}
                value={formatExactCount(metric.value)}
                valueTitle={formatExactCount(metric.value)}
                description={t('accountPool.metrics.reasonDescription', {
                  reason: metric.title,
                })}
                icon={<metric.icon className="h-4 w-4" />}
                loading={isSummaryLoading}
              />
            ))}
          </DashboardMetricGrid>
        </PagePanel>

        <PagePanel className="space-y-4">
          <SectionHeader
            eyebrow={t('accountPool.sections.records')}
            title={t('accountPool.sections.recordsTitle')}
            description={t('accountPool.sections.recordsDescription')}
          />
          <StandardDataTable
            columns={columns}
            data={filteredRecords}
            defaultPageSize={20}
            searchPlaceholder={t('accountPool.searchPlaceholder')}
            searchFn={matchesAccountPoolSearch}
            emptyText={
              isRecordsLoading
                ? t('accountPool.loading')
                : t('accountPool.empty')
            }
            filters={(
              <>
                <Select value={stateFilter} onValueChange={(value) => setStateFilter(value as StateFilter)}>
                  <SelectTrigger className="w-[180px]" aria-label={t('accountPool.filters.state')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('accountPool.filters.allStates')}</SelectItem>
                    <SelectItem value="inventory">{t('accountPool.state.inventory')}</SelectItem>
                    <SelectItem value="routable">{t('accountPool.state.routable')}</SelectItem>
                    <SelectItem value="cooling">{t('accountPool.state.cooling')}</SelectItem>
                    <SelectItem value="pending_delete">{t('accountPool.state.pendingDelete')}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={scopeFilter} onValueChange={(value) => setScopeFilter(value as ScopeFilter)}>
                  <SelectTrigger className="w-[180px]" aria-label={t('accountPool.filters.scope')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('accountPool.filters.allScopes')}</SelectItem>
                    <SelectItem value="runtime">{t('accountPool.scope.runtime')}</SelectItem>
                    <SelectItem value="inventory">{t('accountPool.scope.inventory')}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={reasonClassFilter}
                  onValueChange={(value) => setReasonClassFilter(value as ReasonClassFilter)}
                >
                  <SelectTrigger className="w-[180px]" aria-label={t('accountPool.filters.reasonClass')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('accountPool.filters.allReasons')}</SelectItem>
                    <SelectItem value="healthy">{t('accountPool.reasonClass.healthy')}</SelectItem>
                    <SelectItem value="quota">{t('accountPool.reasonClass.quota')}</SelectItem>
                    <SelectItem value="fatal">{t('accountPool.reasonClass.fatal')}</SelectItem>
                    <SelectItem value="transient">{t('accountPool.reasonClass.transient')}</SelectItem>
                    <SelectItem value="admin">{t('accountPool.reasonClass.admin')}</SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}
          />
        </PagePanel>

        {detailRecord ? (
          <PagePanel className="space-y-4">
            <SectionHeader
              eyebrow={t('accountPool.sections.detail')}
              title={detailRecord.email?.trim() || detailRecord.label}
              description={t('accountPool.detail.description')}
              actions={(
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canRunAccountPoolAction(detailRecord, 'reprobe') || actionMutation.isPending}
                    onClick={() => actionMutation.mutate({ action: 'reprobe', record: detailRecord })}
                  >
                    <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                    {t('accountPool.actions.reprobe')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canRunAccountPoolAction(detailRecord, 'restore') || actionMutation.isPending}
                    onClick={() => actionMutation.mutate({ action: 'restore', record: detailRecord })}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    {t('accountPool.actions.restore')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={!canRunAccountPoolAction(detailRecord, 'delete') || actionMutation.isPending}
                    onClick={() => actionMutation.mutate({ action: 'delete', record: detailRecord })}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {t('accountPool.actions.delete')}
                  </Button>
                </div>
              )}
            />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[0.9rem] border border-border/70 bg-background/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {t('accountPool.fields.currentState')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant={getStateBadgeVariant(detailRecord.operator_state)}>
                      {getStateLabel(detailRecord.operator_state, t)}
                    </Badge>
                    <Badge variant={getReasonBadgeVariant(detailRecord.reason_class)}>
                      {getReasonClassLabel(detailRecord.reason_class, t)}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {getReasonCodeLabel(detailRecord.reason_code, t)}
                  </p>
                </div>
                <div className="rounded-[0.9rem] border border-border/70 bg-background/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {t('accountPool.fields.routeEligible')}
                  </p>
                  <p className="mt-3 text-lg font-semibold text-foreground">
                    {detailRecord.route_eligible
                      ? t('accountPool.routeEligible.yes')
                      : t('accountPool.routeEligible.no')}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t('accountPool.fields.nextAction')}: {formatOptionalDateTime(detailRecord.next_action_at)}
                  </p>
                </div>
                <div className="rounded-[0.9rem] border border-border/70 bg-background/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {t('accountPool.fields.credentials')}
                  </p>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <div>{t('accountPool.fields.mode')}: {getModeLabel(detailRecord.mode, t)}</div>
                    <div>{t('accountPool.fields.authProvider')}: {getAuthProviderLabel(detailRecord.auth_provider, t)}</div>
                    <div>{t('accountPool.fields.credentialKind')}: {getCredentialKindLabel(detailRecord.credential_kind, t)}</div>
                    <div>{t('accountPool.fields.refreshState')}: {getRefreshCredentialStateLabel(detailRecord.refresh_credential_state, t)}</div>
                  </div>
                </div>
                <div className="rounded-[0.9rem] border border-border/70 bg-background/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {t('accountPool.fields.timeline')}
                  </p>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <div>{t('accountPool.fields.lastSignalAt')}: {formatOptionalDateTime(detailRecord.last_signal_at)}</div>
                    <div>{t('accountPool.fields.lastSignalSource')}: {getSignalSourceLabel(detailRecord.last_signal_source, t)}</div>
                    <div>{t('accountPool.fields.createdAt')}: {formatOptionalDateTime(detailRecord.created_at)}</div>
                    <div>{t('accountPool.fields.updatedAt')}: {formatOptionalDateTime(detailRecord.updated_at)}</div>
                  </div>
                </div>
              </div>
              <div className="rounded-[0.9rem] border border-border/70 bg-background/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {t('accountPool.fields.identity')}
                </p>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <div>{t('accountPool.fields.email')}: {detailRecord.email?.trim() || '-'}</div>
                  <div>{t('accountPool.fields.chatgptAccountId')}: {detailRecord.chatgpt_account_id ?? '-'}</div>
                  <div>
                    {t('accountPool.fields.plan')}:{' '}
                    {normalizePlanValue(detailRecord.chatgpt_plan_type) === PLAN_UNKNOWN_VALUE
                      ? t('accounts.filters.planUnknown')
                      : normalizePlanValue(detailRecord.chatgpt_plan_type)}
                  </div>
                  <div>{t('accountPool.fields.sourceType')}: {detailRecord.source_type ?? '-'}</div>
                </div>
                <div className="mt-5 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {t('accountPool.fields.quota')}
                  </p>
                  <div className="whitespace-pre-line text-sm leading-6 text-muted-foreground">
                    {buildQuotaSummary(detailRecord, i18n.resolvedLanguage ?? i18n.language, t)}
                  </div>
                </div>
              </div>
            </div>
            {isDetailFetching ? (
              <p className="text-xs text-muted-foreground">{t('accountPool.loading')}</p>
            ) : null}
          </PagePanel>
        ) : null}

        {confirmDialog}
      </div>
    </div>
  )
}
