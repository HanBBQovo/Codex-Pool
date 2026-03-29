import type { RuntimeConfigSnapshot, RuntimeConfigUpdateRequest } from '@/api/types'

export function buildRuntimeConfigUpdateRequest(
  snapshot: RuntimeConfigSnapshot,
): RuntimeConfigUpdateRequest {
  return {
    data_plane_base_url: snapshot.data_plane_base_url,
    auth_validate_url: snapshot.auth_validate_url,
    oauth_refresh_enabled: snapshot.oauth_refresh_enabled,
    oauth_refresh_interval_sec: snapshot.oauth_refresh_interval_sec,
    notes: snapshot.notes,
  }
}
