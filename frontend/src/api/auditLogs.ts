import { apiClient } from './client'
import { tenantApiClient } from './tenantClient'

export interface AuditLogsQueryParams {
  start_ts?: number
  end_ts?: number
  limit?: number
  tenant_id?: string
  actor_type?: string
  actor_id?: string
  action?: string
  result_status?: string
  keyword?: string
}

export interface AuditLogItem {
  id: string
  actor_type: string
  actor_id?: string
  tenant_id?: string
  action: string
  reason?: string
  request_ip?: string
  user_agent?: string
  target_type?: string
  target_id?: string
  payload_json: Record<string, unknown>
  result_status: string
  created_at: string
}

export interface AuditLogsResponse {
  items: AuditLogItem[]
}

export const auditLogsApi = {
  adminList: (params: AuditLogsQueryParams) =>
    apiClient.get<AuditLogsResponse>('/admin/audit-logs', {
      params,
    }),
  tenantList: async (params: Omit<AuditLogsQueryParams, 'tenant_id'>) => {
    const response = await tenantApiClient.get<AuditLogsResponse>('/audit-logs', {
      params,
    })
    return response.data
  },
}
