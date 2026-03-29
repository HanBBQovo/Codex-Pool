/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const DIALOG_PATH = new URL('./dialog.tsx', import.meta.url)

test('shared dialog shell is backed by HeroUI Drawer and UI preferences', async () => {
  const source = await readFile(DIALOG_PATH, 'utf8')

  assert.match(source, /Drawer/, 'shared dialog should import HeroUI Drawer')
  assert.match(
    source,
    /useUiPreferences|drawerPlacement/,
    'shared dialog should read drawer placement from UI preferences',
  )
  assert.doesNotMatch(source, /<Modal\b|ModalContent/, 'shared dialog should no longer use HeroUI Modal')
})
