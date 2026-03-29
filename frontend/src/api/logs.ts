import { apiClient } from './client'
import type { AdminLogEntry, AdminLogsResponse } from './types'

export const logsApi = {
  getSystemLogs: async (params?: { limit?: number }): Promise<AdminLogEntry[]> => {
    const response = await apiClient.get<AdminLogsResponse>('/admin/logs', { params })
    return response.data.items
  },
}
