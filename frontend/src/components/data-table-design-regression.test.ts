/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const DATA_TABLE_PATH = new URL('./DataTable.tsx', import.meta.url)

test('DataTable keeps the original floating header and horizontal scroll affordance', async () => {
  const source = await readFile(DATA_TABLE_PATH, 'utf8')

  assert.match(source, /isHeaderSticky/, 'DataTable should keep sticky header behavior')
  assert.match(
    source,
    /first:rounded-s-lg last:rounded-e-lg/,
    'DataTable should keep the original floating rounded header style',
  )
  assert.match(
    source,
    /overflow-x-auto/,
    'DataTable should provide horizontal scrolling for wide tables',
  )
})
