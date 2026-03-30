/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const ROOT = new URL('../', import.meta.url)

test('Accounts wires sticky table headers to local client-side sorting that survives refetches', async () => {
  const source = await readFile(`${ROOT.pathname}pages/Accounts.tsx`, 'utf8')

  assert.match(
    source,
    /sortAccountPoolRecords/,
    'Accounts should reuse the shared account-pool sorting helper',
  )
  assert.match(
    source,
    /sortDescriptor=\{sortDescriptor \?\? undefined\}/,
    'Accounts should keep the current sort descriptor on the HeroUI table',
  )
  assert.match(
    source,
    /onSortChange=\{\(descriptor\) => \{/,
    'Accounts should persist sort changes in local state instead of letting refetch reset ordering',
  )
  assert.match(
    source,
    /<TableColumn key="account" allowsSorting>/,
    'Accounts should make the account header clickable for sorting',
  )
  assert.match(
    source,
    /<TableColumn key="operationalStatus" allowsSorting>/,
    'Accounts should make the operational status header clickable for sorting',
  )
  assert.match(
    source,
    /<TableColumn key="quota" allowsSorting>/,
    'Accounts should make the quota header clickable for sorting',
  )
  assert.match(
    source,
    /<TableColumn key="recentSignal" allowsSorting>/,
    'Accounts should make the recent signal header clickable for sorting',
  )
})
