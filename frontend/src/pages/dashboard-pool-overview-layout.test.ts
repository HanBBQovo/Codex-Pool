/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const DASHBOARD_PATH = new URL('./Dashboard.tsx', import.meta.url)

test('Dashboard keeps account pool distribution in a compact summary strip instead of a standalone donut rail', async () => {
  const source = await readFile(DASHBOARD_PATH, 'utf8')

  assert.doesNotMatch(
    source,
    /PoolArcChart/,
    'Dashboard should not keep a standalone donut chart in the account pool overview section',
  )
  assert.doesNotMatch(
    source,
    /lg:w-\[120px\]/,
    'Dashboard should not reserve a fixed-width left rail for the pool overview chart',
  )
})
