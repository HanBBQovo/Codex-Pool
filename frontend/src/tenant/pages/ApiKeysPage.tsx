import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { Button } from '@heroui/react'
import { useTranslation } from 'react-i18next'

import { groupsApi, type ApiKeyGroupItem } from '@/api/groups'
import { tenantKeysApi, type TenantApiKeyRecord } from '@/api/tenantKeys'
import { localizeApiErrorDisplay } from '@/api/errorI18n'
import { notify } from '@/lib/notification'
import {
  DockedPageIntro,
  PageContent,
  PagePanel,
  SectionHeader,
} from '@/components/layout/page-archetypes'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SurfaceInset } from '@/components/ui/surface'
import { DataTable } from '@/components/DataTable'
import { Textarea } from '@/components/ui/textarea'
import { splitAllowlist } from '@/tenant/lib/format'

function formatMicrocredits(value?: number | null) {
  if (typeof value !== 'number') return '-'
  return (value / 1_000_000).toFixed(4)
}

function pricingLine(
  groupModel: ApiKeyGroupItem['models'][number],
  t: ReturnType<typeof useTranslation>['t'],
) {
  const inputLabel = t('common.tokenSegments.input')
  const cachedLabel = t('common.tokenSegments.cached')
  const outputLabel = t('common.tokenSegments.output')
  const finalLine = `${inputLabel} ${formatMicrocredits(groupModel.final_input_price_microcredits)} · ${cachedLabel} ${formatMicrocredits(groupModel.final_cached_input_price_microcredits)} · ${outputLabel} ${formatMicrocredits(groupModel.final_output_price_microcredits)}`
  const formulaLine = `${inputLabel} ${formatMicrocredits(groupModel.formula_input_price_microcredits)} · ${cachedLabel} ${formatMicrocredits(groupModel.formula_cached_input_price_microcredits)} · ${outputLabel} ${formatMicrocredits(groupModel.formula_output_price_microcredits)}`
  return { finalLine, formulaLine }
}

export function TenantApiKeysPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pendingGroups, setPendingGroups] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    name: '',
    ip_allowlist: '',
    group_id: '',
  })

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['tenantKeys', 'manage'],
    queryFn: () => tenantKeysApi.list(),
    staleTime: 60_000,
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['tenantApiKeyGroups'],
    queryFn: () => groupsApi.tenantList(),
    staleTime: 60_000,
  })

  const selectedCreateGroup = useMemo(() => {
    const resolvedGroupId = form.group_id || groups.find((item) => item.is_default)?.id || groups[0]?.id || ''
    return groups.find((item) => item.id === resolvedGroupId) ?? null
  }, [form.group_id, groups])

  const createMutation = useMutation({
    mutationFn: () =>
      tenantKeysApi.create({
        name: form.name,
        ip_allowlist: splitAllowlist(form.ip_allowlist),
        group_id: form.group_id || groups.find((item) => item.is_default)?.id || groups[0]?.id,
      }),
    onSuccess: (response) => {
      notify({
        variant: 'success',
        title: t('tenantApiKeys.messages.createSuccess', { defaultValue: 'Create Success' }),
        description: t('tenantApiKeys.messages.plaintextShownOnce', {
          defaultValue: 'Plaintext Shown Once',
          key: response.plaintext_key,
        }),
      })
      setForm({ name: '', ip_allowlist: '', group_id: groups.find((item) => item.is_default)?.id || groups[0]?.id || '' })
      queryClient.invalidateQueries({ queryKey: ['tenantKeys'] })
    },
    onError: (error) => {
      notify({
        variant: 'error',
        title: t('tenantApiKeys.messages.createFailed', { defaultValue: 'Create Failed' }),
        description: localizeApiErrorDisplay(
          t,
          error,
          t('tenantApiKeys.messages.retryLater', { defaultValue: 'Retry Later' }),
        ).label,
      })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      tenantKeysApi.patch(id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenantKeys'] })
    },
  })

  const changeGroupMutation = useMutation({
    mutationFn: ({ id, group_id }: { id: string; group_id: string }) =>
      tenantKeysApi.patch(id, { group_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenantKeys'] })
    },
    onError: (error) => {
      notify({
        variant: 'error',
        title: t('tenantApiKeys.messages.updateGroupFailed', { defaultValue: 'Failed to update group' }),
        description: localizeApiErrorDisplay(
          t,
          error,
          t('tenantApiKeys.messages.retryLater', { defaultValue: 'Retry Later' }),
        ).label,
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tenantKeysApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenantKeys'] })
    },
  })

  const columns = useMemo<ColumnDef<TenantApiKeyRecord>[]>(
    () => [
      {
        id: 'name',
        header: t('tenantApiKeys.columns.name', { defaultValue: 'Name' }),
        accessorFn: (row) => row.name.toLowerCase(),
        cell: ({ row }) => <span>{row.original.name}</span>,
      },
      {
        id: 'prefix',
        header: t('tenantApiKeys.columns.prefix', { defaultValue: 'Prefix' }),
        accessorFn: (row) => row.key_prefix.toLowerCase(),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.key_prefix}</span>,
      },
      {
        id: 'status',
        header: t('tenantApiKeys.columns.status', { defaultValue: 'Status' }),
        accessorFn: (row) => `${row.enabled ? 'enabled' : 'disabled'} ${row.group.deleted ? 'invalid' : ''}`,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Badge variant={row.original.enabled ? 'success' : 'secondary'}>
              {row.original.enabled
                ? t('tenantApiKeys.status.enabled', { defaultValue: 'Enabled' })
                : t('tenantApiKeys.status.disabled', { defaultValue: 'Disabled' })}
            </Badge>
            {row.original.group.deleted ? (
              <Badge variant="destructive">
                {t('tenantApiKeys.status.groupInvalid', { defaultValue: 'Group invalid' })}
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        id: 'group',
        header: t('tenantApiKeys.columns.group', { defaultValue: 'Group' }),
        accessorFn: (row) => `${row.group.name} ${row.group.deleted ? 'invalid' : ''}`.toLowerCase(),
        cell: ({ row }) => (
          <div className="space-y-1">
            <div>{row.original.group.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.group.deleted
                ? t('tenantApiKeys.group.invalidHint', { defaultValue: 'This group was deleted. Choose a new group before making requests.' })
                : row.original.group.allow_all_models
                  ? t('tenantApiKeys.group.allowAllModels', { defaultValue: 'All catalog models enabled' })
                  : t('tenantApiKeys.group.modelCount', { defaultValue: '{{count}} configured models', count: groups.find((item) => item.id === row.original.group_id)?.model_count ?? row.original.model_allowlist.length })}
            </div>
          </div>
        ),
      },
      {
        id: 'ipAllowlist',
        header: t('tenantApiKeys.columns.ipAllowlist', { defaultValue: 'Ip Allowlist' }),
        accessorFn: (row) => row.ip_allowlist.join(', ').toLowerCase(),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.ip_allowlist.join(', ') || '-'}</span>
        ),
      },
      {
        id: 'actions',
        header: t('tenantApiKeys.columns.actions', { defaultValue: 'Actions' }),
        cell: ({ row }) => {
          const key = row.original
          const selectedGroupId = pendingGroups[key.id] ?? key.group_id
          return (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={selectedGroupId}
                onValueChange={(value) =>
                  setPendingGroups((prev) => ({
                    ...prev,
                    [key.id]: value,
                  }))
                }
              >
                <SelectTrigger
                  className="w-[180px]"
                  size="sm"
                  aria-label={t('tenantApiKeys.columns.group', { defaultValue: 'Group' })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                onClick={() => changeGroupMutation.mutate({ id: key.id, group_id: selectedGroupId })}
                disabled={changeGroupMutation.isPending || !selectedGroupId || selectedGroupId === key.group_id}
              >
                {t('tenantApiKeys.actions.changeGroup', { defaultValue: 'Change Group' })}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  toggleMutation.mutate({
                    id: key.id,
                    enabled: !key.enabled,
                  })
                }
                disabled={toggleMutation.isPending}
              >
                {key.enabled
                  ? t('tenantApiKeys.actions.disable', { defaultValue: 'Disable' })
                  : t('tenantApiKeys.actions.enable', { defaultValue: 'Enable' })}
              </Button>
              <Button
                type="button"
                color="danger"
                variant="light"
                size="sm"
                onClick={() => deleteMutation.mutate(key.id)}
                disabled={deleteMutation.isPending}
              >
                {t('common.delete')}
              </Button>
            </div>
          )
        },
      },
    ],
    [changeGroupMutation, deleteMutation, groups, pendingGroups, t, toggleMutation],
  )

  const previewColumns = useMemo<ColumnDef<ApiKeyGroupItem['models'][number]>[]>(
    () => [
      {
        id: 'model',
        header: t('tenantApiKeys.preview.columns.model', { defaultValue: 'Model' }),
        accessorFn: (row) => row.model.toLowerCase(),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.model}</span>,
      },
      {
        id: 'finalPrice',
        header: t('tenantApiKeys.preview.columns.finalPrice', { defaultValue: 'Final price' }),
        accessorFn: (row) => pricingLine(row, t).finalLine.toLowerCase(),
        cell: ({ row }) => pricingLine(row.original, t).finalLine,
      },
      {
        id: 'formulaPrice',
        header: t('tenantApiKeys.preview.columns.formulaPrice', { defaultValue: 'Formula price' }),
        accessorFn: (row) => pricingLine(row, t).formulaLine.toLowerCase(),
        cell: ({ row }) => {
          const line = pricingLine(row.original, t)
          return (
            <span className="text-default-500">
              {row.original.uses_absolute_pricing ? (
                <span className="line-through">{line.formulaLine}</span>
              ) : (
                line.formulaLine
              )}
            </span>
          )
        },
      },
    ],
    [t],
  )

  const createGroupId = form.group_id || groups.find((item) => item.is_default)?.id || groups[0]?.id || ''

  return (
    <PageContent className="space-y-6">
      <DockedPageIntro
        title={t('nav.apiKeys')}
        description={t('tenantApiKeys.subtitle', { defaultValue: 'Manage API keys and bind each key to a pricing and model group.' })}
      />

      <PagePanel>
        <SectionHeader
          title={t('tenantApiKeys.create.title', { defaultValue: 'Create API key' })}
          description={t('tenantApiKeys.create.description', { defaultValue: 'Create a key, set its IP allowlist, and choose which group pricing it uses.' })}
        />
        <div className="pt-4">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              createMutation.mutate()
            }}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Input
                id="tenant-key-name"
                aria-label={t('tenantApiKeys.create.nameAriaLabel', { defaultValue: 'Key name' })}
                placeholder={t('tenantApiKeys.create.namePlaceholder', { defaultValue: 'Name Placeholder' })}
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                autoComplete="off"
              />
              <Textarea
                id="tenant-key-ip-allowlist"
                aria-label={t('tenantApiKeys.create.ipAllowlistAriaLabel', { defaultValue: 'IP allowlist' })}
                placeholder={t('tenantApiKeys.create.ipAllowlistPlaceholder', {
                  defaultValue: 'Ip Allowlist Placeholder',
                })}
                value={form.ip_allowlist}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, ip_allowlist: event.target.value }))
                }
              />
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('tenantApiKeys.create.groupLabel', { defaultValue: 'API key group' })}
                </label>
                <Select
                  value={createGroupId}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, group_id: value }))}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={t('tenantApiKeys.create.groupLabel', { defaultValue: 'API key group' })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button color="primary" type="submit" disabled={createMutation.isPending || !groups.length}>
              {t('tenantApiKeys.create.submit', { defaultValue: 'Submit' })}
            </Button>
          </form>
        </div>
      </PagePanel>

      <PagePanel className="space-y-3">
        <SectionHeader
          title={t('tenantApiKeys.preview.title')}
          description={
            selectedCreateGroup
              ? t('tenantApiKeys.preview.description', {
                  name: selectedCreateGroup.name,
                  input: formatMicrocredits(selectedCreateGroup.models[0]?.final_input_price_microcredits),
                  cached: formatMicrocredits(selectedCreateGroup.models[0]?.final_cached_input_price_microcredits),
                  output: formatMicrocredits(selectedCreateGroup.models[0]?.final_output_price_microcredits),
                })
              : t('tenantApiKeys.preview.empty')
          }
        />
        <div className="space-y-3">
          {selectedCreateGroup ? (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                {selectedCreateGroup.allow_all_models
                  ? t('tenantApiKeys.preview.allowAllModels', { defaultValue: 'All catalog models are available in this group.' })
                  : t('tenantApiKeys.preview.modelCount', { defaultValue: '{{count}} models are configured in this group.', count: selectedCreateGroup.model_count })}
              </div>
              <SurfaceInset className="max-h-[260px] overflow-auto">
                <DataTable
                  columns={previewColumns}
                  data={selectedCreateGroup.models.slice(0, 12)}
                  density="compact"
                  enableSearch={false}
                  showToolbar={false}
                  showPageControls={false}
                  className="border-0 bg-transparent shadow-none"
                  emptyText={t('tenantApiKeys.preview.empty', { defaultValue: 'No group available yet.' })}
                />
              </SurfaceInset>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('tenantApiKeys.preview.empty', { defaultValue: 'No group available yet.' })}</p>
          )}
        </div>
      </PagePanel>

      <PagePanel className="space-y-4">
        <SectionHeader
          title={t('tenantApiKeys.list.title', { defaultValue: 'API key list' })}
          description={t('tenantApiKeys.list.description', { defaultValue: 'Review API keys, update their group assignment, and manage enabled state.' })}
        />
        <div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <DataTable
              columns={columns}
              data={keys}
              searchPlaceholder={t('tenantApiKeys.list.searchPlaceholder', {
                defaultValue: 'Search by name, prefix, group or status',
              })}
              defaultPageSize={20}
              pageSizeOptions={[20, 50, 100]}
              density="compact"
              emptyText={t('tenantApiKeys.list.empty', { defaultValue: 'No API keys' })}
            />
          )}
        </div>
      </PagePanel>
    </PageContent>
  )
}
