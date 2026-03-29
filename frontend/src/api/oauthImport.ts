import { apiClient } from './client'
import type { UpstreamAccount } from './accounts'

export type CodexOAuthLoginSessionStatus =
  | 'waiting_callback'
  | 'exchanging'
  | 'importing'
  | 'completed'
  | 'failed'
  | 'expired'

export interface CodexOAuthLoginSessionError {
  code: string
  message: string
}

export interface CodexOAuthLoginSessionResult {
  created: boolean
  account: UpstreamAccount
  email?: string
  chatgpt_account_id?: string
  chatgpt_plan_type?: string
}

export interface CodexOAuthLoginSession {
  session_id: string
  status: CodexOAuthLoginSessionStatus
  authorize_url: string
  callback_url: string
  created_at: string
  updated_at: string
  expires_at: string
  error?: CodexOAuthLoginSessionError
  result?: CodexOAuthLoginSessionResult
}

export interface CreateCodexOAuthLoginSessionRequest {
  label?: string
  base_url?: string
  enabled?: boolean
  priority?: number
}

export const oauthImportApi = {
  createCodexLoginSession: async (payload: CreateCodexOAuthLoginSessionRequest) => {
    const response = await apiClient.post<CodexOAuthLoginSession>(
      '/upstream-accounts/oauth/codex/login-sessions',
      payload,
      { timeout: 30000 },
    )
    return response.data
  },

  getCodexLoginSession: async (sessionId: string) => {
    const response = await apiClient.get<CodexOAuthLoginSession>(
      `/upstream-accounts/oauth/codex/login-sessions/${sessionId}`,
      { timeout: 30000 },
    )
    return response.data
  },

  submitCodexLoginCallback: async (sessionId: string, redirectUrl: string) => {
    const response = await apiClient.post<CodexOAuthLoginSession>(
      `/upstream-accounts/oauth/codex/login-sessions/${sessionId}/callback`,
      { redirect_url: redirectUrl },
      { timeout: 30000 },
    )
    return response.data
  },
}
