/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const APP_LAYOUT_PATH = new URL('./AppLayout.tsx', import.meta.url)
const APP_PATH = new URL('../../App.tsx', import.meta.url)

test('app chrome exposes drawer placement preferences from the UI preferences layer', async () => {
  const [layoutSource, appSource] = await Promise.all([
    readFile(APP_LAYOUT_PATH, 'utf8'),
    readFile(APP_PATH, 'utf8'),
  ])

  assert.match(
    layoutSource,
    /useUiPreferences|setDrawerPlacement/,
    'AppLayout should read and update drawer placement preferences',
  )
  assert.match(
    layoutSource,
    /bottom|right|left|top/,
    'AppLayout should expose the supported drawer placement options',
  )
  assert.match(
    appSource,
    /UiPreferencesProvider/,
    'App should mount the UI preferences provider near the app shell',
  )
})
