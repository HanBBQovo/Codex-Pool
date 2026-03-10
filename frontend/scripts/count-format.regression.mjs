import assert from 'node:assert/strict'

import { formatExactCount, formatOptionalExactCount } from '../src/lib/count-number-format.ts'

assert.equal(formatExactCount(12_345, 'en-US'), '12,345')
assert.equal(formatExactCount(0, 'en-US'), '0')
assert.equal(formatExactCount(12_345.6, 'en-US'), '12,346')
assert.equal(formatOptionalExactCount(undefined, 'en-US'), '-')

console.log('count format regression checks passed')
