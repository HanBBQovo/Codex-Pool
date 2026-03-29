import type { AdminSystemStateResponse } from '../../api/types.ts'

export type SystemComponentStatus = 'healthy' | 'degraded' | 'checking'

export interface SystemComponentRow {
  id: 'control-plane' | 'data-plane' | 'usage-repo'
  name: string
  status: SystemComponentStatus
  description: string
}

type SystemStateLike = Pick<
  AdminSystemStateResponse,
  'usage_repo_available' | 'data_plane_error' | 'data_plane_debug'
>

export function resolveSystemComponentRows(
  state: SystemStateLike | undefined,
): SystemComponentRow[] {
  return [
    {
      id: 'control-plane',
      name: 'Control Plane',
      status: 'healthy',
      description: 'Admin API and orchestration surface',
    },
    {
      id: 'data-plane',
      name: 'Data Plane',
      status: state?.data_plane_error
        ? 'degraded'
        : state?.data_plane_debug
          ? 'healthy'
          : 'checking',
      description: state?.data_plane_error
        ? state.data_plane_error
        : state?.data_plane_debug
          ? 'Connected and reporting runtime debug state'
          : 'Waiting for runtime diagnostics',
    },
    {
      id: 'usage-repo',
      name: 'Usage Repository',
      status: state?.usage_repo_available ? 'healthy' : 'degraded',
      description: state?.usage_repo_available
        ? 'Usage analytics storage is available'
        : 'Usage analytics storage is unavailable',
    },
  ]
}

export function formatDurationFromSeconds(totalSeconds: number | undefined): string {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return 'Unknown'
  }

  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}
