/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const ROOT = new URL('../', import.meta.url)

test('account signal heatmap summary exposes source split counts for compact mini charts', async () => {
  const source = await readFile(`${ROOT.pathname}api/accounts.ts`, 'utf8')

  assert.match(
    source,
    /active_counts:\s*number\[\]/,
    'AccountSignalHeatmapSummary should expose compact request-count buckets',
  )
  assert.match(
    source,
    /passive_counts:\s*number\[\]/,
    'AccountSignalHeatmapSummary should expose compact patrol-count buckets',
  )
})

test('Accounts passes source split counts into the compact recent-signal heatmap', async () => {
  const source = await readFile(`${ROOT.pathname}pages/Accounts.tsx`, 'utf8')

  assert.match(
    source,
    /activeCounts=\{heatmap\.active_counts\}/,
    'Accounts should pass request-count buckets into the compact recent-signal heatmap',
  )
  assert.match(
    source,
    /passiveCounts=\{heatmap\.passive_counts\}/,
    'Accounts should pass patrol-count buckets into the compact recent-signal heatmap',
  )
})

test('signal heatmap renderer draws a dedicated source accent and source legend', async () => {
  const source = await readFile(`${ROOT.pathname}features/accounts/signal-heatmap-canvas.tsx`, 'utf8')

  assert.match(
    source,
    /function drawSourceAccent/,
    'Signal heatmap renderer should draw a dedicated source accent on each bucket',
  )
  assert.match(
    source,
    /accountPool\.recentSignal\.legend\.request/,
    'Signal heatmap legend should label request-source accents',
  )
  assert.match(
    source,
    /accountPool\.recentSignal\.legend\.patrol/,
    'Signal heatmap legend should label patrol-source accents',
  )
})

test('SignalHeatmapMini falls back safely when legacy payloads omit source split arrays', async () => {
  const source = await readFile(`${ROOT.pathname}features/accounts/signal-heatmap-canvas.tsx`, 'utf8')

  assert.match(
    source,
    /\(activeCounts \?\? \[\]\)\.slice\(-visibleCount\)/,
    'SignalHeatmapMini should tolerate missing request-count buckets from stale payloads',
  )
  assert.match(
    source,
    /\(passiveCounts \?\? \[\]\)\.slice\(-visibleCount\)/,
    'SignalHeatmapMini should tolerate missing patrol-count buckets from stale payloads',
  )
})
