import { resolveLocale } from '@/lib/i18n-format'

function normalizeCount(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function formatExactCount(value: number, locale?: string): string {
  return normalizeCount(value).toLocaleString(resolveLocale(locale), {
    maximumFractionDigits: 0,
  })
}

export function formatOptionalExactCount(
  value: number | null | undefined,
  locale?: string,
  fallback = '-',
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return formatExactCount(value, locale)
}
