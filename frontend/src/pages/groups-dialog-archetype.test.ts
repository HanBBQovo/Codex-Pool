/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const GROUPS_PAGE_PATH = new URL('./Groups.tsx', import.meta.url)

test('groups editor dialog uses the shared antigravity dialog archetype', async () => {
  const source = await readFile(GROUPS_PAGE_PATH, 'utf8')

  assert.match(
    source,
    /AntigravityDialogShell/,
    'groups editor should use the shared antigravity dialog shell',
  )
  assert.doesNotMatch(
    source,
    /DialogContent className=/,
    'groups editor should not keep a bespoke dialog shell class string',
  )
})
