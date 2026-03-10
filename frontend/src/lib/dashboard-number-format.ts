import { resolveLocale } from '@/lib/i18n-format'

const DASHBOARD_UNITS = ['', 'K', 'M', 'B', 'T'] as const
const DASHBOARD_FRACTION_DIGITS = 2

interface DashboardTrendTimestampOptions {
  locale?: string
  timeZone?: string
}

function normalizeDashboardNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function formatDashboardLocalizedNumber(value: number, locale?: string): string {
  return value.toLocaleString(resolveLocale(locale), {
    minimumFractionDigits: DASHBOARD_FRACTION_DIGITS,
    maximumFractionDigits: DASHBOARD_FRACTION_DIGITS,
  })
}

function formatDashboardCompactNumber(value: number, locale?: string): string {
  const normalized = normalizeDashboardNumber(value)
  const absoluteValue = Math.abs(normalized)

  if (absoluteValue < 1_000) {
    return formatDashboardLocalizedNumber(normalized, locale)
  }

  let unitIndex = Math.min(
    DASHBOARD_UNITS.length - 1,
    Math.floor(Math.log10(absoluteValue) / 3),
  )
  let scaledValue = normalized / (1000 ** unitIndex)
  let roundedValue = Number(scaledValue.toFixed(DASHBOARD_FRACTION_DIGITS))

  if (Math.abs(roundedValue) >= 1000 && unitIndex < DASHBOARD_UNITS.length - 1) {
    unitIndex += 1
    scaledValue = normalized / (1000 ** unitIndex)
    roundedValue = Number(scaledValue.toFixed(DASHBOARD_FRACTION_DIGITS))
  }

  return `${formatDashboardLocalizedNumber(roundedValue, locale)}${DASHBOARD_UNITS[unitIndex]}`
}

export function formatDashboardExactNumber(value: number, locale?: string): string {
  return formatDashboardLocalizedNumber(normalizeDashboardNumber(value), locale)
}

export function formatDashboardCount(value: number, locale?: string): string {
  return formatDashboardCompactNumber(value, locale)
}

export function formatDashboardMetric(value: number, locale?: string): string {
  return formatDashboardCompactNumber(value, locale)
}

export function formatDashboardTokenCount(value: number, locale?: string): string {
  return formatDashboardCompactNumber(value, locale)
}

export function formatDashboardTokenRate(value: number, locale?: string): string {
  return formatDashboardCompactNumber(value, locale)
}

export function formatDashboardDurationSeconds(value: number | null | undefined, locale?: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--'
  }

  return `${formatDashboardExactNumber(value, locale)}s`
}

export function formatDashboardTrendTimestampLabel(
  value: number | string,
  options: DashboardTrendTimestampOptions = {},
): string {
  const normalized = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(normalized)) {
    return String(value ?? '')
  }

  return new Intl.DateTimeFormat(resolveLocale(options.locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: options.timeZone,
  }).format(new Date(normalized))
}
