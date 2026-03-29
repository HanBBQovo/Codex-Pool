import type {
  AdminProxyNode,
  AdminProxyPoolResponse,
  UpdateAdminProxyPoolSettingsRequest,
} from '@/api/types'

export type ProxyHealth = 'healthy' | 'degraded' | 'offline' | 'disabled'

export interface ProxyCardRow {
  id: string
  name: string
  endpoint: string
  status: ProxyHealth
  latencyMs: number
  scheme: string
  hasAuth: boolean
  weight: number
  lastError: string
  updatedAt: string
}

export function resolveProxyHealth(proxy: Pick<AdminProxyNode, 'enabled' | 'last_test_status'>): ProxyHealth {
  if (!proxy.enabled) {
    return 'disabled'
  }
  if (proxy.last_test_status === 'error') {
    return 'offline'
  }
  if (proxy.last_test_status === 'skipped') {
    return 'degraded'
  }
  return 'healthy'
}

export function mapProxyNodesToCards(nodes: AdminProxyNode[]): ProxyCardRow[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.label || node.id,
    endpoint: node.proxy_url_masked || '',
    status: resolveProxyHealth(node),
    latencyMs: node.last_latency_ms ?? 0,
    scheme: node.scheme,
    hasAuth: node.has_auth,
    weight: node.weight,
    lastError: node.last_error ?? '',
    updatedAt: node.updated_at,
  }))
}

export function createProxySettingsDraft(
  pool: Pick<AdminProxyPoolResponse, 'settings'> | null | undefined,
): UpdateAdminProxyPoolSettingsRequest {
  return {
    enabled: pool?.settings.enabled ?? false,
    fail_mode: pool?.settings.fail_mode ?? 'strict_proxy',
  }
}
