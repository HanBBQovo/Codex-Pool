import type {
  ModelDistributionPoint,
  TokenComponentKey,
  TokenComponentSelection,
  TokenTrendChartPoint,
} from './dashboard-metrics'

const TOKEN_COMPONENT_ORDER: TokenComponentKey[] = ['input', 'cached', 'output', 'reasoning']

const TOKEN_COMPONENT_VALUE_ACCESSORS: Record<
  TokenComponentKey,
  (point: TokenTrendChartPoint) => number
> = {
  input: (point) => point.inputTokens,
  cached: (point) => point.cachedInputTokens,
  output: (point) => point.outputTokens,
  reasoning: (point) => point.reasoningTokens,
}

export interface TokenTrendA11yRow {
  timestamp: number
  values: Array<{
    key: TokenComponentKey
    value: number
  }>
}

export interface TokenTrendA11ySummary {
  rowCount: number
  startTimestamp: number | null
  endTimestamp: number | null
}

export interface ModelDistributionA11ySummary {
  rowCount: number
  topLabel: string | null
  topValue: number
  totalValue: number
}

export function getVisibleTokenComponentKeys(
  selection: TokenComponentSelection,
): TokenComponentKey[] {
  return TOKEN_COMPONENT_ORDER.filter((key) => selection[key])
}

export function buildTokenTrendA11yRows(
  points: TokenTrendChartPoint[],
  selection: TokenComponentSelection,
): TokenTrendA11yRow[] {
  const visibleKeys = getVisibleTokenComponentKeys(selection)

  return points.map((point) => ({
    timestamp: point.timestamp,
    values: visibleKeys.map((key) => ({
      key,
      value: TOKEN_COMPONENT_VALUE_ACCESSORS[key](point),
    })),
  }))
}

export function summarizeTokenTrendRows(rows: TokenTrendA11yRow[]): TokenTrendA11ySummary {
  if (rows.length === 0) {
    return {
      rowCount: 0,
      startTimestamp: null,
      endTimestamp: null,
    }
  }

  return {
    rowCount: rows.length,
    startTimestamp: rows[0]?.timestamp ?? null,
    endTimestamp: rows[rows.length - 1]?.timestamp ?? null,
  }
}

export function summarizeModelDistribution(
  points: ModelDistributionPoint[],
): ModelDistributionA11ySummary {
  if (points.length === 0) {
    return {
      rowCount: 0,
      topLabel: null,
      topValue: 0,
      totalValue: 0,
    }
  }

  const [first, ...rest] = points
  const totalValue = rest.reduce((sum, point) => sum + point.value, first.value)

  return {
    rowCount: points.length,
    topLabel: first.model,
    topValue: first.value,
    totalValue,
  }
}
