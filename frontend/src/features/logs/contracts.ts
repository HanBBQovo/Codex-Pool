import type { RequestAuditLogItem } from '@/api/requestLogs'

export interface RequestLogRow {
  id: string
  timestamp: string
  model: string
  status: number
  latency: number
  inputTokens: number
  outputTokens: number
  stream: boolean
  statusText: 'ok' | 'error'
}

export function mapRequestLogsToRows(items: RequestAuditLogItem[]): RequestLogRow[] {
  return items.map((item) => ({
    id: item.request_id || item.id,
    timestamp: item.created_at,
    model: item.model || '-',
    status: item.status_code,
    latency: item.latency_ms,
    inputTokens: 0,
    outputTokens: 0,
    stream: item.is_stream,
    statusText: item.status_code < 400 ? 'ok' : 'error',
  }))
}
