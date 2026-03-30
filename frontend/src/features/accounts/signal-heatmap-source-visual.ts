export type BucketSourceKind = 'request' | 'patrol' | 'mixed' | 'none'

export function bucketSourceKind(
  requestCount: number,
  patrolCount: number,
): BucketSourceKind {
  if (requestCount > 0 && patrolCount > 0) {
    return 'mixed'
  }
  if (requestCount > 0) {
    return 'request'
  }
  if (patrolCount > 0) {
    return 'patrol'
  }
  return 'none'
}

export function sourceAccentFill(kind: BucketSourceKind, isDark: boolean) {
  switch (kind) {
    case 'request':
      return isDark ? 'rgba(125,211,252,0.95)' : 'rgba(37,99,235,0.92)'
    case 'patrol':
      return isDark ? 'rgba(196,181,253,0.95)' : 'rgba(99,102,241,0.92)'
    case 'mixed':
      return isDark ? 'rgba(244,244,245,0.95)' : 'rgba(51,65,85,0.90)'
    case 'none':
    default:
      return isDark ? 'rgba(255,255,255,0.18)' : 'rgba(148,163,184,0.55)'
  }
}
