import { apiClient } from './client'
import { DEFAULT_SYSTEM_CAPABILITIES } from './system.defaults.ts'
import type {
  RuntimeConfigSnapshot,
  RuntimeConfigUpdateRequest,
  SystemCapabilitiesResponse,
} from './types.ts'

export { DEFAULT_SYSTEM_CAPABILITIES }

export const systemApi = {
  async getCapabilities(): Promise<SystemCapabilitiesResponse> {
    try {
      const response = await apiClient.get<SystemCapabilitiesResponse>('/system/capabilities')
      return response.data
    } catch {
      return DEFAULT_SYSTEM_CAPABILITIES
    }
  },

  async getConfig(): Promise<RuntimeConfigSnapshot> {
    const response = await apiClient.get<RuntimeConfigSnapshot>('/admin/config')
    return response.data
  },

  async updateConfig(config: RuntimeConfigUpdateRequest): Promise<RuntimeConfigSnapshot> {
    const response = await apiClient.put<RuntimeConfigSnapshot>('/admin/config', config)
    return response.data
  },
}
