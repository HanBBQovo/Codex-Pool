interface FormatDurationOptions {
  locale?: string;
  fallback?: string;
}

function normalizeDurationLocale(locale?: string): string | undefined {
  const explicitLocale = locale?.trim();
  return explicitLocale || undefined;
}

export function formatDurationMs(
  value: number | undefined,
  options: FormatDurationOptions = {},
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return options.fallback ?? "-";
  }

  const locale = normalizeDurationLocale(options.locale);

  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}s`;
  }

  return `${value.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}ms`;
}
