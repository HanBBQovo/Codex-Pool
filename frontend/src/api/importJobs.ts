import { apiClient } from './client'
import type { OAuthInventoryFailureStage, OAuthInventoryStatus } from './accounts'

export type OAuthImportItemStatus =
  | 'pending'
  | 'processing'
  | 'created'
  | 'updated'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export type OAuthImportJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type OAuthImportCredentialMode = 'refresh_token' | 'access_token'
export type OAuthImportAdmissionStatus = OAuthInventoryStatus

export interface OAuthImportErrorSummary {
  error_code: string
  count: number
}

export interface OAuthImportAdmissionCounts {
  ready: number
  needs_refresh: number
  no_quota: number
  failed: number
}

export interface OAuthImportJobSummary {
  job_id: string
  status: OAuthImportJobStatus
  total: number
  processed: number
  created_count: number
  updated_count: number
  failed_count: number
  skipped_count: number
  started_at?: string
  finished_at?: string
  created_at: string
  throughput_per_min?: number
  error_summary: OAuthImportErrorSummary[]
  admission_counts: OAuthImportAdmissionCounts
}

export interface OAuthImportJobItem {
  item_id: number
  source_file: string
  line_no: number
  status: OAuthImportItemStatus
  label: string
  email?: string
  chatgpt_account_id?: string
  account_id?: string
  error_code?: string
  error_message?: string
  admission_status?: OAuthImportAdmissionStatus
  admission_source?: string
  admission_reason?: string
  failure_stage?: OAuthInventoryFailureStage
  attempt_count: number
  transient_retry_count: number
  next_retry_at?: string
  retryable: boolean
  terminal_reason?: string
}

export interface OAuthImportJobItemsResponse {
  items: OAuthImportJobItem[]
  next_cursor?: number
}

export interface OAuthImportJobActionResponse {
  job_id: string
  accepted: boolean
}

export const importJobsApi = {
  async createJob(
    files: File | File[],
    options: {
      mode?: string
      base_url?: string
      default_priority?: number
      default_enabled?: boolean
      credential_mode?: OAuthImportCredentialMode
    } = {},
  ): Promise<OAuthImportJobSummary> {
    const formData = new FormData()
    const normalizedFiles = Array.isArray(files) ? files : [files]
    normalizedFiles.forEach((file) => formData.append('files[]', file))
    formData.append('mode', options.mode ?? 'chat_gpt_session')
    formData.append('base_url', options.base_url ?? 'https://chatgpt.com/backend-api/codex')
    formData.append('default_priority', String(options.default_priority ?? 100))
    formData.append('default_enabled', String(options.default_enabled ?? true))
    formData.append('credential_mode', options.credential_mode ?? 'refresh_token')

    const response = await apiClient.post<OAuthImportJobSummary>(
      '/upstream-accounts/oauth/import-jobs',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 120_000,
      },
    )
    return response.data
  },

  async getJobSummary(jobId: string): Promise<OAuthImportJobSummary> {
    const response = await apiClient.get<OAuthImportJobSummary>(
      `/upstream-accounts/oauth/import-jobs/${jobId}`,
      { timeout: 30_000 },
    )
    return response.data
  },

  async getJobItems(
    jobId: string,
    params?: { status?: string; cursor?: number; limit?: number },
  ): Promise<OAuthImportJobItemsResponse> {
    const response = await apiClient.get<OAuthImportJobItemsResponse>(
      `/upstream-accounts/oauth/import-jobs/${jobId}/items`,
      {
        params,
        timeout: 30_000,
      },
    )
    return response.data
  },

  async retryFailed(jobId: string): Promise<OAuthImportJobActionResponse> {
    const response = await apiClient.post<OAuthImportJobActionResponse>(
      `/upstream-accounts/oauth/import-jobs/${jobId}/retry-failed`,
      undefined,
      { timeout: 30_000 },
    )
    return response.data
  },

  async pauseJob(jobId: string): Promise<OAuthImportJobActionResponse> {
    const response = await apiClient.post<OAuthImportJobActionResponse>(
      `/upstream-accounts/oauth/import-jobs/${jobId}/pause`,
      undefined,
      { timeout: 30_000 },
    )
    return response.data
  },

  async resumeJob(jobId: string): Promise<OAuthImportJobActionResponse> {
    const response = await apiClient.post<OAuthImportJobActionResponse>(
      `/upstream-accounts/oauth/import-jobs/${jobId}/resume`,
      undefined,
      { timeout: 30_000 },
    )
    return response.data
  },

  async cancelJob(jobId: string): Promise<OAuthImportJobActionResponse> {
    const response = await apiClient.post<OAuthImportJobActionResponse>(
      `/upstream-accounts/oauth/import-jobs/${jobId}/cancel`,
      undefined,
      { timeout: 30_000 },
    )
    return response.data
  },
}
