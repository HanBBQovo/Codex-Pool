import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, Download, Info } from 'lucide-react'
import { format } from 'date-fns'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { adminTenantsApi } from '@/api/adminTenants'
import { auditLogsApi, type AuditLogItem } from '@/api/auditLogs'
import { localizeRequestLogErrorDisplay } from '@/api/errorI18n'
import { eventStreamApi, type SystemEventCategory, type SystemEventItem, type SystemEventSeverity } from '@/api/eventStream'
import { logsApi, type SystemLogEntry } from '@/api/logs'
import { requestLogsApi, type RequestAuditLogItem } from '@/api/requestLogs'
import {
  PageIntro,
  PagePanel,
  SectionHeader,
} from '@/components/layout/page-archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LoadingOverlay } from '@/components/ui/loading-overlay'
import { StandardDataTable } from '@/components/ui/standard-data-table'
import {
  LogsFilterField,
  LogsFilterGrid,
  LogsFilterInput,
  LogsFilterSelect,
} from '@/features/logs/filter-controls'
import {
  getServiceTierBadgeTone,
  getServiceTierDefaultLabel,
  normalizeServiceTierForDisplay,
  shouldHighlightServiceTier,
} from '@/features/billing/service-tier'
import { formatDateTime as formatI18nDateTime, formatUtcDateTime, getUserTimeZone } from '@/lib/i18n-format'
import { describeLogsWorkbenchLayout } from '@/lib/page-archetypes'
import { cn } from '@/lib/utils'

type LogLevelFilter = 'all' | 'error' | 'warn' | 'info'
type RangePreset = 1 | 7 | 30

function normalizeAuditValue(value?: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

function currentRangeByDays(days: number) {
  const endTs = Math.floor(Date.now() / 1000)
  const startTs = endTs - days * 24 * 60 * 60
  return { start_ts: startTs, end_ts: endTs }
}

function formatLocalLogDateTime(
  value: string | number | Date,
  locale?: string,
) {
  return formatI18nDateTime(value, {
    locale,
    preset: 'datetime',
    fallback: '-',
  })
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

function buildLogTimeTooltip(
  t: TFunction,
  locale: string | undefined,
  value: string | number | Date,
) {
  return t('logs.time.tooltip', {
    defaultValue: 'Local: {{local}} | UTC: {{utc}}',
    local: formatLocalLogDateTime(value, locale),
    utc: formatUtcLogDateTime(value, locale),
  })
}

function localizeServiceTierLabel(t: TFunction, serviceTier?: string) {
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

function normalizeLogLevel(level: string): Exclude<LogLevelFilter, 'all'> {
  const normalized = level.trim().toUpperCase()
  if (normalized === 'ERROR') return 'error'
  if (normalized === 'WARN' || normalized === 'WARNING') return 'warn'
  return 'info'
}

function localizeLogAction(action: string, t: TFunction): string {
  if (action === 'admin.system.state') return t('logs.actions.systemState')
  if (action === 'admin.config.update') return t('logs.actions.configUpdate')
  if (action === 'admin.proxies.test') return t('logs.actions.proxiesTest')
  if (action === 'admin.keys.create') return t('logs.actions.keyCreate')
  if (action === 'admin.keys.patch') return t('logs.actions.keyPatch')
  if (action === 'admin.models.list') return t('logs.actions.modelsList')
  if (action === 'admin.models.probe') return t('logs.actions.modelsProbe')
  return t('logs.actions.unknown', { action })
}

function localizeLogMessage(action: string, message: string, t: TFunction): string {
  const normalizedMessage = message.trim()
  if (!normalizedMessage) {
    return t('logs.messages.empty')
  }
  if (action === 'admin.system.state') {
    const matched = normalizedMessage.match(/queried system state:\s*(\d+)\s+accounts/i)
    if (matched) {
      return t('logs.messages.systemState', { count: Number(matched[1]) })
    }
  }
  if (
    action === 'admin.config.update'
    && normalizedMessage.toLowerCase() === 'updated runtime config snapshot in-memory'
  ) {
    return t('logs.messages.configUpdated')
  }
  if (action === 'admin.proxies.test') {
    const matched = normalizedMessage.match(/tested\s*(\d+)\s+proxy nodes/i)
    if (matched) {
      return t('logs.messages.proxiesTested', { count: Number(matched[1]) })
    }
  }
  if (action === 'admin.keys.create') {
    const matched = normalizedMessage.match(/created api key\s+([a-f0-9-]+)/i)
    if (matched) {
      return t('logs.messages.keyCreated', { keyId: matched[1] })
    }
  }
  if (action === 'admin.keys.patch') {
    const matched = normalizedMessage.match(/set api key\s+([a-f0-9-]+)\s+enabled=(true|false)/i)
    if (matched) {
      return t('logs.messages.keyPatched', {
        keyId: matched[1],
        enabled: matched[2] === 'true' ? t('common.yes') : t('common.no'),
      })
    }
  }
  if (action === 'admin.models.list') {
    const matched = normalizedMessage.match(/loaded models from upstream account\s+(.+)/i)
    if (matched) {
      return t('logs.messages.modelsLoaded', { label: matched[1] })
    }
  }
  if (action === 'admin.models.probe') {
    const matched = normalizedMessage.match(
      /model probe \(([^)]+)\) tested\s*(\d+)\s+models via account\s+(.+)\s+\(available=(\d+),\s*unavailable=(\d+)\)/i,
    )
    if (matched) {
      return t('logs.messages.modelsProbed', {
        trigger: matched[1],
        tested: Number(matched[2]),
        label: matched[3],
        available: Number(matched[4]),
        unavailable: Number(matched[5]),
      })
    }
  }
  return t('logs.messages.unmappedAction', {
    action: localizeLogAction(action, t),
    message: normalizedMessage,
  })
}

function levelLabel(level: string, t: TFunction) {
  const normalized = normalizeLogLevel(level)
  if (normalized === 'error') return t('logs.levels.error')
  if (normalized === 'warn') return t('logs.levels.warn')
  return t('logs.levels.info')
}

function levelIcon(level: string) {
  const normalized = normalizeLogLevel(level)
  if (normalized === 'error') {
    return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
  }
  if (normalized === 'warn') {
    return <AlertTriangle className="h-3.5 w-3.5 text-warning" />
  }
  return <Info className="h-3.5 w-3.5 text-info" />
}

function parseRangePreset(raw: string | null): RangePreset {
  if (raw === '7') return 7
  if (raw === '30') return 30
  return 1
}

function localizeSystemEventCategory(
  category: SystemEventCategory,
  t: TFunction,
) {
  switch (category) {
    case 'request':
      return t('logs.events.categories.request', { defaultValue: 'Request' })
    case 'account_pool':
      return t('logs.events.categories.accountPool', { defaultValue: 'Account pool' })
    case 'patrol':
      return t('logs.events.categories.patrol', { defaultValue: 'Patrol' })
    case 'import':
      return t('logs.events.categories.import', { defaultValue: 'Import' })
    case 'infra':
      return t('logs.events.categories.infra', { defaultValue: 'Infrastructure' })
    case 'admin_action':
      return t('logs.events.categories.adminAction', { defaultValue: 'Admin action' })
    default:
      return t('logs.events.categories.unknown', { defaultValue: 'Unknown' })
  }
}

function localizeSystemEventSeverity(
  severity: SystemEventSeverity,
  t: TFunction,
) {
  switch (severity) {
    case 'debug':
      return t('logs.events.severities.debug', { defaultValue: 'Debug' })
    case 'info':
      return t('logs.events.severities.info', { defaultValue: 'Info' })
    case 'warn':
      return t('logs.events.severities.warn', { defaultValue: 'Warning' })
    case 'error':
      return t('logs.events.severities.error', { defaultValue: 'Error' })
    default:
      return t('logs.events.severities.unknown', { defaultValue: 'Unknown' })
  }
}

function localizeAuditActorType(actorType: string | undefined, t: TFunction): string {
  switch (normalizeAuditValue(actorType)) {
    case 'admin_user':
      return t('logs.audit.actorTypes.adminUser', { defaultValue: 'Admin user' })
    case 'tenant_user':
      return t('logs.audit.actorTypes.tenantUser', { defaultValue: 'Tenant user' })
    case 'api_key':
      return t('logs.audit.actorTypes.apiKey', { defaultValue: 'API key' })
    case 'system':
      return t('logs.audit.actorTypes.system', { defaultValue: 'System' })
    default:
      return t('logs.audit.actorTypes.unknown', { defaultValue: 'Unknown actor' })
  }
}

function localizeAuditResultStatus(resultStatus: string | undefined, t: TFunction): string {
  switch (normalizeAuditValue(resultStatus)) {
    case 'ok':
      return t('logs.audit.resultStatuses.ok', { defaultValue: 'Success' })
    case 'failed':
    case 'error':
      return t('logs.audit.resultStatuses.failed', { defaultValue: 'Failed' })
    case 'denied':
      return t('logs.audit.resultStatuses.denied', { defaultValue: 'Denied' })
    default:
      return t('logs.audit.resultStatuses.unknown', { defaultValue: 'Unknown result' })
  }
}

function localizeAuditAction(action: string | undefined, t: TFunction): string {
  const normalized = normalizeAuditValue(action)
  if (!normalized) {
    return t('logs.audit.actionValues.unknown', { defaultValue: 'Unknown action' })
  }

  switch (normalized) {
    case 'admin.system.state':
      return t('logs.actions.systemState', { defaultValue: 'System state query' })
    case 'admin.config.update':
      return t('logs.actions.configUpdate', { defaultValue: 'Config update' })
    case 'admin.proxies.test':
      return t('logs.actions.proxiesTest', { defaultValue: 'Proxy health check' })
    case 'admin.keys.create':
      return t('logs.actions.keyCreate', { defaultValue: 'Create API key' })
    case 'admin.keys.patch':
      return t('logs.actions.keyPatch', { defaultValue: 'Update API key' })
    case 'admin.models.list':
      return t('logs.actions.modelsList', { defaultValue: 'Fetch model list' })
    case 'admin.models.probe':
      return t('logs.actions.modelsProbe', { defaultValue: 'Model probe' })
    default:
      break
  }

  if (normalized.startsWith('admin.')) {
    return t('logs.audit.actionValues.adminOperation', { defaultValue: 'Admin operation' })
  }
  if (normalized.startsWith('tenant.')) {
    return t('logs.audit.actionValues.tenantOperation', { defaultValue: 'Tenant operation' })
  }
  if (normalized.startsWith('auth.')) {
    return t('logs.audit.actionValues.authOperation', { defaultValue: 'Auth operation' })
  }
  if (normalized.startsWith('request.')) {
    return t('logs.audit.actionValues.requestOperation', { defaultValue: 'Request operation' })
  }
  return t('logs.audit.actionValues.unknown', { defaultValue: 'Unknown action' })
}

function formatEventPayload(value?: Record<string, unknown> | null) {
  if (!value || Object.keys(value).length === 0) {
    return null
  }
  return JSON.stringify(value, null, 2)
}

export default function Logs() {
  const { t, i18n } = useTranslation()
  const [searchParams] = useSearchParams()
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>('all')
  const [tab, setTab] = useState<'events' | 'request' | 'system' | 'audit'>(() => {
    const tabParam = searchParams.get('tab')
    return tabParam === 'events' || tabParam === 'request' || tabParam === 'system' || tabParam === 'audit'
      ? tabParam
      : 'events'
  })
  const [rangePreset, setRangePreset] = useState<RangePreset>(() =>
    parseRangePreset(searchParams.get('range')),
  )
  const [selectedTenantId, setSelectedTenantId] = useState(
    () => searchParams.get('tenant_id') || 'all',
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
  const [eventCategory, setEventCategory] = useState<SystemEventCategory | 'all'>(
    () => (searchParams.get('category') as SystemEventCategory | 'all') || 'all',
  )
  const [eventSeverity, setEventSeverity] = useState<SystemEventSeverity | 'all'>(
    () => (searchParams.get('severity') as SystemEventSeverity | 'all') || 'all',
  )
  const [eventAccountId, setEventAccountId] = useState(
    () => searchParams.get('account_id') || '',
  )
  const [eventRequestId, setEventRequestId] = useState(
    () => searchParams.get('event_request_id') || searchParams.get('request_id') || '',
  )
  const [eventJobId, setEventJobId] = useState(
    () => searchParams.get('job_id') || '',
  )
  const [eventReasonCode, setEventReasonCode] = useState(
    () => searchParams.get('reason_code') || '',
  )
  const [eventKeyword, setEventKeyword] = useState(
    () => searchParams.get('event_keyword') || '',
  )
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const currentTimeZone = useMemo(() => getUserTimeZone(), [])
  const locale = i18n.resolvedLanguage

  const { data: tenants = [] } = useQuery({
    queryKey: ['adminTenants', 'logs'],
    queryFn: () => adminTenantsApi.listTenants(),
    staleTime: 60_000,
  })

  const effectiveTenantId = selectedTenantId === 'all' ? undefined : selectedTenantId
  const parsedStatusCode = Number(statusCode)
  const hasStatusCode = Number.isInteger(parsedStatusCode) && parsedStatusCode > 0

  const requestQueryParams = useMemo(() => {
    const range = currentRangeByDays(rangePreset)
    return {
      ...range,
      limit: 200,
      tenant_id: effectiveTenantId,
      api_key_id: apiKeyId.trim() || undefined,
      status_code: hasStatusCode ? parsedStatusCode : undefined,
      request_id: requestId.trim() || undefined,
      keyword: keyword.trim() || undefined,
    }
  }, [apiKeyId, effectiveTenantId, hasStatusCode, keyword, parsedStatusCode, rangePreset, requestId])

  const eventQueryParams = useMemo(() => {
    const range = currentRangeByDays(rangePreset)
    return {
      ...range,
      limit: 200,
      tenant_id: effectiveTenantId,
      account_id: eventAccountId.trim() || undefined,
      request_id: eventRequestId.trim() || undefined,
      job_id: eventJobId.trim() || undefined,
      category: eventCategory === 'all' ? undefined : eventCategory,
      severity: eventSeverity === 'all' ? undefined : eventSeverity,
      reason_code: eventReasonCode.trim() || undefined,
      keyword: eventKeyword.trim() || undefined,
    }
  }, [
    effectiveTenantId,
    eventAccountId,
    eventCategory,
    eventJobId,
    eventKeyword,
    eventReasonCode,
    eventRequestId,
    eventSeverity,
    rangePreset,
  ])

  const { data: eventLedger } = useQuery({
    queryKey: ['adminEventStream', eventQueryParams],
    queryFn: () => eventStreamApi.adminList(eventQueryParams),
    enabled: tab === 'events',
    staleTime: 15_000,
    refetchInterval: tab === 'events' ? 15_000 : false,
  })

  const { data: eventSummary } = useQuery({
    queryKey: ['adminEventStreamSummary', eventQueryParams],
    queryFn: () => eventStreamApi.adminSummary(eventQueryParams),
    enabled: tab === 'events',
    staleTime: 15_000,
    refetchInterval: tab === 'events' ? 15_000 : false,
  })

  const selectedEventSeed = useMemo(
    () => (eventLedger?.items ?? []).find((item) => item.id === selectedEventId) ?? null,
    [eventLedger?.items, selectedEventId],
  )

  const { data: selectedEventDetail, isLoading: selectedEventDetailLoading } = useQuery({
    queryKey: ['adminEventStreamDetail', selectedEventId],
    queryFn: () => eventStreamApi.adminDetail(selectedEventId!),
    enabled: Boolean(selectedEventId) && tab === 'events',
    staleTime: 15_000,
  })

  const selectedEvent = selectedEventDetail?.item ?? selectedEventSeed ?? null
  const selectedEventRequestId = selectedEvent?.request_id ?? undefined

  const { data: selectedEventCorrelation, isLoading: selectedEventCorrelationLoading } = useQuery({
    queryKey: ['adminEventStreamCorrelation', selectedEventRequestId, rangePreset],
    queryFn: () =>
      eventStreamApi.adminCorrelation(selectedEventRequestId!, {
        ...currentRangeByDays(rangePreset),
        limit: 100,
      }),
    enabled: Boolean(selectedEventId && selectedEventRequestId) && tab === 'events',
    staleTime: 15_000,
  })

  const { data: requestLedger } = useQuery({
    queryKey: ['adminRequestLogs', requestQueryParams],
    queryFn: () => requestLogsApi.adminList(requestQueryParams),
    enabled: tab === 'request',
    staleTime: 30_000,
    refetchInterval: tab === 'request' ? 30_000 : false,
  })

  const auditQueryParams = useMemo(() => {
    const range = currentRangeByDays(rangePreset)
    return {
      ...range,
      limit: 200,
      tenant_id: effectiveTenantId,
      actor_type: auditActorType.trim() || undefined,
      actor_id: auditActorId.trim() || undefined,
      action: auditAction.trim() || undefined,
      result_status: auditResultStatus.trim() || undefined,
      keyword: auditKeyword.trim() || undefined,
    }
  }, [
    auditAction,
    auditActorId,
    auditActorType,
    auditKeyword,
    auditResultStatus,
    effectiveTenantId,
    rangePreset,
  ])

  const { data: auditLogs } = useQuery({
    queryKey: ['adminAuditLogs', auditQueryParams],
    queryFn: () => auditLogsApi.adminList(auditQueryParams),
    enabled: tab === 'audit',
    staleTime: 30_000,
    refetchInterval: tab === 'audit' ? 30_000 : false,
  })

  const { data: rawLogs = [], isLoading } = useQuery({
    queryKey: ['systemLogs'],
    queryFn: () => logsApi.getSystemLogs({ limit: 200 }),
    staleTime: 15000,
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'visible'
        ? 15000
        : false,
    refetchIntervalInBackground: false,
  })

  const filteredLogs = useMemo(() => {
    return rawLogs.filter((log) => {
      return levelFilter === 'all' || normalizeLogLevel(log.level) === levelFilter
    })
  }, [levelFilter, rawLogs])

  const columns = useMemo<ColumnDef<SystemLogEntry>[]>(
    () => [
      {
        id: 'timestamp',
        accessorFn: (row) => new Date(row.ts).getTime(),
        header: t('logs.columns.timestamp'),
        cell: ({ row }) => (
          <span
            className="font-mono text-xs text-muted-foreground"
            title={buildLogTimeTooltip(t, locale, row.original.ts)}
          >
            {format(new Date(row.original.ts), 'MM-dd HH:mm:ss.SSS')}
          </span>
        ),
      },
      {
        id: 'level',
        accessorFn: (row) => normalizeLogLevel(row.level),
        header: t('logs.columns.level'),
        cell: ({ row }) => {
          const normalized = normalizeLogLevel(row.original.level)
          return (
            <span
              className={cn(
                'flex items-center gap-1.5 font-medium',
                normalized === 'error'
                  ? 'text-destructive'
                  : normalized === 'warn'
                    ? 'text-warning-foreground'
                    : 'text-info-foreground',
              )}
            >
              {levelIcon(row.original.level)}
              {levelLabel(row.original.level, t)}
            </span>
          )
        },
      },
      {
        id: 'service',
        accessorFn: (row) => localizeLogAction(row.action, t).toLowerCase(),
        header: t('logs.columns.service'),
        cell: ({ row }) => (
          <span className="block max-w-[280px] truncate text-sm text-muted-foreground" title={row.original.action}>
            {localizeLogAction(row.original.action, t)}
          </span>
        ),
      },
      {
        id: 'message',
        accessorFn: (row) => localizeLogMessage(row.action, row.message || '', t).toLowerCase(),
        header: t('logs.columns.message'),
        cell: ({ row }) => (
          <span className="block min-w-[320px] break-words text-sm">
            {localizeLogMessage(row.original.action, row.original.message || '', t)}
          </span>
        ),
      },
    ],
    [t, locale],
  )

  const handleExport = () => {
    const payload = filteredLogs.map((item) => ({
      ts_utc: item.ts,
      ts_local: formatLocalLogDateTime(item.ts, locale),
      level: item.level,
      action: item.action,
      action_localized: localizeLogAction(item.action, t),
      message: item.message,
      message_localized: localizeLogMessage(item.action, item.message || '', t),
    }))
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `system-logs-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const requestColumns = useMemo<ColumnDef<RequestAuditLogItem>[]>(
    () => [
      {
        id: 'createdAt',
        header: t('logs.request.columns.createdAt', { defaultValue: 'Time' }),
        accessorFn: (row) => new Date(row.created_at).getTime(),
        cell: ({ row }) => (
          <span
            className="font-mono text-xs text-muted-foreground"
            title={buildLogTimeTooltip(t, locale, row.original.created_at)}
          >
            {formatLocalLogDateTime(row.original.created_at, locale)}
          </span>
        ),
      },
      {
        id: 'tenant',
        header: t('logs.request.columns.tenant', { defaultValue: 'Tenant' }),
        accessorFn: (row) => (row.tenant_id ?? '').toLowerCase(),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.tenant_id ?? '-'}</span>,
      },
      {
        id: 'requestId',
        header: t('logs.request.columns.requestId', { defaultValue: 'Request ID' }),
        accessorFn: (row) => (row.request_id ?? '').toLowerCase(),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.request_id ?? '-'}
          </span>
        ),
      },
      {
        id: 'apiKey',
        header: t('logs.request.columns.apiKey', { defaultValue: 'API Key' }),
        accessorFn: (row) => (row.api_key_id ?? '').toLowerCase(),
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.api_key_id ?? '-'}
          </span>
        ),
      },
      {
        id: 'path',
        header: t('logs.request.columns.path', { defaultValue: 'Path' }),
        accessorFn: (row) => `${row.method} ${row.path}`.toLowerCase(),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="font-mono text-xs">{row.original.method}</div>
            <div className="text-xs text-muted-foreground">{row.original.path}</div>
          </div>
        ),
      },
      {
        id: 'status',
        header: t('logs.request.columns.status', { defaultValue: 'Status' }),
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
        header: t('logs.request.columns.serviceTier', { defaultValue: 'Tier' }),
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
              {localizeServiceTierLabel(t, row.original.service_tier)}
            </Badge>
          )
        },
      },
      {
        id: 'latency',
        header: t('logs.request.columns.latency', { defaultValue: 'Latency (ms)' }),
        accessorFn: (row) => row.latency_ms,
        cell: ({ row }) => <span className="font-mono">{row.original.latency_ms}</span>,
      },
      {
        id: 'errorCode',
        header: t('logs.request.columns.errorCode', { defaultValue: 'Error' }),
        accessorFn: (row) =>
          localizeRequestLogErrorDisplay(t, row.error_code, row.status_code).label.toLowerCase(),
        cell: ({ row }) => {
          const display = localizeRequestLogErrorDisplay(t, row.original.error_code, row.original.status_code)
          return (
            <span className="text-xs" title={display.tooltip}>
              {display.label}
            </span>
          )
        },
      },
    ],
    [t, locale],
  )

  const eventColumns = useMemo<ColumnDef<SystemEventItem>[]>(
    () => [
      {
        id: 'ts',
        header: t('logs.events.columns.createdAt', { defaultValue: 'Time' }),
        accessorFn: (row) => new Date(row.ts).getTime(),
        cell: ({ row }) => (
          <span
            className="font-mono text-xs text-muted-foreground"
            title={buildLogTimeTooltip(t, locale, row.original.ts)}
          >
            {formatLocalLogDateTime(row.original.ts, locale)}
          </span>
        ),
      },
      {
        id: 'severity',
        header: t('logs.events.columns.severity', { defaultValue: 'Severity' }),
        accessorFn: (row) => row.severity,
        cell: ({ row }) => (
          <Badge variant={row.original.severity === 'error' ? 'destructive' : row.original.severity === 'warn' ? 'warning' : 'secondary'}>
            {localizeSystemEventSeverity(row.original.severity, t)}
          </Badge>
        ),
      },
      {
        id: 'category',
        header: t('logs.events.columns.category', { defaultValue: 'Category' }),
        accessorFn: (row) => row.category,
        cell: ({ row }) => (
          <span className="text-xs">
            {localizeSystemEventCategory(row.original.category, t)}
          </span>
        ),
      },
      {
        id: 'eventType',
        header: t('logs.events.columns.eventType', { defaultValue: 'Event' }),
        accessorFn: (row) => row.event_type.toLowerCase(),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="font-mono text-xs">{row.original.event_type}</div>
            <div className="text-xs text-muted-foreground">{row.original.source}</div>
          </div>
        ),
      },
      {
        id: 'account',
        header: t('logs.events.columns.account', { defaultValue: 'Account' }),
        accessorFn: (row) => `${row.account_label ?? ''} ${row.account_id ?? ''}`.toLowerCase(),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="text-xs">{row.original.account_label ?? '-'}</div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.account_id ?? '-'}</div>
          </div>
        ),
      },
      {
        id: 'requestId',
        header: t('logs.events.columns.requestId', { defaultValue: 'Request ID' }),
        accessorFn: (row) => (row.request_id ?? '').toLowerCase(),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.request_id ?? '-'}</span>
        ),
      },
      {
        id: 'reason',
        header: t('logs.events.columns.reason', { defaultValue: 'Reason' }),
        accessorFn: (row) => `${row.reason_class ?? ''} ${row.reason_code ?? ''}`.toLowerCase(),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="text-xs">{row.original.reason_class ?? '-'}</div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.reason_code ?? '-'}</div>
          </div>
        ),
      },
      {
        id: 'message',
        header: t('logs.events.columns.message', { defaultValue: 'Message' }),
        accessorFn: (row) => `${row.message ?? ''} ${row.preview_text ?? ''}`.toLowerCase(),
        cell: ({ row }) => (
          <div className="max-w-[420px] space-y-0.5">
            <div className="text-sm">{row.original.message ?? '-'}</div>
            {row.original.preview_text ? (
              <div className="truncate font-mono text-xs text-muted-foreground">
                {row.original.preview_text}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'actions',
        header: t('logs.events.columns.actions', { defaultValue: 'Actions' }),
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setSelectedEventId(row.original.id)}
          >
            {t('logs.events.actions.viewDetail', { defaultValue: 'Details' })}
          </Button>
        ),
      },
    ],
    [locale, t],
  )

  const rangeOptions = [
    { value: '1', label: t('logs.range.last24Hours', { defaultValue: 'Last 24 hours' }) },
    { value: '7', label: t('logs.range.last7Days', { defaultValue: 'Last 7 days' }) },
    { value: '30', label: t('logs.range.last30Days', { defaultValue: 'Last 30 days' }) },
  ]
  const eventCategoryOptions = [
    { value: 'all', label: t('logs.events.filters.allCategories', { defaultValue: 'All categories' }) },
    { value: 'request', label: localizeSystemEventCategory('request', t) },
    { value: 'account_pool', label: localizeSystemEventCategory('account_pool', t) },
    { value: 'patrol', label: localizeSystemEventCategory('patrol', t) },
    { value: 'import', label: localizeSystemEventCategory('import', t) },
    { value: 'infra', label: localizeSystemEventCategory('infra', t) },
    { value: 'admin_action', label: localizeSystemEventCategory('admin_action', t) },
  ]
  const eventSeverityOptions = [
    { value: 'all', label: t('logs.events.filters.allSeverities', { defaultValue: 'All severities' }) },
    { value: 'debug', label: localizeSystemEventSeverity('debug', t) },
    { value: 'info', label: localizeSystemEventSeverity('info', t) },
    { value: 'warn', label: localizeSystemEventSeverity('warn', t) },
    { value: 'error', label: localizeSystemEventSeverity('error', t) },
  ]
  const logsLayout = describeLogsWorkbenchLayout()
  const tableSurfaceClassName = 'border-0 bg-transparent shadow-none'
  const levelOptions = [
    { value: 'all', label: t('logs.levels.all', { defaultValue: 'All levels' }) },
    { value: 'error', label: t('logs.levels.error', { defaultValue: 'Error' }) },
    { value: 'warn', label: t('logs.levels.warn', { defaultValue: 'Warning' }) },
    { value: 'info', label: t('logs.levels.info', { defaultValue: 'Info' }) },
  ]

  const tenantOptions = [
    { value: 'all', label: t('logs.filters.allTenants', { defaultValue: 'All tenants' }) },
    ...tenants.map((tenant) => ({
      value: tenant.id,
      label: `${tenant.name} (${tenant.id})`,
    })),
  ]

  const eventsPanel = (
    <PagePanel className="space-y-5">
      <SectionHeader
        title={t('logs.events.title', { defaultValue: 'Event Stream' })}
        description={t('logs.events.description', {
          defaultValue: 'Scope: Unified request, account pool, patrol, import and infrastructure events created after the new event stream was enabled.',
        })}
      />
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          {t('logs.events.summary.total', {
            defaultValue: 'Total {{count}}',
            count: eventSummary?.total ?? 0,
          })}
        </Badge>
        {(eventSummary?.by_category ?? []).slice(0, 4).map((item) => (
          <Badge key={item.category} variant="outline">
            {localizeSystemEventCategory(item.category, t)} {item.count}
          </Badge>
        ))}
      </div>
      <LogsFilterGrid className="md:grid-cols-2 xl:grid-cols-8">
        <LogsFilterField label={t('logs.events.filters.rangeAriaLabel', { defaultValue: 'Time range' })}>
          <LogsFilterSelect
            value={String(rangePreset)}
            onValueChange={(value) => setRangePreset(Number(value) as RangePreset)}
            ariaLabel={t('logs.events.filters.rangeAriaLabel', { defaultValue: 'Time range' })}
            options={rangeOptions}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.events.filters.tenantAriaLabel', { defaultValue: 'Tenant filter' })}>
          <LogsFilterSelect
            value={selectedTenantId}
            onValueChange={setSelectedTenantId}
            ariaLabel={t('logs.events.filters.tenantAriaLabel', { defaultValue: 'Tenant' })}
            options={tenantOptions}
            className="min-w-[280px]"
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.events.filters.categoryAriaLabel', { defaultValue: 'Category filter' })}>
          <LogsFilterSelect
            value={eventCategory}
            onValueChange={(value) => setEventCategory(value as SystemEventCategory | 'all')}
            ariaLabel={t('logs.events.filters.categoryAriaLabel', { defaultValue: 'Category' })}
            options={eventCategoryOptions}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.events.filters.severityAriaLabel', { defaultValue: 'Severity filter' })}>
          <LogsFilterSelect
            value={eventSeverity}
            onValueChange={(value) => setEventSeverity(value as SystemEventSeverity | 'all')}
            ariaLabel={t('logs.events.filters.severityAriaLabel', { defaultValue: 'Severity' })}
            options={eventSeverityOptions}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.events.filters.accountAriaLabel', { defaultValue: 'Account filter' })}>
          <LogsFilterInput
            value={eventAccountId}
            onValueChange={setEventAccountId}
            aria-label={t('logs.events.filters.accountAriaLabel', { defaultValue: 'Account ID' })}
            placeholder={t('logs.events.filters.accountPlaceholder', { defaultValue: 'Account ID' })}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.events.filters.requestIdAriaLabel', { defaultValue: 'Request ID filter' })}>
          <LogsFilterInput
            value={eventRequestId}
            onValueChange={setEventRequestId}
            aria-label={t('logs.events.filters.requestIdAriaLabel', { defaultValue: 'Request ID' })}
            placeholder={t('logs.events.filters.requestIdPlaceholder', { defaultValue: 'Request ID' })}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.events.filters.jobIdAriaLabel', { defaultValue: 'Job ID filter' })}>
          <LogsFilterInput
            value={eventJobId}
            onValueChange={setEventJobId}
            aria-label={t('logs.events.filters.jobIdAriaLabel', { defaultValue: 'Job ID' })}
            placeholder={t('logs.events.filters.jobIdPlaceholder', { defaultValue: 'Job ID' })}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.events.filters.reasonCodeAriaLabel', { defaultValue: 'Reason code filter' })}>
          <LogsFilterInput
            value={eventReasonCode}
            onValueChange={setEventReasonCode}
            aria-label={t('logs.events.filters.reasonCodeAriaLabel', { defaultValue: 'Reason code' })}
            placeholder={t('logs.events.filters.reasonCodePlaceholder', { defaultValue: 'Reason code' })}
          />
        </LogsFilterField>
      </LogsFilterGrid>
      <LogsFilterGrid className="md:grid-cols-1">
        <LogsFilterField label={t('logs.events.filters.keywordAriaLabel', { defaultValue: 'Keyword filter' })}>
          <LogsFilterInput
            value={eventKeyword}
            onValueChange={setEventKeyword}
            aria-label={t('logs.events.filters.keywordAriaLabel', { defaultValue: 'Keyword' })}
            placeholder={t('logs.events.filters.keywordPlaceholder', {
              defaultValue: 'Keyword (event / message / request / account)',
            })}
          />
        </LogsFilterField>
      </LogsFilterGrid>
      <StandardDataTable
        columns={eventColumns}
        data={eventLedger?.items ?? []}
        density="compact"
        defaultPageSize={20}
        pageSizeOptions={[20, 50, 100]}
        className={tableSurfaceClassName}
        emptyText={t('logs.events.empty', {
          defaultValue: 'No unified event data available yet. The new stream only shows events created after rollout.',
        })}
      />
      <Dialog
        open={Boolean(selectedEventId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEventId(null)
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {t('logs.events.detail.title', { defaultValue: 'Event detail' })}
            </DialogTitle>
            <DialogDescription>
              {selectedEvent
                ? t('logs.events.detail.description', {
                    defaultValue: '{{eventType}} · {{category}}',
                    eventType: selectedEvent.event_type,
                    category: localizeSystemEventCategory(selectedEvent.category, t),
                  })
                : t('logs.events.detail.loading', { defaultValue: 'Loading event detail…' })}
            </DialogDescription>
          </DialogHeader>
          <LoadingOverlay
            show={selectedEventDetailLoading || selectedEventCorrelationLoading}
            title={t('logs.events.detail.title', { defaultValue: 'Event detail' })}
            description={t('logs.events.detail.loading', { defaultValue: 'Loading event detail…' })}
            size="compact"
          />
          {selectedEvent ? (
            <div className="space-y-6">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {[
                  ['eventId', selectedEvent.id],
                  ['requestId', selectedEvent.request_id],
                  ['traceRequestId', selectedEvent.trace_request_id],
                  ['accountId', selectedEvent.account_id],
                  ['accountLabel', selectedEvent.account_label],
                  ['jobId', selectedEvent.job_id],
                  ['path', selectedEvent.path],
                  ['method', selectedEvent.method],
                  ['model', selectedEvent.model],
                  ['statusCode', selectedEvent.status_code != null ? String(selectedEvent.status_code) : undefined],
                  ['upstreamStatusCode', selectedEvent.upstream_status_code != null ? String(selectedEvent.upstream_status_code) : undefined],
                  ['latency', selectedEvent.latency_ms != null ? `${selectedEvent.latency_ms} ms` : undefined],
                  ['selectedAccountId', selectedEvent.selected_account_id],
                  ['selectedProxyId', selectedEvent.selected_proxy_id],
                  ['routingDecision', selectedEvent.routing_decision],
                  ['failoverScope', selectedEvent.failover_scope],
                  ['nextActionAt', selectedEvent.next_action_at ? formatLocalLogDateTime(selectedEvent.next_action_at, locale) : undefined],
                  ['secretPreview', selectedEvent.secret_preview],
                ].map(([labelKey, value]) => (
                  <div key={labelKey} className="rounded-xl border border-border/70 bg-muted/[0.14] p-3">
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {t(`logs.events.detail.labels.${labelKey}`, { defaultValue: labelKey })}
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-foreground/90">
                      {value || '-'}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-4">
                  <div className="text-sm font-semibold">
                    {t('logs.events.detail.sections.message', { defaultValue: 'Message' })}
                  </div>
                  <div className="text-sm">{selectedEvent.message ?? '-'}</div>
                  <div className="rounded-lg bg-muted/50 p-3 font-mono text-xs text-muted-foreground">
                    {selectedEvent.preview_text ?? '-'}
                  </div>
                </div>
                <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-4">
                  <div className="text-sm font-semibold">
                    {t('logs.events.detail.sections.timeline', { defaultValue: 'Request timeline' })}
                  </div>
                  {selectedEventCorrelation?.items?.length ? (
                    <div className="space-y-2">
                      {selectedEventCorrelation.items.slice(0, 12).map((item) => (
                        <div key={item.id} className="rounded-lg border border-border/60 bg-muted/[0.12] p-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant={item.severity === 'error' ? 'destructive' : item.severity === 'warn' ? 'warning' : 'secondary'}>
                              {localizeSystemEventSeverity(item.severity, t)}
                            </Badge>
                            <span className="font-mono text-muted-foreground">
                              {formatLocalLogDateTime(item.ts, locale)}
                            </span>
                            <span className="font-mono">{item.event_type}</span>
                          </div>
                          <div className="mt-2 text-sm">{item.message ?? '-'}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {t('logs.events.detail.timelineEmpty', { defaultValue: 'No correlated request timeline available.' })}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-4">
                <div className="text-sm font-semibold">
                  {t('logs.events.detail.sections.payload', { defaultValue: 'Payload' })}
                </div>
                <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-xs text-muted-foreground">
                  {formatEventPayload(selectedEvent.payload_json) ?? '-'}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </PagePanel>
  )

  const requestLogsPanel = (
    <PagePanel className="space-y-5">
      <SectionHeader
        title={t('logs.request.title', { defaultValue: 'Request Logs' })}
        description={t('logs.request.description', {
          defaultValue: 'Scope: Raw Data Plane request events (status / latency / path / tenant / API key / request ID).',
        })}
      />
      <LogsFilterGrid className="md:grid-cols-2 xl:grid-cols-6">
        <LogsFilterField label={t('logs.request.filters.rangeAriaLabel', { defaultValue: 'Time range' })}>
          <LogsFilterSelect
            value={String(rangePreset)}
            onValueChange={(value) => setRangePreset(Number(value) as RangePreset)}
            ariaLabel={t('logs.request.filters.rangeAriaLabel', { defaultValue: 'Time range' })}
            options={rangeOptions}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.request.filters.tenantAriaLabel', { defaultValue: 'Tenant' })}>
          <LogsFilterSelect
            value={selectedTenantId}
            onValueChange={setSelectedTenantId}
            ariaLabel={t('logs.request.filters.tenantAriaLabel', { defaultValue: 'Tenant' })}
            options={tenantOptions}
            className="min-w-[280px]"
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.request.filters.apiKeyAriaLabel', { defaultValue: 'API key filter' })}>
          <LogsFilterInput
            value={apiKeyId}
            onValueChange={setApiKeyId}
            aria-label={t('logs.request.filters.apiKeyAriaLabel', { defaultValue: 'API key ID' })}
            placeholder={t('logs.request.filters.apiKeyIdPlaceholder', { defaultValue: 'API Key ID' })}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.request.filters.statusCodeAriaLabel', { defaultValue: 'Status code filter' })}>
          <LogsFilterInput
            value={statusCode}
            onValueChange={setStatusCode}
            type="number"
            min={0}
            inputMode="numeric"
            aria-label={t('logs.request.filters.statusCodeAriaLabel', { defaultValue: 'Status code' })}
            placeholder={t('logs.request.filters.statusCodePlaceholder', {
              defaultValue: 'Status code (e.g. 500)',
            })}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.request.filters.requestIdAriaLabel', { defaultValue: 'Request ID filter' })}>
          <LogsFilterInput
            value={requestId}
            onValueChange={setRequestId}
            aria-label={t('logs.request.filters.requestIdAriaLabel', { defaultValue: 'Request ID' })}
            placeholder={t('logs.request.filters.requestIdPlaceholder', { defaultValue: 'Request ID' })}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.request.filters.keywordAriaLabel', { defaultValue: 'Keyword filter' })}>
          <LogsFilterInput
            value={keyword}
            onValueChange={setKeyword}
            aria-label={t('logs.request.filters.keywordAriaLabel', { defaultValue: 'Keyword' })}
            placeholder={t('logs.request.filters.keywordPlaceholder', {
              defaultValue: 'Keyword (path / error / model)',
            })}
          />
        </LogsFilterField>
      </LogsFilterGrid>
      <StandardDataTable
        columns={requestColumns}
        data={requestLedger?.items ?? []}
        density="compact"
        defaultPageSize={20}
        pageSizeOptions={[20, 50, 100]}
        className={tableSurfaceClassName}
        emptyText={t('logs.request.empty', { defaultValue: 'No request log data available' })}
      />
    </PagePanel>
  )

  const auditColumns = useMemo<ColumnDef<AuditLogItem>[]>(
    () => [
      {
        id: 'createdAt',
        header: t('logs.audit.columns.createdAt', { defaultValue: 'Time' }),
        accessorFn: (row) => new Date(row.created_at).getTime(),
        cell: ({ row }) => (
          <span
            className="font-mono text-xs text-muted-foreground"
            title={buildLogTimeTooltip(t, locale, row.original.created_at)}
          >
            {formatLocalLogDateTime(row.original.created_at, locale)}
          </span>
        ),
      },
      {
        id: 'tenant',
        header: t('logs.audit.columns.tenant', { defaultValue: 'Tenant' }),
        accessorFn: (row) => (row.tenant_id ?? '').toLowerCase(),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.tenant_id ?? '-'}</span>,
      },
      {
        id: 'actor',
        header: t('logs.audit.columns.actor', { defaultValue: 'Actor' }),
        accessorFn: (row) =>
          `${localizeAuditActorType(row.actor_type, t)} ${row.actor_id ?? ''}`.toLowerCase(),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="text-xs" title={row.original.actor_type}>
              {localizeAuditActorType(row.original.actor_type, t)}
            </div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.actor_id ?? '-'}</div>
          </div>
        ),
      },
      {
        id: 'action',
        header: t('logs.audit.columns.action', { defaultValue: 'Action' }),
        accessorFn: (row) => localizeAuditAction(row.action, t).toLowerCase(),
        cell: ({ row }) => (
          <span className="text-xs" title={row.original.action}>
            {localizeAuditAction(row.original.action, t)}
          </span>
        ),
      },
      {
        id: 'result',
        header: t('logs.audit.columns.result', { defaultValue: 'Result' }),
        accessorFn: (row) => normalizeAuditValue(row.result_status),
        cell: ({ row }) => (
          <span
            className={
              normalizeAuditValue(row.original.result_status) === 'ok'
                ? 'font-mono text-success-foreground'
                : 'font-mono text-destructive'
            }
            title={row.original.result_status}
          >
            {localizeAuditResultStatus(row.original.result_status, t)}
          </span>
        ),
      },
      {
        id: 'target',
        header: t('logs.audit.columns.target', { defaultValue: 'Target' }),
        accessorFn: (row) => `${row.target_type ?? ''} ${row.target_id ?? ''}`.toLowerCase(),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="text-xs">{row.original.target_type ?? '-'}</div>
            <div className="font-mono text-xs text-muted-foreground">{row.original.target_id ?? '-'}</div>
          </div>
        ),
      },
      {
        id: 'reason',
        header: t('logs.audit.columns.reason', { defaultValue: 'Reason' }),
        accessorFn: (row) => `${row.reason ?? ''} ${JSON.stringify(row.payload_json)}`.toLowerCase(),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="text-xs">{row.original.reason ?? '-'}</div>
            <div className="max-w-[360px] truncate font-mono text-xs text-muted-foreground">
              {JSON.stringify(row.original.payload_json)}
            </div>
          </div>
        ),
      },
    ],
    [t, locale],
  )

  const auditLogsPanel = (
    <PagePanel className="space-y-5">
      <SectionHeader
        title={t('logs.audit.title', { defaultValue: 'Audit Logs' })}
        description={t('logs.audit.description', {
          defaultValue: 'Scope: Control Plane audit events (role / action / result / target / payload).',
        })}
      />
      <LogsFilterGrid className="md:grid-cols-2 xl:grid-cols-7">
        <LogsFilterField label={t('logs.audit.filters.rangeAriaLabel', { defaultValue: 'Time range' })}>
          <LogsFilterSelect
            value={String(rangePreset)}
            onValueChange={(value) => setRangePreset(Number(value) as RangePreset)}
            ariaLabel={t('logs.audit.filters.rangeAriaLabel', { defaultValue: 'Time range' })}
            options={rangeOptions}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.audit.filters.tenantAriaLabel', { defaultValue: 'Tenant filter' })}>
          <LogsFilterSelect
            value={selectedTenantId}
            onValueChange={setSelectedTenantId}
            ariaLabel={t('logs.audit.filters.tenantAriaLabel', { defaultValue: 'Tenant' })}
            options={tenantOptions}
            className="min-w-[280px]"
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.audit.filters.actorTypeAriaLabel', { defaultValue: 'Actor type filter' })}>
          <LogsFilterInput
            value={auditActorType}
            onValueChange={setAuditActorType}
            aria-label={t('logs.audit.filters.actorTypeAriaLabel', { defaultValue: 'Actor type' })}
            placeholder={t('logs.audit.filters.actorTypePlaceholder', { defaultValue: 'Actor type' })}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.audit.filters.actorIdAriaLabel', { defaultValue: 'Actor ID filter' })}>
          <LogsFilterInput
            value={auditActorId}
            onValueChange={setAuditActorId}
            aria-label={t('logs.audit.filters.actorIdAriaLabel', { defaultValue: 'Actor ID' })}
            placeholder={t('logs.audit.filters.actorIdPlaceholder', { defaultValue: 'Actor ID' })}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.audit.filters.actionAriaLabel', { defaultValue: 'Action filter' })}>
          <LogsFilterInput
            value={auditAction}
            onValueChange={setAuditAction}
            aria-label={t('logs.audit.filters.actionAriaLabel', { defaultValue: 'Action' })}
            placeholder={t('logs.audit.filters.actionPlaceholder', { defaultValue: 'Action' })}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.audit.filters.resultStatusAriaLabel', { defaultValue: 'Result status filter' })}>
          <LogsFilterInput
            value={auditResultStatus}
            onValueChange={setAuditResultStatus}
            aria-label={t('logs.audit.filters.resultStatusAriaLabel', { defaultValue: 'Result status' })}
            placeholder={t('logs.audit.filters.resultStatusPlaceholder', { defaultValue: 'Result status' })}
          />
        </LogsFilterField>
        <LogsFilterField label={t('logs.audit.filters.keywordAriaLabel', { defaultValue: 'Keyword filter' })}>
          <LogsFilterInput
            value={auditKeyword}
            onValueChange={setAuditKeyword}
            aria-label={t('logs.audit.filters.keywordAriaLabel', { defaultValue: 'Keyword' })}
            placeholder={t('logs.audit.filters.keywordPlaceholder', {
              defaultValue: 'Keyword (reason / payload)',
            })}
          />
        </LogsFilterField>
      </LogsFilterGrid>
      <StandardDataTable
        columns={auditColumns}
        data={auditLogs?.items ?? []}
        density="compact"
        defaultPageSize={20}
        pageSizeOptions={[20, 50, 100]}
        className={tableSurfaceClassName}
        emptyText={t('logs.audit.empty', { defaultValue: 'No audit log data available' })}
      />
    </PagePanel>
  )

  const systemLogsPanel = (
    <PagePanel className="relative space-y-5">
      <LoadingOverlay
        show={isLoading}
        title={t('common.loading')}
        description={t('logs.subtitle')}
      />
      <SectionHeader
        title={t('logs.tabs.system', { defaultValue: 'System Logs' })}
        description={t('logs.subtitle')}
      />
      <LogsFilterGrid className="md:max-w-[16rem]">
        <LogsFilterField label={t('logs.columns.level', { defaultValue: 'Level' })}>
          <LogsFilterSelect
            value={levelFilter}
            onValueChange={(value) => setLevelFilter(value as LogLevelFilter)}
            ariaLabel={t('logs.columns.level', { defaultValue: 'Level' })}
            options={levelOptions}
          />
        </LogsFilterField>
      </LogsFilterGrid>
      <StandardDataTable
        columns={columns}
        data={filteredLogs}
        density="compact"
        className={tableSurfaceClassName}
        searchPlaceholder={t('logs.search')}
        searchFn={(row, keyword) => {
          const localizedAction = localizeLogAction(row.action, t).toLowerCase()
          const localizedMessage = localizeLogMessage(row.action, row.message || '', t).toLowerCase()
          const rawAction = row.action.toLowerCase()
          const rawMessage = (row.message || '').toLowerCase()
          const level = levelLabel(row.level, t).toLowerCase()
          return (
            localizedAction.includes(keyword) ||
            localizedMessage.includes(keyword) ||
            rawAction.includes(keyword) ||
            rawMessage.includes(keyword) ||
            level.includes(keyword)
          )
        }}
        emptyText={t('logs.waiting')}
      />
    </PagePanel>
  )

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8">
      <div className="space-y-6 md:space-y-8">
        <PageIntro
          archetype="workspace"
          title={t('logs.title')}
          description={t('logs.subtitle')}
          meta={t('logs.time.displayMode', {
            defaultValue: 'Displayed in local time ({{timezone}}). UTC is preserved in tooltips and exports.',
            timezone: currentTimeZone,
          })}
        />

        <PagePanel tone="secondary">
          <div
            className={cn(
              'flex flex-col gap-4',
              logsLayout.desktopToolbarAlignment === 'between' && 'lg:flex-row lg:items-center lg:justify-between',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={tab === 'events' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTab('events')}
              >
                {t('logs.tabs.events', { defaultValue: 'Event Stream' })}
              </Button>
              <Button
                variant={tab === 'request' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTab('request')}
              >
                {t('logs.tabs.request', { defaultValue: 'Request Logs' })}
              </Button>
              <Button
                variant={tab === 'system' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTab('system')}
              >
                {t('logs.tabs.system', { defaultValue: 'System Logs' })}
              </Button>
              <Button
                variant={tab === 'audit' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTab('audit')}
              >
                {t('logs.tabs.audit', { defaultValue: 'Audit Logs' })}
              </Button>
            </div>
            {tab === 'system' ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={handleExport}>
                  <Download className="mr-2 h-4 w-4" />
                  {t('logs.export')}
                </Button>
              </div>
            ) : null}
          </div>
        </PagePanel>

        {tab === 'events'
          ? eventsPanel
          : tab === 'request'
          ? requestLogsPanel
          : tab === 'audit'
            ? auditLogsPanel
            : systemLogsPanel}
      </div>
    </div>
  )
}
