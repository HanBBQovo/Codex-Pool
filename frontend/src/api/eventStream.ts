import { apiClient } from './client'

export type SystemEventCategory =
  | 'request'
  | 'account_pool'
  | 'patrol'
  | 'import'
  | 'infra'
  | 'admin_action'

export type SystemEventSeverity = 'debug' | 'info' | 'warn' | 'error'

export interface SystemEventItem {
  id: string
  ts: string
  category: SystemEventCategory
  event_type: string
  severity: SystemEventSeverity
  source: string
  tenant_id?: string
  account_id?: string
  request_id?: string
  trace_request_id?: string
  job_id?: string
  account_label?: string
  auth_provider?: string
  operator_state_from?: string
  operator_state_to?: string
  reason_class?: string
  reason_code?: string
  next_action_at?: string
  path?: string
  method?: string
  model?: string
  selected_account_id?: string
  selected_proxy_id?: string
  routing_decision?: string
  failover_scope?: string
  status_code?: number
  upstream_status_code?: number
  latency_ms?: number
  message?: string
  preview_text?: string
  payload_json?: Record<string, unknown> | null
  secret_preview?: string
}

export interface SystemEventListResponse {
  items: SystemEventItem[]
  next_cursor?: string | null
}

export interface SystemEventSummaryCategoryCount {
  category: SystemEventCategory
  count: number
}

export interface SystemEventSummaryTypeCount {
  event_type: string
  count: number
}

export interface SystemEventSummaryReasonCount {
  reason_code: string
  count: number
}

export interface SystemEventSummarySeverityCount {
  severity: SystemEventSeverity
  count: number
}

export interface SystemEventSummaryResponse {
  total: number
  by_category: SystemEventSummaryCategoryCount[]
  by_event_type: SystemEventSummaryTypeCount[]
  by_reason_code: SystemEventSummaryReasonCount[]
  by_severity: SystemEventSummarySeverityCount[]
}

export interface SystemEventQueryParams {
  start_ts?: number
  end_ts?: number
  account_id?: string
  request_id?: string
  job_id?: string
  tenant_id?: string
  category?: SystemEventCategory
  event_type?: string
  severity?: SystemEventSeverity
  reason_code?: string
  keyword?: string
  limit?: number
  cursor?: string
}

export const eventStreamApi = {
  adminList: (params: SystemEventQueryParams) =>
    apiClient.get<SystemEventListResponse>('/admin/event-stream', { params }),
  adminSummary: (params: SystemEventQueryParams) =>
    apiClient.get<SystemEventSummaryResponse>('/admin/event-stream/summary', { params }),
  adminCorrelation: (requestId: string, params?: Omit<SystemEventQueryParams, 'request_id'>) =>
    apiClient.get<{ request_id: string; items: SystemEventItem[] }>(
      `/admin/event-stream/correlation/${encodeURIComponent(requestId)}`,
      { params },
    ),
  adminDetail: (eventId: string) =>
    apiClient.get<{ item: SystemEventItem }>(
      `/admin/event-stream/${encodeURIComponent(eventId)}`,
    ),
}
