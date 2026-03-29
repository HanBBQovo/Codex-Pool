import type { OAuthImportJobSummary } from '../../api/importJobs.ts'

export const RECENT_IMPORT_JOB_IDS_STORAGE_KEY = 'codex-antigravity.importJobs.recentJobIds'
export const MAX_RECENT_IMPORT_JOB_IDS = 8

export function loadRecentJobIds(serializedValue: string | null): string[] {
  if (!serializedValue) return []

  try {
    const parsed = JSON.parse(serializedValue)
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

export function mergeRecentJobIds(
  current: string[],
  nextJobId: string,
  limit = MAX_RECENT_IMPORT_JOB_IDS,
): string[] {
  return [nextJobId, ...current.filter((jobId) => jobId !== nextJobId)].slice(0, limit)
}

export function sortJobSummaries(
  summaries: Array<OAuthImportJobSummary | null | undefined>,
): OAuthImportJobSummary[] {
  return summaries
    .filter((summary): summary is OAuthImportJobSummary => Boolean(summary))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
}
