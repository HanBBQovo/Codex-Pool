import type { TokenComponentKey } from './dashboard-metrics'

export const TOKEN_COMPONENT_CHART_COLORS: Record<TokenComponentKey, string> = {
  input: 'var(--chart-3)',
  cached: 'var(--chart-2)',
  output: 'var(--chart-1)',
  reasoning: 'var(--chart-5)',
}

export const MODEL_DISTRIBUTION_BAR_COLOR = 'var(--chart-1)'
