import assert from 'node:assert/strict'

import {
  formatDashboardExactNumber,
  formatDashboardMetric,
  formatDashboardTokenCount,
  formatDashboardTokenRate,
  formatDashboardTrendTimestampLabel,
} from '../src/lib/dashboard-number-format.ts'

assert.equal(formatDashboardMetric(999, 'en-US'), '999.00')
assert.equal(formatDashboardMetric(12_345, 'en-US'), '12.35K')
assert.equal(formatDashboardMetric(999_995, 'en-US'), '1.00M')

assert.equal(formatDashboardTokenCount(12_500, 'en-US'), '12.50K')
assert.equal(formatDashboardTokenCount(1_250_000, 'en-US'), '1.25M')
assert.equal(formatDashboardTokenRate(1_234_567_890, 'en-US'), '1.23B')

assert.equal(formatDashboardExactNumber(12_345, 'en-US'), '12,345.00')
assert.equal(
  formatDashboardTrendTimestampLabel('1710000000000', { locale: 'en-US', timeZone: 'UTC' }),
  '03/09/2024, 16:00',
)

console.log('dashboard number regression checks passed')
