import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { Copy, Loader2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { localizeApiErrorDisplay } from '@/api/errorI18n'
import { apiKeysApi, type ApiKey, type CreateApiKeyResponse } from '@/api/settings'
import {
  PageIntro,
  PagePanel,
  SectionHeader,
} from '@/components/layout/page-archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StandardDataTable } from '@/components/ui/standard-data-table'
import { describeAdminApiKeysSettingsLayout } from '@/lib/page-archetypes'
import { notify } from '@/lib/notification'
import {
  copyText,
  createDateTimeFormatter,
  formatDateTimeValue,
} from '@/features/tenants/utils'

function buildAdminApiKeySearchText(key: ApiKey): string {
  const status = key.enabled ? 'active enabled' : 'revoked disabled'
  return `${key.name} ${key.key_prefix} ${status}`.toLowerCase()
}

export default function AdminApiKeys() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<CreateApiKeyResponse | null>(null)
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null)
  const dateTimeFormatter = useMemo(() => createDateTimeFormatter(), [])
  const adminApiKeysLayout = describeAdminApiKeysSettingsLayout()
  const tableSurfaceClassName = 'border-0 bg-transparent shadow-none'

  const formatDateTime = useCallback(
    (value?: string | null) => formatDateTimeValue(dateTimeFormatter, value),
    [dateTimeFormatter],
  )

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['apiKeys'],
    queryFn: () => apiKeysApi.listKeys(),
    staleTime: 60_000,
  })

  const createMutation = useMutation({
    mutationFn: (name: string) => apiKeysApi.createKey(name),
    onSuccess: (payload) => {
      setCreatedKey(payload)
      setNewKeyName('')
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
      notify({
        variant: 'success',
        title: t('apiKeys.dialog.created.title', { defaultValue: 'New key created' }),
        description: t('tenants.keys.created.notice', {
          defaultValue: 'The plaintext key is shown only once. Save it now.',
        }),
      })
    },
    onError: (error) => {
      const fallback = t('apiKeys.messages.createFailed', {
        defaultValue: 'Failed to create API key',
      })
      notify({
        variant: 'error',
        title: fallback,
        description: localizeApiErrorDisplay(t, error, fallback).label,
      })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ keyId, enabled }: { keyId: string; enabled: boolean }) =>
      apiKeysApi.updateKeyEnabled(keyId, enabled),
    onMutate: ({ keyId }) => setPendingKeyId(keyId),
    onSettled: () => setPendingKeyId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] })
    },
    onError: (error) => {
      const fallback = t('tenants.messages.apiKeyToggleFailed', {
        defaultValue: 'Failed to update API key status',
      })
      notify({
        variant: 'error',
        title: fallback,
        description: localizeApiErrorDisplay(t, error, fallback).label,
      })
    },
  })

  const columns = useMemo<ColumnDef<ApiKey>[]>(
    () => [
      {
        id: 'name',
        header: t('tenants.keys.list.columns.name', { defaultValue: 'Name' }),
        accessorFn: (row) => row.name.toLowerCase(),
        cell: ({ row }) => <span>{row.original.name}</span>,
      },
      {
        id: 'prefix',
        header: t('tenants.keys.list.columns.prefix', { defaultValue: 'Prefix' }),
        accessorFn: (row) => row.key_prefix.toLowerCase(),
        cell: ({ row }) => (
          <div className="flex items-center gap-2 font-mono text-xs">
            <span>{row.original.key_prefix}****************</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => copyText(row.original.key_prefix)}
              aria-label={t('tenants.keys.list.copyPrefix', { defaultValue: 'Copy key prefix' })}
              title={t('tenants.keys.list.copyPrefix', { defaultValue: 'Copy key prefix' })}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        ),
      },
      {
        id: 'status',
        header: t('tenants.keys.list.columns.status', { defaultValue: 'Status' }),
        accessorFn: (row) => (row.enabled ? 'active' : 'revoked'),
        cell: ({ row }) => (
          <Badge variant={row.original.enabled ? 'success' : 'secondary'}>
            {row.original.enabled
              ? t('tenants.keys.list.status.active', { defaultValue: 'Active' })
              : t('tenants.keys.list.status.revoked', { defaultValue: 'Revoked' })}
          </Badge>
        ),
      },
      {
        id: 'createdAt',
        header: t('tenants.keys.list.columns.createdAt', { defaultValue: 'Created At' }),
        accessorFn: (row) => row.created_at,
        cell: ({ row }) => <span>{formatDateTime(row.original.created_at)}</span>,
      },
      {
        id: 'actions',
        header: t('tenants.keys.list.columns.actions', { defaultValue: 'Actions' }),
        cell: ({ row }) => {
          const key = row.original
          const isPending = pendingKeyId === key.id && toggleMutation.isPending
          return (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                toggleMutation.mutate({
                  keyId: key.id,
                  enabled: !key.enabled,
                })
              }
              disabled={isPending}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {key.enabled
                ? t('tenants.keys.list.disable', { defaultValue: 'Disable' })
                : t('tenants.keys.list.enable', { defaultValue: 'Enable' })}
            </Button>
          )
        },
      },
    ],
    [formatDateTime, pendingKeyId, t, toggleMutation],
  )

  const handleCreate = () => {
    const name = newKeyName.trim()
    if (!name) {
      notify({
        variant: 'error',
        title: t('apiKeys.messages.createFailed', {
          defaultValue: 'Failed to create API key',
        }),
        description: t('apiKeys.messages.missingName', {
          defaultValue: 'Please enter a key name',
        }),
      })
      return
    }
    createMutation.mutate(name)
  }

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6 md:space-y-8">
        <PageIntro
          archetype={adminApiKeysLayout.introArchetype}
          title={t('nav.apiKeys', { defaultValue: 'API Keys' })}
          description={t('apiKeys.subtitle', {
            defaultValue: 'Issue and manage secure access credentials for client applications.',
          })}
        />

        {adminApiKeysLayout.sectionFlow === 'stacked-panels' ? (
          <>
            <PagePanel className="space-y-6">
              <SectionHeader
                title={t('tenants.keys.create.title', { defaultValue: 'Create API Key' })}
                description={t('apiKeys.createPanelDescription', {
                  defaultValue:
                    'Create a Data Plane access key for this standalone workspace. The plaintext key is shown only once.',
                })}
              />

              <form
                className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"
                onSubmit={(event) => {
                  event.preventDefault()
                  handleCreate()
                }}
              >
                <div className="space-y-1.5">
                  <label
                    htmlFor="admin-api-key-name"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t('tenants.keys.create.fields.name', { defaultValue: 'Key Name' })}
                  </label>
                  <Input
                    id="admin-api-key-name"
                    name="admin_api_key_name"
                    value={newKeyName}
                    onChange={(event) => setNewKeyName(event.target.value)}
                    placeholder={t('tenants.keys.create.fields.namePlaceholder', {
                      defaultValue: 'e.g. admin-main-key',
                    })}
                    autoComplete="off"
                  />
                </div>
                <div className="flex items-center lg:justify-end">
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    {t('tenants.keys.create.submit', { defaultValue: 'Create Key' })}
                  </Button>
                </div>
              </form>

              {createdKey && adminApiKeysLayout.createdKeyPlacement === 'within-create-panel' ? (
                <div className="space-y-3 rounded-[1.2rem] border border-warning/30 bg-warning-muted p-4 text-warning-foreground">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {t('apiKeys.dialog.created.desc', {
                        defaultValue: 'The plaintext key is shown only once. Please copy and store it now.',
                      })}
                    </p>
                    <p className="text-xs text-warning-foreground/80">
                      {t('apiKeys.dialog.created.securityTip', {
                        defaultValue:
                          'Security notice: once this dialog is closed, the plaintext key cannot be viewed again.',
                      })}
                    </p>
                  </div>
                  <div className="break-all rounded-xl border bg-background/70 p-3 font-mono text-xs">
                    {createdKey.plaintext_key}
                  </div>
                  <div className="flex justify-start">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyText(createdKey.plaintext_key)}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      {t('apiKeys.dialog.created.copyPlaintext', {
                        defaultValue: 'Copy plaintext key',
                      })}
                    </Button>
                  </div>
                </div>
              ) : null}
            </PagePanel>

            <PagePanel className="relative overflow-hidden p-0">
              <div className="p-5 pb-0 sm:p-6 sm:pb-0">
                <SectionHeader
                  title={t('tenants.keys.list.title', { defaultValue: 'API Key List' })}
                />
              </div>

              {isLoading ? (
                <div className="px-5 pb-5 pt-4 text-sm text-muted-foreground sm:px-6 sm:pb-6">
                  {t('apiKeys.loading', { defaultValue: 'Loading credentials…' })}
                </div>
              ) : (
                <StandardDataTable
                  columns={columns}
                  data={keys}
                  className={tableSurfaceClassName}
                  defaultPageSize={20}
                  pageSizeOptions={[20, 50, 100]}
                  density={adminApiKeysLayout.listDensity}
                  searchPlaceholder={t('apiKeys.search', {
                    defaultValue: 'Search key name or prefix…',
                  })}
                  searchFn={(row, keyword) => buildAdminApiKeySearchText(row).includes(keyword)}
                  emptyText={t('apiKeys.empty', {
                    defaultValue: 'No valid API keys found matching your criteria.',
                  })}
                />
              )}
            </PagePanel>
          </>
        ) : null}
      </div>
    </div>
  )
}
