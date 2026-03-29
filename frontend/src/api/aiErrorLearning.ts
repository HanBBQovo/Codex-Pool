import { apiClient } from './client'

export type UpstreamErrorAction =
  | 'return_failure'
  | 'retry_same_account'
  | 'retry_cross_account'

export type UpstreamErrorRetryScope = 'none' | 'same_account' | 'cross_account'
export type UpstreamErrorTemplateStatus =
  | 'provisional_live'
  | 'review_pending'
  | 'approved'
  | 'rejected'
export type BuiltinErrorTemplateKind = 'gateway_error' | 'heuristic_upstream'

export type SupportedErrorTemplateLocale = 'en' | 'zh-CN'

export interface AiErrorLearningSettings {
  enabled: boolean
  first_seen_timeout_ms: number
  review_hit_threshold: number
  updated_at?: string | null
}

export interface LocalizedErrorTemplates {
  en?: string | null
  'zh-CN'?: string | null
}

export interface UpstreamErrorTemplateRecord {
  id: string
  fingerprint: string
  provider: string
  normalized_status_code: number
  semantic_error_code: string
  action: UpstreamErrorAction
  retry_scope: UpstreamErrorRetryScope
  status: UpstreamErrorTemplateStatus
  templates: LocalizedErrorTemplates
  representative_samples: string[]
  hit_count: number
  first_seen_at: string
  last_seen_at: string
  updated_at: string
}

export interface BuiltinErrorTemplateRecord {
  kind: BuiltinErrorTemplateKind
  code: string
  templates: LocalizedErrorTemplates
  default_templates: LocalizedErrorTemplates
  action?: UpstreamErrorAction | null
  retry_scope?: UpstreamErrorRetryScope | null
  is_overridden: boolean
  updated_at?: string | null
}

export interface AiErrorLearningSettingsResponse {
  settings: AiErrorLearningSettings
}

export interface UpdateAiErrorLearningSettingsRequest {
  enabled: boolean
  first_seen_timeout_ms: number
  review_hit_threshold: number
}

export interface UpstreamErrorTemplatesResponse {
  templates?: UpstreamErrorTemplateRecord[]
}

export interface BuiltinErrorTemplatesResponse {
  templates?: BuiltinErrorTemplateRecord[]
}

export interface UpstreamErrorTemplateResponse {
  template: UpstreamErrorTemplateRecord
}

export interface BuiltinErrorTemplateResponse {
  template: BuiltinErrorTemplateRecord
}

export interface UpdateUpstreamErrorTemplateRequest {
  semantic_error_code: string
  action: UpstreamErrorAction
  retry_scope: UpstreamErrorRetryScope
  templates: LocalizedErrorTemplates
}

export interface UpdateBuiltinErrorTemplateRequest {
  templates: LocalizedErrorTemplates
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function normalizeLocalizedTemplates(
  templates?: Partial<LocalizedErrorTemplates> | null,
): LocalizedErrorTemplates {
  return {
    en: normalizeString(templates?.en),
    'zh-CN': normalizeString(templates?.['zh-CN']),
  }
}

function normalizeSettings(settings: AiErrorLearningSettings): AiErrorLearningSettings {
  return {
    ...settings,
    updated_at: normalizeString(settings.updated_at),
  }
}

function normalizeTemplate(record: UpstreamErrorTemplateRecord): UpstreamErrorTemplateRecord {
  return {
    ...record,
    templates: normalizeLocalizedTemplates(record.templates),
    representative_samples: Array.isArray(record.representative_samples)
      ? record.representative_samples.filter((sample): sample is string => typeof sample === 'string')
      : [],
  }
}

function normalizeBuiltinTemplate(record: BuiltinErrorTemplateRecord): BuiltinErrorTemplateRecord {
  return {
    ...record,
    templates: normalizeLocalizedTemplates(record.templates),
    default_templates: normalizeLocalizedTemplates(record.default_templates),
    updated_at: normalizeString(record.updated_at),
    action: record.action ?? null,
    retry_scope: record.retry_scope ?? null,
    is_overridden: Boolean(record.is_overridden),
  }
}

export const aiErrorLearningApi = {
  getSettings: async () => {
    const response = await apiClient.get<AiErrorLearningSettingsResponse>(
      '/admin/model-routing/error-learning/settings',
    )
    return {
      settings: normalizeSettings(response.data.settings),
    }
  },
  updateSettings: async (payload: UpdateAiErrorLearningSettingsRequest) => {
    const response = await apiClient.put<AiErrorLearningSettingsResponse>(
      '/admin/model-routing/error-learning/settings',
      payload,
    )
    return {
      settings: normalizeSettings(response.data.settings),
    }
  },
  listTemplates: async (status?: UpstreamErrorTemplateStatus) => {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : ''
    const response = await apiClient.get<UpstreamErrorTemplatesResponse>(
      `/admin/model-routing/upstream-errors${suffix}`,
    )
    return {
      templates: Array.isArray(response.data.templates)
        ? response.data.templates.map(normalizeTemplate)
        : [],
    }
  },
  listBuiltinTemplates: async () => {
    const response = await apiClient.get<BuiltinErrorTemplatesResponse>(
      '/admin/model-routing/builtin-error-templates',
    )
    return {
      templates: Array.isArray(response.data.templates)
        ? response.data.templates.map(normalizeBuiltinTemplate)
        : [],
    }
  },
  updateTemplate: async (templateId: string, payload: UpdateUpstreamErrorTemplateRequest) => {
    const response = await apiClient.put<UpstreamErrorTemplateResponse>(
      `/admin/model-routing/upstream-errors/${templateId}`,
      payload,
    )
    return {
      template: normalizeTemplate(response.data.template),
    }
  },
  updateBuiltinTemplate: async (
    kind: BuiltinErrorTemplateKind,
    code: string,
    payload: UpdateBuiltinErrorTemplateRequest,
  ) => {
    const response = await apiClient.put<BuiltinErrorTemplateResponse>(
      `/admin/model-routing/builtin-error-templates/${encodeURIComponent(kind)}/${encodeURIComponent(code)}`,
      payload,
    )
    return {
      template: normalizeBuiltinTemplate(response.data.template),
    }
  },
  approveTemplate: async (templateId: string) => {
    const response = await apiClient.post<UpstreamErrorTemplateResponse>(
      `/admin/model-routing/upstream-errors/${templateId}/approve`,
    )
    return {
      template: normalizeTemplate(response.data.template),
    }
  },
  rejectTemplate: async (templateId: string) => {
    const response = await apiClient.post<UpstreamErrorTemplateResponse>(
      `/admin/model-routing/upstream-errors/${templateId}/reject`,
    )
    return {
      template: normalizeTemplate(response.data.template),
    }
  },
  rewriteTemplate: async (templateId: string) => {
    const response = await apiClient.post<UpstreamErrorTemplateResponse>(
      `/admin/model-routing/upstream-errors/${templateId}/rewrite`,
    )
    return {
      template: normalizeTemplate(response.data.template),
    }
  },
  rewriteBuiltinTemplate: async (kind: BuiltinErrorTemplateKind, code: string) => {
    const response = await apiClient.post<BuiltinErrorTemplateResponse>(
      `/admin/model-routing/builtin-error-templates/${encodeURIComponent(kind)}/${encodeURIComponent(code)}/rewrite`,
    )
    return {
      template: normalizeBuiltinTemplate(response.data.template),
    }
  },
  resetBuiltinTemplate: async (kind: BuiltinErrorTemplateKind, code: string) => {
    const response = await apiClient.post<BuiltinErrorTemplateResponse>(
      `/admin/model-routing/builtin-error-templates/${encodeURIComponent(kind)}/${encodeURIComponent(code)}/reset`,
    )
    return {
      template: normalizeBuiltinTemplate(response.data.template),
    }
  },
}
