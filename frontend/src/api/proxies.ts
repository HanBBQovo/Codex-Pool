import { apiClient } from './client'
import type {
  AdminProxyNodeMutationResponse,
  AdminProxyPoolResponse,
  AdminProxyPoolSettingsResponse,
  AdminProxyTestResponse,
  CreateAdminProxyNodeRequest,
  UpdateAdminProxyNodeRequest,
  UpdateAdminProxyPoolSettingsRequest,
} from './types'

export const proxiesApi = {
  listProxies: async (): Promise<AdminProxyPoolResponse> => {
    const response = await apiClient.get<AdminProxyPoolResponse>('/admin/proxies')
    return response.data
  },
  createProxy: async (payload: CreateAdminProxyNodeRequest): Promise<AdminProxyNodeMutationResponse> => {
    const response = await apiClient.post<AdminProxyNodeMutationResponse>('/admin/proxies', payload)
    return response.data
  },
  updateProxy: async (
    proxyId: string,
    payload: UpdateAdminProxyNodeRequest,
  ): Promise<AdminProxyNodeMutationResponse> => {
    const response = await apiClient.put<AdminProxyNodeMutationResponse>(`/admin/proxies/${proxyId}`, payload)
    return response.data
  },
  deleteProxy: async (proxyId: string): Promise<void> => {
    await apiClient.delete<void>(`/admin/proxies/${proxyId}`)
  },
  updateSettings: async (
    payload: UpdateAdminProxyPoolSettingsRequest,
  ): Promise<AdminProxyPoolSettingsResponse> => {
    const response = await apiClient.put<AdminProxyPoolSettingsResponse>('/admin/proxies/settings', payload)
    return response.data
  },
  testAll: async (): Promise<AdminProxyTestResponse> => {
    const response = await apiClient.post<AdminProxyTestResponse>('/admin/proxies/test', {})
    return response.data
  },
  testProxy: async (proxyId: string): Promise<AdminProxyTestResponse> => {
    const response = await apiClient.post<AdminProxyTestResponse>('/admin/proxies/test', undefined, {
      params: { proxy_id: proxyId },
    })
    return response.data
  },
}
