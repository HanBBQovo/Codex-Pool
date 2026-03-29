import { formatDistanceToNow } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'

type SupportedLocale = typeof enUS

function resolveDateFnsLocale(language?: string): SupportedLocale {
  const normalized = (language || '').toLowerCase()
  if (normalized.startsWith('zh')) return zhCN
  return enUS
}

export function formatRelativeTime(
  value: Date | number | string,
  language?: string,
  addSuffix = true,
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }
  return formatDistanceToNow(date, {
    addSuffix,
    locale: resolveDateFnsLocale(language),
  })
}
