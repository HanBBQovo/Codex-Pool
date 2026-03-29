import { tenantApiClient } from './tenantClient'

export interface TenantRegisterRequest {
  tenant_name: string
  email: string
  password: string
}

export interface TenantRegisterResponse {
  tenant_id: string
  user_id: string
  requires_email_verification: boolean
  debug_code?: string
}

export interface TenantLoginResponse {
  access_token: string
  token_type: string
  expires_in: number
  tenant_id: string
  user_id: string
  email: string
}

export interface TenantMeResponse {
  tenant_id: string
  user_id: string
  email: string
  impersonated: boolean
  impersonation_reason?: string
}

export const tenantAuthApi = {
  register: async (payload: TenantRegisterRequest) => {
    const response = await tenantApiClient.post<TenantRegisterResponse>('/auth/register', payload)
    return response.data
  },

  verifyEmail: async (email: string, code: string) => {
    await tenantApiClient.post<void>('/auth/verify-email', { email, code })
  },

  login: async (email: string, password: string) => {
    const response = await tenantApiClient.post<TenantLoginResponse>('/auth/login', {
      email,
      password,
    })
    return response.data
  },

  logout: async () => {
    await tenantApiClient.post<void>('/auth/logout')
  },

  me: async () => {
    const response = await tenantApiClient.get<TenantMeResponse>('/auth/me')
    return response.data
  },

  forgotPassword: async (email: string) => {
    const response = await tenantApiClient.post<{ accepted: boolean; debug_code?: string }>(
      '/auth/password/forgot',
      {
        email,
      },
    )
    return response.data
  },

  resetPassword: async (email: string, code: string, new_password: string) => {
    await tenantApiClient.post<void>('/auth/password/reset', { email, code, new_password })
  },
}
