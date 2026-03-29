/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const LOGS_PAGE_PATH = new URL('./Logs.tsx', import.meta.url)

test('Logs top summary layout should not stretch the KPI rail to match the insights column', async () => {
  const source = await readFile(LOGS_PAGE_PATH, 'utf8')

  assert.match(
    source,
    /xl:items-start/,
    'Logs should align the top summary and insights cards at the start instead of stretching them to equal height',
  )
  assert.match(
    source,
    /xl:self-start/,
    'Logs should keep the summary card anchored to its own content height on wide screens',
  )
  assert.match(
    source,
    /sm:grid-cols-2 xl:grid-cols-2/,
    'Logs should render the KPI rail as a balanced two-column grid on wide screens',
  )
  assert.doesNotMatch(
    source,
    /sm:grid-cols-2 xl:grid-cols-4/,
    'Logs should not regress to the narrow four-column KPI rail that caused stretched cards',
  )
})
