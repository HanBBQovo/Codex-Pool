/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  ModelDistributionPoint,
  TokenComponentSelection,
  TokenTrendChartPoint,
} from './dashboard-metrics.ts'

async function loadDashboardChartA11y() {
  return import('./dashboard-chart-a11y.ts')
}

test('buildTokenTrendA11yRows keeps enabled token series in display order', async () => {
  const module = await loadDashboardChartA11y()

  const selection: TokenComponentSelection = {
    input: true,
    cached: false,
    output: true,
    reasoning: true,
  }
  const points: TokenTrendChartPoint[] = [
    {
      timestamp: 1_710_000_000_000,
      hourStart: 1_710_000_000,
      requestCount: 12,
      inputTokens: 100,
      cachedInputTokens: 25,
      outputTokens: 50,
      reasoningTokens: 10,
      totalTokens: 185,
    },
    {
      timestamp: 1_710_003_600_000,
      hourStart: 1_710_003_600,
      requestCount: 9,
      inputTokens: 90,
      cachedInputTokens: 20,
      outputTokens: 40,
      reasoningTokens: 8,
      totalTokens: 158,
    },
  ]

  assert.deepEqual(module.getVisibleTokenComponentKeys(selection), ['input', 'output', 'reasoning'])
  assert.deepEqual(module.buildTokenTrendA11yRows(points, selection), [
    {
      timestamp: 1_710_000_000_000,
      values: [
        { key: 'input', value: 100 },
        { key: 'output', value: 50 },
        { key: 'reasoning', value: 10 },
      ],
    },
    {
      timestamp: 1_710_003_600_000,
      values: [
        { key: 'input', value: 90 },
        { key: 'output', value: 40 },
        { key: 'reasoning', value: 8 },
      ],
    },
  ])
})

test('summarizeModelDistribution reports visible rows and dominant series', async () => {
  const module = await loadDashboardChartA11y()

  const points: ModelDistributionPoint[] = [
    { model: 'gpt-4.1', value: 320, requestCount: 320, totalTokens: 8_200 },
    { model: 'gpt-4.1-mini', value: 180, requestCount: 180, totalTokens: 4_300 },
    { model: 'other', value: 75, requestCount: 75, totalTokens: 1_800 },
  ]

  assert.deepEqual(module.summarizeModelDistribution(points), {
    rowCount: 3,
    topLabel: 'gpt-4.1',
    topValue: 320,
    totalValue: 575,
  })
})
