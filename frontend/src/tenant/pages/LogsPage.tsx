import { useMemo, useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@heroui/react'
import type { TFunction } from 'i18next'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { auditLogsApi, type AuditLogItem } from '@/api/auditLogs'
import { localizeRequestLogErrorDisplay } from '@/api/errorI18n'
import { requestLogsApi, type RequestAuditLogItem } from '@/api/requestLogs'
import {
  DockedPageIntro,
  PageContent,
  PagePanel,
  SectionHeader,
} from '@/components/layout/page-archetypes'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/DataTable'
import {
  getServiceTierBadgeTone,
  getServiceTierDefaultLabel,
  normalizeServiceTierForDisplay,
  shouldHighlightServiceTier,
} from '@/features/billing/service-tier'
import {
  LogsFilterField,
  LogsFilterGrid,
  LogsFilterInput,
  LogsFilterSelect,
} from '@/features/logs/filter-controls'
import { formatDurationMs } from '@/lib/duration-format'
import { formatUtcDateTime } from '@/lib/i18n-format'
import { describeLogsWorkbenchLayout } from '@/lib/page-archetypes'
import { formatDateTime, currentRangeByDays } from '@/tenant/lib/format'

type RangePreset = 1 | 7 | 30

function parseRangePreset(raw: string | null): RangePreset {
  if (raw === '7') return 7
  if (raw === '30') return 30
  return 1
}

function normalizeAuditValue(value?: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

function formatUtcLogDateTime(
  value: string | number | Date,
  locale?: string,
) {
  return formatUtcDateTime(value, {
    locale,
    preset: 'datetime',
    fallback: '-',
    timeZoneName: 'short',
  })
}

function buildTenantLogTimeTooltip(
  t: TFunction,
  locale: string | undefined,
  value: string,
) {
  return t('tenantLogs.time.tooltip', {
    defaultValue: 'Local: {{local}} | UTC: {{utc}}',
    local: formatDateTime(value),
    utc: formatUtcLogDateTime(value, locale),
  })
}

function localizeTenantServiceTierLabel(t: TFunction, serviceTier?: string) {
  const defaultLabel = getServiceTierDefaultLabel(serviceTier)
  switch (normalizeServiceTierForDisplay(serviceTier)) {
    case 'priority':
      return t('serviceTier.priority', { defaultValue: defaultLabel })
    case 'flex':
      return t('serviceTier.flex', { defaultValue: defaultLabel })
    default:
      return t('serviceTier.default', { defaultValue: defaultLabel })
  }
}

function localizeTenantAuditActorType(actorType: string | undefined, t: TFunction): string {
  switch (normalizeAuditValue(actorType)) {
    case 'admin_user':
      return t('tenantLogs.audit.actorTypes.adminUser', { defaultValue: 'Admin user' })
    case 'tenant_user':
      return t('tenantLogs.audit.actorTypes.tenantUser', { defaultValue: 'Tenant user' })
    case 'api_key':
      return t('tenantLogs.audit.actorTypes.apiKey', { defaultValue: 'API key' })
    case 'system':
      return t('tenantLogs.audit.actorTypes.system', { defaultValue: 'System' })
    default:
      return t('tenantLogs.audit.actorTypes.unknown', { defaultValue: 'Unknown actor' })
  }
}

function localizeTenantAuditResultStatus(resultStatus: string | undefined, t: TFunction): string {
  switch (normalizeAuditValue(resultStatus)) {
    case 'ok':
      return t('tenantLogs.audit.resultStatuses.ok', { defaultValue: 'Success' })
    case 'failed':
    case 'error':
      return t('tenantLogs.audit.resultStatuses.failed', { defaultValue: 'Failed' })
    case 'denied':
      return t('tenantLogs.audit.resultStatuses.denied', { defaultValue: 'Denied' })
    default:
      return t('tenantLogs.audit.resultStatuses.unknown', { defaultValue: 'Unknown result' })
  }
}

function localizeTenantAuditAction(action: string | undefined, t: TFunction): string {
  const normalized = normalizeAuditValue(action)
  if (!normalized) {
    return t('tenantLogs.audit.actionValues.unknown', { defaultValue: 'Unknown action' })
  }

  if (normalized.startsWith('tenant.')) {
    return t('tenantLogs.audit.actionValues.tenantOperation', { defaultValue: 'Tenant operation' })
  }
  if (normalized.startsWith('admin.')) {
    return t('tenantLogs.audit.actionValues.adminOperation', { defaultValue: 'Admin operation' })
  }
  if (normalized.startsWith('auth.')) {
    return t('tenantLogs.audit.actionValues.authOperation', { defaultValue: 'Auth operation' })
  }
  if (normalized.startsWith('request.')) {
    return t('tenantLogs.audit.actionValues.requestOperation', { defaultValue: 'Request operation' })
  }
  return t('tenantLogs.audit.actionValues.unknown', { defaultValue: 'Unknown action' })
}

function localizeTenantAuditTargetType(targetType: string | undefined, t: TFunction): string {
  switch (normalizeAuditValue(targetType)) {
    case 'request_logs':
      return t('tenantLogs.audit.targetTypes.requestLogs', { defaultValue: 'Request logs' })
    case 'request_correlation':
      return t('tenantLogs.audit.targetTypes.requestCorrelation', { defaultValue: 'Request correlation' })
    case 'audit_logs':
      return t('tenantLogs.audit.targetTypes.auditLogs', { defaultValue: 'Audit logs' })
    case 'usage_summary':
      return t('tenantLogs.audit.targetTypes.usageSummary', { defaultValue: 'Usage summary' })
    case 'usage_trends_hourly':
      return t('tenantLogs.audit.targetTypes.usageTrendsHourly', { defaultValue: 'Hourly usage trends' })
    case 'upstream_error_template':
      return t('tenantLogs.audit.targetTypes.upstreamErrorTemplate', { defaultValue: 'Upstream error template' })
    case 'builtin_error_template':
      return t('tenantLogs.audit.targetTypes.builtinErrorTemplate', { defaultValue: 'Built-in error template' })
    case 'upstream_error_learning_settings':
      return t('tenantLogs.audit.targetTypes.upstreamErrorLearningSettings', { defaultValue: 'Error learning settings' })
    case '':
      return '-'
    default:
      return t('tenantLogs.audit.targetTypes.unknown', { defaultValue: 'Unknown target' })
  }
}

function summarizeTenantAuditReason(reason: string | undefined, t: TFunction): string {
  return normalizeAuditValue(reason)
    ? t('tenantLogs.audit.reasonValues.present', { defaultValue: 'Contains operator notes' })
    : t('tenantLogs.audit.reasonValues.none', { defaultValue: 'No extra notes' })
}

function summarizeTenantAuditPayload(payload: AuditLogItem['payload_json'], t: TFunction): string {
  const hasPayload =
    payload !== null
    && typeof payload === 'object'
    && Object.keys(payload).length > 0

  return hasPayload
    ? t('tenantLogs.audit.payloadSummary.present', { defaultValue: 'Contains extra context' })
    : t('tenantLogs.audit.payloadSummary.empty', { defaultValue: 'No extra context' })
}

export function TenantLogsPage() {
  const { t, i18n } = useTranslation()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<'request' | 'audit'>(() =>
    searchParams.get('tab') === 'audit' ? 'audit' : 'request',
  )
  const [rangePreset, setRangePreset] = useState<RangePreset>(() =>
    parseRangePreset(searchParams.get('range')),
  )
  const [apiKeyId, setApiKeyId] = useState(
    () => searchParams.get('api_key_id') || '',
  )
  const [statusCode, setStatusCode] = useState(
    () => searchParams.get('status_code') || '',
  )
  const [requestId, setRequestId] = useState(
    () => searchParams.get('request_id') || '',
  )
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') || '')
  const [auditActorType, setAuditActorType] = useState(
    () => searchParams.get('actor_type') || '',
  )
  const [auditActorId, setAuditActorId] = useState(
    () => searchParams.get('actor_id') || '',
  )
  const [auditAction, setAuditAction] = useState(
    () => searchParams.get('action') || '',
  )
  const [auditResultStatus, setAuditResultStatus] = useState(
    () => searchParams.get('result_status') || '',
  )
  const [auditKeyword, setAuditKeyword] = useState(
    () => searchParams.get('audit_keyword') || '',
  )
  const locale = i18n.resolvedLanguage

  const parsedStatusCode = Number(statusCode)
  const hasStatusCode = Number.isInteger(parsedStatusCode) && parsedStatusCode > 0
  const requestQueryParams = useMemo(() => {
    const range = currentRangeByDays(rangePreset)
    return {
      ...range,
      limit: 200,
      api_key_id: apiKeyId.trim() || undefined,
      status_code: hasStatusCode ? parsedStatusCode : undefined,
      request_id: requestId.trim() || undefined,
      keyword: keyword.trim() || undefined,
    }
  }, [apiKeyId, hasStatusCode, keyword, parsedStatusCode, rangePreset, requestId])

  const { data: ledger } = useQuery({
    queryKey: ['tenantRequestLogs', requestQueryParams],
    queryFn: () => requestLogsApi.tenantList(requestQueryParams),
    enabled: tab === 'request',
    staleTime: 60_000,
    refetchInterval: tab === 'request' ? 30_000 : false,
  })

  const auditQueryParams = useMemo(() => {
    const range = currentRangeByDays(rangePreset)
    return {
      ...range,
      limit: 200,
      actor_type: auditActorType.trim() || undefined,
      actor_id: auditActorId.trim() || undefined,
      action: auditAction.trim() || undefined,
      result_status: auditResultStatus.trim() || undefined,
      keyword: auditKeyword.trim() || undefined,
    }
  }, [auditAction, auditActorId, auditActorType, auditKeyword, auditResultStatus, rangePreset])

  const { data: auditLogs } = useQuery({
    queryKey: ['tenantAuditLogs', auditQueryParams],
    queryFn: () => auditLogsApi.tenantList(auditQueryParams),
    enabled: tab === 'audit',
    staleTime: 60_000,
    refetchInterval: tab === 'audit' ? 30_000 : false,
  })

  const columns = useMemo<ColumnDef<RequestAuditLogItem>[]>(
    () => [
      {
        id: 'createdAt',
        header: t('tenantLogs.request.columns.time', { defaultValue: 'Time' }),
        accessorFn: (row) => new Date(row.created_at).getTime(),
        cell: ({ row }) => (
          <span className="font-mono text-xs" title={buildTenantLogTimeTooltip(t, locale, row.original.created_at)}>
            {formatDateTime(row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'requestId',
        header: t('tenantLogs.request.columns.requestId', { defaultValue: 'Request ID' }),
        accessorFn: (row) => (row.request_id ?? '').toLowerCase(),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.request_id ?? '-'}</span>,
      },
      {
        id: 'apiKey',
        header: t('tenantLogs.request.columns.apiKey', { defaultValue: 'API Key' }),
        accessorFn: (row) => (row.api_key_id ?? '').toLowerCase(),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.api_key_id ?? '-'}</span>,
      },
      {
        id: 'path',
        header: t('tenantLogs.request.columns.path', { defaultValue: 'Path' }),
        accessorFn: (row) => `${row.method} ${row.path}`.toLowerCase(),
        cell: ({ row }) => {
          return (
            <div className="space-y-0.5">
              <div className="font-mono text-xs">{row.original.method}</div>
              <div className="text-xs text-muted-foreground">{row.original.path}</div>
            </div>
          )
        },
      },
      {
        id: 'status',
        header: t('tenantLogs.request.columns.status', { defaultValue: 'Status' }),
        accessorFn: (row) => row.status_code,
        cell: ({ row }) => (
          <span
            className={
              row.original.status_code >= 500
                ? 'text-destructive font-mono'
                : row.original.status_code >= 400
                  ? 'text-warning-foreground font-mono'
                  : 'text-success-foreground font-mono'
            }
          >
            {row.original.status_code}
          </span>
        ),
      },
      {
        id: 'serviceTier',
        header: t('tenantLogs.request.columns.serviceTier', { defaultValue: 'Tier' }),
        accessorFn: (row) => normalizeServiceTierForDisplay(row.service_tier),
        cell: ({ row }) => {
          if (!shouldHighlightServiceTier(row.original.service_tier)) {
            return <span className="text-xs text-muted-foreground">-</span>
          }
          return (
            <Badge
              variant={getServiceTierBadgeTone(row.original.service_tier)}
              className="px-2 py-0.5 font-medium"
            >
              {localizeTenantServiceTierLabel(t, row.original.service_tier)}
            </Badge>
          )
        },
      },
      {
        id: 'latency',
        header: t('tenantLogs.request.columns.latency', { defaultValue: 'Latency' }),
        accessorFn: (row) => row.latency_ms,
        cell: ({ row }) => <span className="font-mono">{formatDurationMs(row.original.latency_ms)}</span>,
      },
      {
        id: 'errorCode',
        header: t('tenantLogs.request.columns.error', { defaultValue: 'Error' }),
        accessorFn: (row) =>
          localizeRequestLogErrorDisplay(t, row.error_code, row.status_code).label.toLowerCase(),
        cell: ({ row }) => {
          const display = localizeRequestLogErrorDisplay(t, row.original.error_code, row.original.status_code)
          return (
            <span className="text-xs">
              {display.label}
            </span>
          )
        },
      },
    ],
    [t, locale],
  )

  const auditColumns = useMemo<ColumnDef<AuditLogItem>[]>(
    () => [
      {
        id: 'createdAt',
        header: t('tenantLogs.audit.columns.time', { defaultValue: 'Time' }),
        accessorFn: (row) => new Date(row.created_at).getTime(),
        cell: ({ row }) => (
          <span className="font-mono text-xs" title={buildTenantLogTimeTooltip(t, locale, row.original.created_at)}>
            {formatDateTime(row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'actor',
        header: t('tenantLogs.audit.columns.actor', { defaultValue: 'Actor' }),
        accessorFn: (row) =>
          `${localizeTenantAuditActorType(row.actor_type, t)} ${row.actor_id ?? ''}`.toLowerCase(),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="text-xs">
              {localizeTenantAuditActorType(row.original.actor_type, t)}
            </div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.actor_id ?? '-'}</div>
          </div>
        ),
      },
      {
        id: 'action',
        header: t('tenantLogs.audit.columns.action', { defaultValue: 'Action' }),
        accessorFn: (row) => localizeTenantAuditAction(row.action, t).toLowerCase(),
        cell: ({ row }) => (
          <span className="text-xs">
            {localizeTenantAuditAction(row.original.action, t)}
          </span>
        ),
      },
      {
        id: 'result',
        header: t('tenantLogs.audit.columns.result', { defaultValue: 'Result' }),
        accessorFn: (row) => normalizeAuditValue(row.result_status),
        cell: ({ row }) => (
          <span
            className={
              normalizeAuditValue(row.original.result_status) === 'ok'
                ? 'font-mono text-success-foreground'
                : 'font-mono text-destructive'
            }
          >
            {localizeTenantAuditResultStatus(row.original.result_status, t)}
          </span>
        ),
      },
      {
        id: 'target',
        header: t('tenantLogs.audit.columns.target', { defaultValue: 'Target' }),
        accessorFn: (row) =>
          `${localizeTenantAuditTargetType(row.target_type, t)} ${row.target_id ?? ''}`.toLowerCase(),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="text-xs">{localizeTenantAuditTargetType(row.original.target_type, t)}</div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.target_id ?? '-'}</div>
          </div>
        ),
      },
      {
        id: 'reason',
        header: t('tenantLogs.audit.columns.reason', { defaultValue: 'Details' }),
        accessorFn: (row) =>
          `${summarizeTenantAuditReason(row.reason, t)} ${summarizeTenantAuditPayload(row.payload_json, t)}`.toLowerCase(),
        cell: ({ row }) => {
          const reasonSummary = summarizeTenantAuditReason(row.original.reason, t)
          const payloadSummary = summarizeTenantAuditPayload(row.original.payload_json, t)
          return (
            <div className="space-y-0.5">
              <div className="text-xs">{reasonSummary}</div>
              <div className="max-w-[360px] truncate text-xs text-muted-foreground">
                {payloadSummary}
              </div>
            </div>
          )
        },
      },
    ],
    [t, locale],
  )

  const rangeOptions = [
    { value: '1', label: t('tenantLogs.filters.range.last24Hours', { defaultValue: 'Last 24 hours' }) },
    { value: '7', label: t('tenantLogs.filters.range.last7Days', { defaultValue: 'Last 7 days' }) },
    { value: '30', label: t('tenantLogs.filters.range.last30Days', { defaultValue: 'Last 30 days' }) },
  ]
  const logsLayout = describeLogsWorkbenchLayout()
  const tableSurfaceClassName = 'border-0 bg-transparent shadow-none'

  return (
    <PageContent>
      <div className="space-y-6 md:space-y-8">
        <DockedPageIntro
          archetype="workspace"
          title={t('tenantLogs.title', { defaultValue: 'Logs' })}
          description={t('tenantLogs.scope', { defaultValue: 'Scope: current tenant only' })}
        />

        <PagePanel tone="secondary">
          <div
            className={[
              'flex flex-wrap items-center gap-2',
              logsLayout.desktopToolbarAlignment === 'between' ? 'lg:justify-start' : '',
            ].filter(Boolean).join(' ')}
          >
            <Button
              color={tab === 'request' ? 'primary' : 'default'}
              variant={tab === 'request' ? 'solid' : 'bordered'}
              size="sm"
              onClick={() => setTab('request')}
            >
              {t('tenantLogs.tabs.request', { defaultValue: 'Request Logs' })}
            </Button>
            <Button
              color={tab === 'audit' ? 'primary' : 'default'}
              variant={tab === 'audit' ? 'solid' : 'bordered'}
              size="sm"
              onClick={() => setTab('audit')}
            >
              {t('tenantLogs.tabs.audit', { defaultValue: 'Audit Logs' })}
            </Button>
          </div>
        </PagePanel>

        {tab === 'request' ? (
          <PagePanel className="space-y-5">
            <SectionHeader
              title={t('tenantLogs.request.title', { defaultValue: 'Request Logs' })}
              description={t('tenantLogs.request.description', {
                defaultValue: 'Definition: Data Plane raw request events (current tenant only)',
              })}
            />
            <LogsFilterGrid className="md:grid-cols-2 xl:grid-cols-5">
              <LogsFilterField label={t('tenantLogs.request.filters.rangeAriaLabel', { defaultValue: 'Time range' })}>
                <LogsFilterSelect
                  value={String(rangePreset)}
                  onValueChange={(value) => setRangePreset(Number(value) as RangePreset)}
                  ariaLabel={t('tenantLogs.request.filters.rangeAriaLabel', { defaultValue: 'Time range' })}
                  options={rangeOptions}
                />
              </LogsFilterField>
              <LogsFilterField label={t('tenantLogs.request.filters.apiKeyAriaLabel', { defaultValue: 'API key filter' })}>
                <LogsFilterInput
                  value={apiKeyId}
                  onValueChange={setApiKeyId}
                  aria-label={t('tenantLogs.request.filters.apiKeyAriaLabel', { defaultValue: 'API key ID' })}
                  placeholder={t('tenantLogs.request.filters.apiKeyIdPlaceholder', {
                    defaultValue: 'API Key ID',
                  })}
                />
              </LogsFilterField>
              <LogsFilterField label={t('tenantLogs.request.filters.statusCodeAriaLabel', { defaultValue: 'Status code filter' })}>
                <LogsFilterInput
                  value={statusCode}
                  onValueChange={setStatusCode}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={t('tenantLogs.request.filters.statusCodeAriaLabel', { defaultValue: 'Status code' })}
                  placeholder={t('tenantLogs.request.filters.statusCodePlaceholder', {
                    defaultValue: 'Status code (e.g. 429)',
                  })}
                />
              </LogsFilterField>
              <LogsFilterField label={t('tenantLogs.request.filters.requestIdAriaLabel', { defaultValue: 'Request ID filter' })}>
                <LogsFilterInput
                  value={requestId}
                  onValueChange={setRequestId}
                  aria-label={t('tenantLogs.request.filters.requestIdAriaLabel', { defaultValue: 'Request ID' })}
                  placeholder={t('tenantLogs.request.filters.requestIdPlaceholder', {
                    defaultValue: 'Request ID',
                  })}
                />
              </LogsFilterField>
              <LogsFilterField label={t('tenantLogs.request.filters.keywordAriaLabel', { defaultValue: 'Keyword filter' })}>
                <LogsFilterInput
                  value={keyword}
                  onValueChange={setKeyword}
                  aria-label={t('tenantLogs.request.filters.keywordAriaLabel', { defaultValue: 'Keyword' })}
                  placeholder={t('tenantLogs.request.filters.keywordPlaceholder', {
                    defaultValue: 'Keyword (path/error/model)',
                  })}
                />
              </LogsFilterField>
            </LogsFilterGrid>
            <DataTable
              columns={columns}
              data={ledger?.items ?? []}
              defaultPageSize={20}
              pageSizeOptions={[20, 50, 100]}
              density="compact"
              className={tableSurfaceClassName}
              emptyText={t('tenantLogs.request.empty', { defaultValue: 'No log data' })}
            />
          </PagePanel>
        ) : (
          <PagePanel className="space-y-5">
            <SectionHeader
              title={t('tenantLogs.audit.title', { defaultValue: 'Audit Logs' })}
              description={t('tenantLogs.audit.description', {
                defaultValue: 'Definition: Control Plane audit events (current tenant only)',
              })}
            />
            <LogsFilterGrid className="md:grid-cols-2 xl:grid-cols-6">
              <LogsFilterField label={t('tenantLogs.audit.filters.rangeAriaLabel', { defaultValue: 'Time range' })}>
                <LogsFilterSelect
                  value={String(rangePreset)}
                  onValueChange={(value) => setRangePreset(Number(value) as RangePreset)}
                  ariaLabel={t('tenantLogs.audit.filters.rangeAriaLabel', { defaultValue: 'Time range' })}
                  options={rangeOptions}
                />
              </LogsFilterField>
              <LogsFilterField label={t('tenantLogs.audit.filters.actorTypeAriaLabel', { defaultValue: 'Actor type filter' })}>
                <LogsFilterInput
                  value={auditActorType}
                  onValueChange={setAuditActorType}
                  aria-label={t('tenantLogs.audit.filters.actorTypeAriaLabel', { defaultValue: 'Actor type' })}
                  placeholder={t('tenantLogs.audit.filters.actorTypePlaceholder', {
                    defaultValue: 'Actor type',
                  })}
                />
              </LogsFilterField>
              <LogsFilterField label={t('tenantLogs.audit.filters.actorIdAriaLabel', { defaultValue: 'Actor ID filter' })}>
                <LogsFilterInput
                  value={auditActorId}
                  onValueChange={setAuditActorId}
                  aria-label={t('tenantLogs.audit.filters.actorIdAriaLabel', { defaultValue: 'Actor ID' })}
                  placeholder={t('tenantLogs.audit.filters.actorIdPlaceholder', {
                    defaultValue: 'Actor ID',
                  })}
                />
              </LogsFilterField>
              <LogsFilterField label={t('tenantLogs.audit.filters.actionAriaLabel', { defaultValue: 'Action filter' })}>
                <LogsFilterInput
                  value={auditAction}
                  onValueChange={setAuditAction}
                  aria-label={t('tenantLogs.audit.filters.actionAriaLabel', { defaultValue: 'Action' })}
                  placeholder={t('tenantLogs.audit.filters.actionPlaceholder', {
                    defaultValue: 'Action',
                  })}
                />
              </LogsFilterField>
              <LogsFilterField label={t('tenantLogs.audit.filters.resultStatusAriaLabel', { defaultValue: 'Result status filter' })}>
                <LogsFilterInput
                  value={auditResultStatus}
                  onValueChange={setAuditResultStatus}
                  aria-label={t('tenantLogs.audit.filters.resultStatusAriaLabel', { defaultValue: 'Result status' })}
                  placeholder={t('tenantLogs.audit.filters.resultStatusPlaceholder', {
                    defaultValue: 'Result status',
                  })}
                />
              </LogsFilterField>
              <LogsFilterField label={t('tenantLogs.audit.filters.keywordAriaLabel', { defaultValue: 'Keyword filter' })}>
                <LogsFilterInput
                  value={auditKeyword}
                  onValueChange={setAuditKeyword}
                  aria-label={t('tenantLogs.audit.filters.keywordAriaLabel', { defaultValue: 'Keyword' })}
                  placeholder={t('tenantLogs.audit.filters.keywordPlaceholder', {
                    defaultValue: 'Keyword (reason/payload)',
                  })}
                />
              </LogsFilterField>
            </LogsFilterGrid>
            <DataTable
              columns={auditColumns}
              data={auditLogs?.items ?? []}
              defaultPageSize={20}
              pageSizeOptions={[20, 50, 100]}
              density="compact"
              className={tableSurfaceClassName}
              emptyText={t('tenantLogs.audit.empty', { defaultValue: 'No audit log data' })}
            />
          </PagePanel>
        )}
      </div>
    </PageContent>
  )
}
