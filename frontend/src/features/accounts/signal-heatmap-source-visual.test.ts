/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

async function loadSignalHeatmapVisuals() {
  return import('./signal-heatmap-source-visual.ts')
}

test('bucketSourceKind distinguishes request, patrol, mixed, and none buckets', async () => {
  const { bucketSourceKind } = await loadSignalHeatmapVisuals()

  assert.equal(bucketSourceKind(3, 0), 'request')
  assert.equal(bucketSourceKind(0, 2), 'patrol')
  assert.equal(bucketSourceKind(2, 1), 'mixed')
  assert.equal(bucketSourceKind(0, 0), 'none')
})

test('sourceAccentFill returns distinct accent fills for request and patrol buckets', async () => {
  const { sourceAccentFill } = await loadSignalHeatmapVisuals()

  const requestFill = sourceAccentFill('request', false)
  const patrolFill = sourceAccentFill('patrol', false)
  const mixedFill = sourceAccentFill('mixed', false)

  assert.notEqual(requestFill, patrolFill)
  assert.notEqual(requestFill, mixedFill)
  assert.notEqual(patrolFill, mixedFill)
})
