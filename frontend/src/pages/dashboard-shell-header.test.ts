/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const DASHBOARD_PATH = new URL('./Dashboard.tsx', import.meta.url)

test('Dashboard delegates its title block to the shell header', async () => {
  const source = await readFile(DASHBOARD_PATH, 'utf8')

  assert.match(
    source,
    /DockedPageIntro/,
    'Dashboard should use the shared DockedPageIntro primitive for shell header docking',
  )
  assert.match(
    source,
    /archetype="workspace"/,
    'Dashboard should keep a rich in-body page intro before docking it into the top bar',
  )
})
