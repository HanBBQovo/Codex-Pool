import { apiClient } from './client'
import type { AdminSystemStateResponse } from './types'

export interface ApiKey {
    id: string;
    tenant_id?: string;
    name: string;
    key_prefix: string;
    key_hash: string;
    enabled: boolean;
    created_at: string;
}

export interface CreateApiKeyRequest {
    tenant_id: string;
    name: string;
}

export interface CreateApiKeyResponse {
    record: ApiKey;
    plaintext_key: string;
}

export const apiKeysApi = {
    listKeys: async () => {
        const response = await apiClient.get<ApiKey[]>('/admin/keys')
        return response.data
    },

    createKey: async (name: string, tenant_name?: string, tenant_id?: string) => {
        const response = await apiClient.post<CreateApiKeyResponse>('/admin/keys', {
            name,
            tenant_name,
            tenant_id,
        })
        return response.data
    },

    updateKeyEnabled: async (keyId: string, enabled: boolean) => {
        const response = await apiClient.patch<ApiKey>(`/admin/keys/${keyId}`, { enabled })
        return response.data
    },
}

export const adminApi = {
    getSystemState: async () => {
        const response = await apiClient.get<AdminSystemStateResponse>('/admin/system/state')
        return response.data
    },
}
