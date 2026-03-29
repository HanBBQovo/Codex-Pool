import { apiClient } from './client'

export interface AdminLoginResponse {
  access_token: string
  token_type: string
  expires_in: number
}

export interface AdminMeResponse {
  user_id: string
  username: string
}

export const adminAuthApi = {
  login: async (username: string, password: string) => {
    const response = await apiClient.post<AdminLoginResponse>('/admin/auth/login', {
      username,
      password,
    })
    return response.data
  },

  logout: async () => {
    await apiClient.post<void>('/admin/auth/logout')
  },

  me: async () => {
    const response = await apiClient.get<AdminMeResponse>('/admin/auth/me')
    return response.data
  },
}
