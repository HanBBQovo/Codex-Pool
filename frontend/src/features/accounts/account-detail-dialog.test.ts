/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const ACCOUNT_DETAIL_DIALOG_PATH = new URL('./account-detail-dialog.tsx', import.meta.url)

test('account detail dialog uses the shared antigravity dialog archetype', async () => {
  const source = await readFile(ACCOUNT_DETAIL_DIALOG_PATH, 'utf8')

  assert.match(
    source,
    /AntigravityDialogShell/,
    'account detail dialog should use the shared antigravity dialog shell',
  )
  assert.doesNotMatch(
    source,
    /DialogContent className=/,
    'account detail dialog should not keep a bespoke dialog shell class string',
  )
})
