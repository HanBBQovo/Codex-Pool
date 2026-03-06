import { useCallback, useMemo, useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  ActivitySquare,
  CircleAlert,
  Copy,
  ExternalLink,
  RotateCw,
  SquarePen,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  modelsApi,
  type AdminModelOfficialInfo,
  type ModelSchema,
} from '@/api/models'
import { localizeApiErrorDisplay } from '@/api/errorI18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { LoadingOverlay } from '@/components/ui/loading-overlay'
import { StandardDataTable } from '@/components/ui/standard-data-table'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { POOL_SECTION_CLASS_NAME } from '@/lib/pool-styles'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/time'

function formatMicrocredits(value?: number | null) {
  if (typeof value !== 'number') return '-'
  return (value / 1_000_000).toFixed(4)
}

function pricingSourceLabel(
  source: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (source === 'manual_override') {
    return t('models.pricing.sourceLabels.manualOverride', { defaultValue: 'Manual override' })
  }
  if (source === 'official_sync') {
    return t('models.pricing.sourceLabels.officialSync', { defaultValue: 'OpenAI official' })
  }
  return t('models.pricing.sourceLabels.unknown', { defaultValue: 'Unknown' })
}

function pricingSourceVariant(source: string): 'success' | 'info' | 'secondary' {
  if (source === 'manual_override') return 'success'
  if (source === 'official_sync') return 'info'
  return 'secondary'
}


function effectivePricingOrFallback(model: Pick<ModelSchema, 'effective_pricing' | 'official'> | null | undefined) {
  if (model?.effective_pricing) {
    return model.effective_pricing
  }
  return {
    source: 'official_sync',
    input_price_microcredits: model?.official?.input_price_microcredits ?? null,
    cached_input_price_microcredits: model?.official?.cached_input_price_microcredits ?? null,
    output_price_microcredits: model?.official?.output_price_microcredits ?? null,
  }
}

function contextText(official?: AdminModelOfficialInfo | null) {
  const context = typeof official?.context_window_tokens === 'number'
    ? official.context_window_tokens.toLocaleString()
    : '-'
  const maxOutput = typeof official?.max_output_tokens === 'number'
    ? official.max_output_tokens.toLocaleString()
    : '-'
  return `${context} / ${maxOutput}`
}

function modalitiesText(official?: AdminModelOfficialInfo | null) {
  const input =
    official?.input_modalities && official.input_modalities.length > 0
      ? official.input_modalities.join(', ')
      : '-'
  const output =
    official?.output_modalities && official.output_modalities.length > 0
      ? official.output_modalities.join(', ')
      : '-'
  return `in: ${input} · out: ${output}`
}

function matchesModelSearch(model: ModelSchema, keyword: string) {
  return [
    model.id,
    model.owned_by,
    model.official?.title ?? '',
    model.official?.description ?? '',
    model.official?.knowledge_cutoff ?? '',
    model.official?.input_modalities?.join(',') ?? '',
    model.official?.output_modalities?.join(',') ?? '',
    model.official?.endpoints?.join(',') ?? '',
    effectivePricingOrFallback(model).source,
    String(effectivePricingOrFallback(model).input_price_microcredits ?? ''),
    String(effectivePricingOrFallback(model).cached_input_price_microcredits ?? ''),
    String(effectivePricingOrFallback(model).output_price_microcredits ?? ''),
  ]
    .join(' ')
    .toLowerCase()
    .includes(keyword)
}

function availabilityBadgeVariant(
  status: ModelSchema['availability_status'],
): 'success' | 'destructive' | 'secondary' {
  if (status === 'available') return 'success'
  if (status === 'unavailable') return 'destructive'
  return 'secondary'
}

function availabilityLabel(
  status: ModelSchema['availability_status'],
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (status === 'available') return t('models.availability.available')
  if (status === 'unavailable') return t('models.availability.unavailable')
  return t('models.availability.unknown')
}

function availabilityIssueText(
  model: ModelSchema,
  t: ReturnType<typeof useTranslation>['t'],
) {
  const parts: string[] = []
  if (model.availability_http_status) {
    parts.push(`HTTP ${model.availability_http_status}`)
  }
  const error = (model.availability_error ?? '').trim()
  if (error) {
    parts.push(error)
  }
  if (parts.length === 0) {
    return t('models.availability.noErrorDetail')
  }
  return parts.join(' · ')
}

export default function Models() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelSchema | null>(null)
  const [pricingForm, setPricingForm] = useState({
    input_price_microcredits: '0',
    cached_input_price_microcredits: '0',
    output_price_microcredits: '0',
    enabled: true,
  })

  const resolveErrorLabel = useCallback(
    (err: unknown, fallback: string) => localizeApiErrorDisplay(t, err, fallback).label,
    [t],
  )

  const { data: modelsPayload, isLoading, isFetching } = useQuery({
    queryKey: ['models'],
    queryFn: modelsApi.listModels,
    staleTime: 60000,
  })

  const syncCatalogMutation = useMutation({
    mutationFn: () => modelsApi.syncOpenAiCatalog(),
    onSuccess: (payload) => {
      setError(null)
      setNotice(
        t('models.notice.openAiCatalogSynced', {
          defaultValue: 'OpenAI catalog synced: {{count}} models updated.',
          count: payload.created_or_updated,
        }),
      )
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
    onError: (err) => {
      setError(
        resolveErrorLabel(
          err,
          t('models.errors.openAiCatalogSyncFailed', {
            defaultValue: 'Failed to sync OpenAI catalog.',
          }),
        ),
      )
    },
  })

  const probeMutation = useMutation({
    mutationFn: () => modelsApi.probeModels({ force: true }),
    onSuccess: () => {
      setError(null)
      setNotice(
        t('models.notice.probeCompleted', {
          defaultValue: 'Model probing completed. Availability has been refreshed.',
        }),
      )
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
    onError: (err) => {
      setError(
        resolveErrorLabel(
          err,
          t('models.errors.probeFailed', { defaultValue: 'Model probing failed.' }),
        ),
      )
    },
  })

  const upsertPricingMutation = useMutation({
    mutationFn: async () =>
      modelsApi.upsertModelPricing({
        model: editingModel?.id ?? '',
        input_price_microcredits: Number(pricingForm.input_price_microcredits),
        cached_input_price_microcredits: Number(pricingForm.cached_input_price_microcredits),
        output_price_microcredits: Number(pricingForm.output_price_microcredits),
        enabled: pricingForm.enabled,
      }),
    onSuccess: (item) => {
      setError(null)
      setNotice(
        t('models.notice.modelPricingSaved', {
          defaultValue: 'Model pricing saved: {{model}}',
          model: item.model,
        }),
      )
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
    onError: (err) => {
      setError(
        resolveErrorLabel(
          err,
          t('models.errors.saveModelPricingFailed', { defaultValue: 'Failed to save model pricing.' }),
        ),
      )
    },
  })

  const deletePricingMutation = useMutation({
    mutationFn: async (pricingId: string) => modelsApi.deleteModelPricing(pricingId),
    onSuccess: () => {
      setError(null)
      setNotice(t('models.notice.modelPricingDeleted', { defaultValue: 'Model pricing record deleted.' }))
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
    onError: (err) => {
      setError(
        resolveErrorLabel(
          err,
          t('models.errors.deleteModelPricingFailed', { defaultValue: 'Failed to delete model pricing.' }),
        ),
      )
    },
  })

  const models = useMemo(() => modelsPayload?.data ?? [], [modelsPayload])
  const modelsMeta = modelsPayload?.meta
  const isBusy =
    isLoading ||
    isFetching ||
    syncCatalogMutation.isPending ||
    probeMutation.isPending

  const openEditor = useCallback((model: ModelSchema) => {
    setEditingModel(model)
    setPricingForm({
      input_price_microcredits: String(
        model.override_pricing?.input_price_microcredits ??
          effectivePricingOrFallback(model).input_price_microcredits ??
          0,
      ),
      cached_input_price_microcredits: String(
        model.override_pricing?.cached_input_price_microcredits ??
          effectivePricingOrFallback(model).cached_input_price_microcredits ??
          0,
      ),
      output_price_microcredits: String(
        model.override_pricing?.output_price_microcredits ??
          effectivePricingOrFallback(model).output_price_microcredits ??
          0,
      ),
      enabled: model.override_pricing?.enabled ?? true,
    })
    setEditorOpen(true)
  }, [])

  const copyText = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
  }, [])

  const columns = useMemo<ColumnDef<ModelSchema>[]>(
    () => [
      {
        accessorKey: 'id',
        header: t('models.columns.id'),
        cell: ({ row }) => (
          <div className="group flex min-w-[220px] items-center gap-1">
            <span className="min-w-0 truncate font-mono text-sm font-medium" title={row.original.id}>
              {row.original.id}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                void copyText(row.original.id)
              }}
              title={t('models.actions.copyModelId', { defaultValue: 'Copy model ID' })}
              aria-label={t('models.actions.copyModelId', { defaultValue: 'Copy model ID' })}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        ),
      },
      {
        id: 'availability',
        header: t('models.columns.availability'),
        accessorFn: (row) => row.availability_status,
        cell: ({ row }) => {
          const hasIssue = row.original.availability_status === 'unavailable' || Boolean(row.original.availability_error)
          const issueText = availabilityIssueText(row.original, t)
          return (
            <div className="flex items-center gap-1.5">
              <Badge variant={availabilityBadgeVariant(row.original.availability_status)}>
                {availabilityLabel(row.original.availability_status, t)}
              </Badge>
              {hasIssue ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-warning-foreground transition-colors hover:bg-warning-muted"
                      aria-label={t('models.availability.issueHint')}
                    >
                      <CircleAlert className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[360px] whitespace-pre-wrap break-words">
                    {issueText}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          )
        },
      },
      {
        id: 'context',
        header: t('models.columns.context', { defaultValue: 'Context / Max output' }),
        accessorFn: (row) => contextText(row.official),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {contextText(row.original.official ?? null)}
          </span>
        ),
      },
      {
        id: 'pricing',
        header: t('models.columns.pricingStatus'),
        accessorFn: (row) =>
          [
            effectivePricingOrFallback(row).source,
            effectivePricingOrFallback(row).input_price_microcredits,
            effectivePricingOrFallback(row).cached_input_price_microcredits,
            effectivePricingOrFallback(row).output_price_microcredits,
          ].join(' '),
        cell: ({ row }) => (
          <div className="space-y-1 text-xs">
            <Badge variant={pricingSourceVariant(effectivePricingOrFallback(row.original).source)}>
              {pricingSourceLabel(effectivePricingOrFallback(row.original).source, t)}
            </Badge>
            <div className="font-mono text-muted-foreground">
              in {formatMicrocredits(effectivePricingOrFallback(row.original).input_price_microcredits)} · cached{' '}
              {formatMicrocredits(effectivePricingOrFallback(row.original).cached_input_price_microcredits)} · out{' '}
              {formatMicrocredits(effectivePricingOrFallback(row.original).output_price_microcredits)}
            </div>
          </div>
        ),
      },
      {
        id: 'modalities',
        header: t('models.columns.modalities', { defaultValue: 'Modalities' }),
        accessorFn: (row) => modalitiesText(row.official ?? null),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {modalitiesText(row.original.official ?? null)}
          </span>
        ),
      },
      {
        id: 'syncedAt',
        header: t('models.columns.syncedAt', { defaultValue: 'Synced' }),
        accessorFn: (row) => row.official?.synced_at ?? '',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.official?.synced_at
              ? formatRelativeTime(
                  new Date(row.original.official.synced_at).getTime(),
                  i18n.resolvedLanguage,
                  true,
                )
              : '-'}
          </span>
        ),
      },
      {
        id: 'actions',
        enableSorting: false,
        header: t('models.columns.actions', { defaultValue: 'Actions' }),
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" className="group" onClick={() => openEditor(row.original)}>
            {t('models.actions.openDetails', { defaultValue: 'Details' })}
            <SquarePen className="ml-1 h-3.5 w-3.5" />
          </Button>
        ),
      },
    ],
    [copyText, i18n.resolvedLanguage, openEditor, t],
  )

  const catalogSyncText = !modelsMeta?.catalog_synced_at
    ? t('models.syncHint.notSynced', {
        defaultValue: 'OpenAI catalog has not been synced yet.',
      })
    : t('models.syncHint.syncedAt', {
        defaultValue: 'Catalog synced {{time}}',
        time: formatRelativeTime(
          new Date(modelsMeta.catalog_synced_at).getTime(),
          i18n.resolvedLanguage,
          true,
        ),
      })

  const currentModel = editingModel
  const currentOfficial = currentModel?.official
  const canDeleteOverride = Boolean(currentModel?.override_pricing?.id)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex h-full flex-col overflow-hidden p-8"
    >
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            {t('models.title', { defaultValue: 'Models' })}
          </h2>
          <p className="mt-1 text-muted-foreground">
            {t('models.description', {
              defaultValue: 'Browse the OpenAI official catalog, verify model availability, and manage manual pricing overrides.',
            })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{catalogSyncText}</p>
          {modelsMeta?.catalog_last_error ? (
            <p className="mt-1 break-all text-xs text-warning-foreground">{modelsMeta.catalog_last_error}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => syncCatalogMutation.mutate()}
            disabled={syncCatalogMutation.isPending}
          >
            <RotateCw className={cn('mr-2 h-4 w-4', syncCatalogMutation.isPending && 'animate-spin')} />
            {t('models.actions.syncOpenAiCatalog', { defaultValue: 'Sync OpenAI catalog' })}
          </Button>
          <Button
            variant="outline"
            onClick={() => probeMutation.mutate()}
            disabled={probeMutation.isPending || modelsMeta?.catalog_sync_required}
          >
            <ActivitySquare className={cn('mr-2 h-4 w-4', probeMutation.isPending && 'animate-pulse')} />
            {t('models.actions.probeAvailability', { defaultValue: 'Probe availability' })}
          </Button>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-success-foreground">{notice}</p> : null}

      <div className="relative min-h-0 flex-1">
        <LoadingOverlay
          show={isBusy}
          title={t('models.syncing')}
          description={t('models.loadingHint', {
            defaultValue: 'Refreshing official catalog and model availability…',
          })}
        />

        <TooltipProvider>
          <StandardDataTable
            columns={columns}
            data={models}
            searchPlaceholder={t('models.actions.search')}
            searchFn={matchesModelSearch}
            emptyText={
              modelsMeta?.catalog_sync_required
                ? t('models.emptySyncRequired', {
                    defaultValue: 'No official catalog yet. Sync OpenAI catalog first.',
                  })
                : t('models.empty')
            }
            actions={
              modelsMeta?.catalog_sync_required ? (
                <Button size="sm" onClick={() => syncCatalogMutation.mutate()}>
                  <RotateCw className="mr-2 h-4 w-4" />
                  {t('models.actions.syncOpenAiCatalog', { defaultValue: 'Sync OpenAI catalog' })}
                </Button>
              ) : undefined
            }
          />
        </TooltipProvider>
      </div>

      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) {
            setEditingModel(null)
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {currentModel
                ? t('models.dialog.titleWithId', {
                    defaultValue: 'Model details · {{modelId}}',
                    modelId: currentModel.id,
                  })
                : t('models.title', { defaultValue: 'Models' })}
            </DialogTitle>
            <DialogDescription>
              {t('models.dialog.officialDescription', {
                defaultValue:
                  'Official OpenAI model metadata is read-only here. Manual override pricing can be edited below.',
              })}
            </DialogDescription>
          </DialogHeader>

          {currentModel ? (
            <div className="space-y-4">
              <section className={POOL_SECTION_CLASS_NAME}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="info">{currentModel.owned_by}</Badge>
                  <Badge variant={availabilityBadgeVariant(currentModel.availability_status)}>
                    {availabilityLabel(currentModel.availability_status, t)}
                  </Badge>
                  <Badge variant={pricingSourceVariant(effectivePricingOrFallback(currentModel).source)}>
                    {pricingSourceLabel(effectivePricingOrFallback(currentModel).source, t)}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <h3 className="text-base font-medium">
                      {t('models.detail.officialTitle', { defaultValue: 'Official metadata' })}
                    </h3>
                    <p className="text-sm text-muted-foreground">{currentOfficial?.title}</p>
                    {currentOfficial?.description ? (
                      <p className="text-sm text-muted-foreground">{currentOfficial?.description}</p>
                    ) : null}
                    <div className="space-y-1 text-sm">
                      <div>
                        <span className="font-medium">{t('models.detail.contextWindow', { defaultValue: 'Context window' })}:</span>{' '}
                        <span className="font-mono">{currentOfficial?.context_window_tokens?.toLocaleString() ?? '-'}</span>
                      </div>
                      <div>
                        <span className="font-medium">{t('models.detail.maxOutputTokens', { defaultValue: 'Max output tokens' })}:</span>{' '}
                        <span className="font-mono">{currentOfficial?.max_output_tokens?.toLocaleString() ?? '-'}</span>
                      </div>
                      <div>
                        <span className="font-medium">{t('models.detail.knowledgeCutoff', { defaultValue: 'Knowledge cutoff' })}:</span>{' '}
                        <span>{currentOfficial?.knowledge_cutoff ?? '-'}</span>
                      </div>
                      <div>
                        <span className="font-medium">{t('models.detail.reasoningTokenSupport', { defaultValue: 'Reasoning token support' })}:</span>{' '}
                        <span>
                          {typeof currentOfficial?.reasoning_token_support === 'boolean'
                            ? currentOfficial?.reasoning_token_support
                              ? t('models.pricing.enabled', { defaultValue: 'Enabled' })
                              : t('models.pricing.disabled', { defaultValue: 'Disabled' })
                            : '-'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{t('models.detail.sourceUrl', { defaultValue: 'Source URL' })}:</span>
                        <a
                          className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
                          href={currentOfficial?.source_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('models.detail.openOfficialPage', { defaultValue: 'Open official page' })}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-base font-medium">
                      {t('models.detail.capabilitiesTitle', { defaultValue: 'Capabilities' })}
                    </h3>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">{t('models.detail.inputModalities', { defaultValue: 'Input modalities' })}:</span>{' '}
                        {currentOfficial?.input_modalities && currentOfficial.input_modalities.length > 0
                          ? currentOfficial.input_modalities.join(', ')
                          : '-'}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">{t('models.detail.outputModalities', { defaultValue: 'Output modalities' })}:</span>{' '}
                        {currentOfficial?.output_modalities && currentOfficial.output_modalities.length > 0
                          ? currentOfficial.output_modalities.join(', ')
                          : '-'}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">{t('models.detail.endpoints', { defaultValue: 'Endpoints' })}:</span>{' '}
                        {currentOfficial?.endpoints && currentOfficial.endpoints.length > 0
                          ? currentOfficial.endpoints.join(', ')
                          : '-'}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">{t('models.columns.syncedAt', { defaultValue: 'Synced' })}:</span>{' '}
                        {currentOfficial?.synced_at
                          ? formatRelativeTime(
                              new Date(currentOfficial.synced_at).getTime(),
                              i18n.resolvedLanguage,
                              true,
                            )
                          : '-'}
                      </div>
                    </div>
                    {currentOfficial?.pricing_notes ? (
                      <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
                        {currentOfficial?.pricing_notes}
                      </div>
                    ) : null}
                  </div>
                </div>

                {currentOfficial?.raw_text ? (
                  <div className="space-y-1">
                    <h4 className="text-sm font-medium">
                      {t('models.detail.rawText', { defaultValue: 'Official text snapshot' })}
                    </h4>
                    <Textarea
                      readOnly
                      value={currentOfficial?.raw_text}
                      className="min-h-[180px] font-mono text-xs"
                    />
                  </div>
                ) : null}
              </section>

              <section className={POOL_SECTION_CLASS_NAME}>
                <h3 className="text-base font-medium">
                  {t('models.pricing.overrideSectionTitle', { defaultValue: 'Manual price override' })}
                </h3>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-md border border-border/70 p-3 text-sm">
                    <div className="mb-1 font-medium">
                      {t('models.pricing.officialBase', { defaultValue: 'Official base' })}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      in {formatMicrocredits(currentOfficial?.input_price_microcredits)} · cached{' '}
                      {formatMicrocredits(currentOfficial?.cached_input_price_microcredits)} · out{' '}
                      {formatMicrocredits(currentOfficial?.output_price_microcredits)}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/70 p-3 text-sm">
                    <div className="mb-1 font-medium">
                      {t('models.pricing.manualOverride', { defaultValue: 'Manual override' })}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      in {formatMicrocredits(currentModel.override_pricing?.input_price_microcredits)} · cached{' '}
                      {formatMicrocredits(currentModel.override_pricing?.cached_input_price_microcredits)} · out{' '}
                      {formatMicrocredits(currentModel.override_pricing?.output_price_microcredits)}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/70 p-3 text-sm">
                    <div className="mb-1 font-medium">
                      {t('models.pricing.effectiveSectionTitle', { defaultValue: 'Effective pricing' })}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      in {formatMicrocredits(effectivePricingOrFallback(currentModel).input_price_microcredits)} · cached{' '}
                      {formatMicrocredits(effectivePricingOrFallback(currentModel).cached_input_price_microcredits)} · out{' '}
                      {formatMicrocredits(effectivePricingOrFallback(currentModel).output_price_microcredits)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="space-y-1.5">
                    <label htmlFor="model-pricing-input" className="text-xs font-medium text-muted-foreground">
                      {t('models.pricing.inputPrice', { defaultValue: 'Input price' })}
                    </label>
                    <Input
                      id="model-pricing-input"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={pricingForm.input_price_microcredits}
                      onChange={(event) =>
                        setPricingForm((prev) => ({ ...prev, input_price_microcredits: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="model-pricing-cached" className="text-xs font-medium text-muted-foreground">
                      {t('models.pricing.cachedInputPrice', { defaultValue: 'Cached input price' })}
                    </label>
                    <Input
                      id="model-pricing-cached"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={pricingForm.cached_input_price_microcredits}
                      onChange={(event) =>
                        setPricingForm((prev) => ({
                          ...prev,
                          cached_input_price_microcredits: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="model-pricing-output" className="text-xs font-medium text-muted-foreground">
                      {t('models.pricing.outputPrice', { defaultValue: 'Output price' })}
                    </label>
                    <Input
                      id="model-pricing-output"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={pricingForm.output_price_microcredits}
                      onChange={(event) =>
                        setPricingForm((prev) => ({ ...prev, output_price_microcredits: event.target.value }))
                      }
                    />
                  </div>
                  <label htmlFor="model-pricing-enabled" className="flex items-center gap-2 text-sm text-muted-foreground md:pt-7">
                    <Checkbox
                      id="model-pricing-enabled"
                      checked={pricingForm.enabled}
                      onCheckedChange={(checked) =>
                        setPricingForm((prev) => ({ ...prev, enabled: Boolean(checked) }))
                      }
                    />
                    {t('models.pricing.enablePricing', { defaultValue: 'Enable override' })}
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => upsertPricingMutation.mutate()}
                    disabled={upsertPricingMutation.isPending}
                  >
                    {upsertPricingMutation.isPending ? (
                      <RotateCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {t('models.actions.savePricing', { defaultValue: 'Save pricing' })}
                  </Button>

                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (!currentModel.override_pricing?.id) return
                      deletePricingMutation.mutate(currentModel.override_pricing.id)
                    }}
                    disabled={!canDeleteOverride || deletePricingMutation.isPending}
                  >
                    {deletePricingMutation.isPending ? (
                      <RotateCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    {t('models.actions.deletePricing', { defaultValue: 'Delete pricing' })}
                  </Button>
                </div>
              </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
