/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const DIALOG_ARCHETYPES_PATH = new URL('./dialog-archetypes.tsx', import.meta.url)

test('antigravity dialog archetypes provide one shared HeroUI-backed shell', async () => {
  const source = await readFile(DIALOG_ARCHETYPES_PATH, 'utf8')

  assert.match(source, /AntigravityDialogShell/, 'dialog archetype should export AntigravityDialogShell')
  assert.match(
    source,
    /AntigravityDialogSize = 'sm' \| 'lg' \| 'xl'[\s\S]*size\?: AntigravityDialogSize/,
    'dialog shell should expose size presets',
  )
  assert.match(source, /DialogContent/, 'dialog shell should compose the shared HeroUI dialog wrapper')
  assert.match(source, /PagePanel|page-panel-surface/, 'dialog shell should reuse antigravity surfaces')
})
