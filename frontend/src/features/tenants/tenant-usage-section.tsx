import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { localizeApiErrorDisplay } from '@/api/errorI18n'
import { type ApiKey } from '@/api/settings'
import type { UsageSummaryQueryResponse } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatExactCount } from '@/lib/count-number-format'
import { POOL_ELEVATED_SECTION_CLASS_NAME, POOL_METRIC_CARD_CLASS_NAME } from '@/lib/pool-styles'
import { cn } from '@/lib/utils'

type TenantUsageSectionProps = {
  tenantId: string
  labelClassName: string
  keysForCurrentTenant: ApiKey[]
  filteredUsageApiKeys: ApiKey[]
  effectiveUsageApiKeyFilter: string
  selectedUsageApiKey: ApiKey | null
  usageApiKeyFilterAllValue: string
  usageApiKeyPopoverOpen: boolean
  setUsageApiKeyPopoverOpen: (open: boolean) => void
  usageApiKeyKeyword: string
  setUsageApiKeyKeyword: (value: string) => void
  setUsageApiKeyFilter: (value: string) => void
  usageSummaryQuery: {
    isFetching: boolean
    isError: boolean
    error: unknown
    data?: UsageSummaryQueryResponse
  }
}

export function TenantUsageSection({
  tenantId,
  labelClassName,
  keysForCurrentTenant,
  filteredUsageApiKeys,
  effectiveUsageApiKeyFilter,
  selectedUsageApiKey,
  usageApiKeyFilterAllValue,
  usageApiKeyPopoverOpen,
  setUsageApiKeyPopoverOpen,
  usageApiKeyKeyword,
  setUsageApiKeyKeyword,
  setUsageApiKeyFilter,
  usageSummaryQuery,
}: TenantUsageSectionProps) {
  const { t } = useTranslation()

  const usageSummaryErrorDisplay = usageSummaryQuery.isError
    ? localizeApiErrorDisplay(
        t,
        usageSummaryQuery.error,
        t('tenants.usage.status.error', { defaultValue: 'Failed to load usage data' }),
      )
    : null

  return (
    <section className={POOL_ELEVATED_SECTION_CLASS_NAME}>
      <h3 className="text-base font-medium">
        {t('tenants.usage.sectionTitle', { defaultValue: 'Usage in the last 24 hours' })}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t('tenants.usage.meta.tenantId', { defaultValue: 'Tenant ID' })}
        :
        {' '}
        <span className="font-mono">{tenantId}</span>
      </p>
      <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
        <label className={labelClassName}>
          {t('tenants.usage.filter.label', { defaultValue: 'API key filter' })}
        </label>
        <Popover
          open={usageApiKeyPopoverOpen}
          onOpenChange={(open) => {
            setUsageApiKeyPopoverOpen(open)
            if (!open) {
              setUsageApiKeyKeyword('')
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-between"
              disabled={keysForCurrentTenant.length === 0}
            >
              <span className="truncate text-left">
                {selectedUsageApiKey
                  ? `${selectedUsageApiKey.name} · ${selectedUsageApiKey.key_prefix}`
                  : keysForCurrentTenant.length === 0
                    ? t('tenants.usage.filter.noKeys', {
                        defaultValue: 'No API keys for current tenant',
                      })
                    : t('tenants.usage.filter.allKeys', { defaultValue: 'All API keys' })}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[360px] p-2">
            <div className="space-y-2">
              <Input
                value={usageApiKeyKeyword}
                onChange={(e) => setUsageApiKeyKeyword(e.target.value)}
                placeholder={t('tenants.usage.filter.placeholder', {
                  defaultValue: 'Search name / prefix / key_id',
                })}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="max-h-56 overflow-y-auto rounded-md border border-border/60 bg-background">
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-left text-sm hover:bg-accent',
                    effectiveUsageApiKeyFilter === usageApiKeyFilterAllValue ? 'bg-accent/50' : '',
                  )}
                  onClick={() => {
                    setUsageApiKeyFilter(usageApiKeyFilterAllValue)
                    setUsageApiKeyPopoverOpen(false)
                    setUsageApiKeyKeyword('')
                  }}
                >
                  <span className="truncate">
                    {t('tenants.usage.filter.allKeys', { defaultValue: 'All API keys' })}
                  </span>
                  {effectiveUsageApiKeyFilter === usageApiKeyFilterAllValue ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : null}
                </button>
                {filteredUsageApiKeys.map((key) => (
                  <button
                    key={key.id}
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent',
                      effectiveUsageApiKeyFilter === key.id ? 'bg-accent/50' : '',
                    )}
                    onClick={() => {
                      setUsageApiKeyFilter(key.id)
                      setUsageApiKeyPopoverOpen(false)
                      setUsageApiKeyKeyword('')
                    }}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{key.name}</div>
                      <div className="truncate text-xs text-muted-foreground font-mono">
                        {key.key_prefix} · {key.id}
                      </div>
                    </div>
                    {effectiveUsageApiKeyFilter === key.id ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                ))}
                {filteredUsageApiKeys.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">
                    {t('tenants.usage.filter.noMatches', { defaultValue: 'No matching API keys' })}
                  </div>
                ) : null}
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <p className="text-xs text-muted-foreground">
          {t('tenants.usage.filter.currentView', { defaultValue: 'Current view' })}
          :
          {' '}
          {selectedUsageApiKey ? (
            <span className="font-mono">{selectedUsageApiKey.id}</span>
          ) : (
            t('tenants.usage.filter.allKeys', { defaultValue: 'All API keys' })
          )}
        </p>
      </div>

      {usageSummaryQuery.isFetching ? (
        <div className="flex items-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('tenants.usage.status.loading', { defaultValue: 'Loading usage data…' })}
        </div>
      ) : null}

      {usageSummaryQuery.isError ? (
        <p className="text-sm text-destructive" title={usageSummaryErrorDisplay?.tooltip}>
          {usageSummaryErrorDisplay?.label ?? '-'}
        </p>
      ) : null}

      {usageSummaryQuery.data ? (
        selectedUsageApiKey ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className={POOL_METRIC_CARD_CLASS_NAME}>
              <div className="text-xs text-muted-foreground">
                {t('tenants.usage.metrics.apiKeyRequests', { defaultValue: 'API key requests' })}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {formatExactCount(usageSummaryQuery.data.tenant_api_key_total_requests)}
              </div>
            </div>
            <div className={POOL_METRIC_CARD_CLASS_NAME}>
              <div className="text-xs text-muted-foreground">
                {t('tenants.usage.metrics.activeApiKeys', { defaultValue: 'Active API keys' })}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {formatExactCount(usageSummaryQuery.data.unique_tenant_api_key_count)}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className={POOL_METRIC_CARD_CLASS_NAME}>
              <div className="text-xs text-muted-foreground">
                {t('tenants.usage.metrics.accountRequests', { defaultValue: 'Account requests' })}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {formatExactCount(usageSummaryQuery.data.account_total_requests)}
              </div>
            </div>
            <div className={POOL_METRIC_CARD_CLASS_NAME}>
              <div className="text-xs text-muted-foreground">
                {t('tenants.usage.metrics.tenantApiKeyRequests', {
                  defaultValue: 'Tenant API key requests',
                })}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {formatExactCount(usageSummaryQuery.data.tenant_api_key_total_requests)}
              </div>
            </div>
            <div className={POOL_METRIC_CARD_CLASS_NAME}>
              <div className="text-xs text-muted-foreground">
                {t('tenants.usage.metrics.activeAccounts', { defaultValue: 'Active accounts' })}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {formatExactCount(usageSummaryQuery.data.unique_account_count)}
              </div>
            </div>
            <div className={POOL_METRIC_CARD_CLASS_NAME}>
              <div className="text-xs text-muted-foreground">
                {t('tenants.usage.metrics.activeApiKeys', { defaultValue: 'Active API keys' })}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {formatExactCount(usageSummaryQuery.data.unique_tenant_api_key_count)}
              </div>
            </div>
          </div>
        )
      ) : null}
    </section>
  )
}
