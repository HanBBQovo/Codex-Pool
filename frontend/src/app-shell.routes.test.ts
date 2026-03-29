/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const APP_PATH = new URL('./App.tsx', import.meta.url)
const APP_LAYOUT_PATH = new URL('./components/layout/AppLayout.tsx', import.meta.url)

test('admin app registers the oauth import route', async () => {
  const source = await readFile(APP_PATH, 'utf8')
  assert.match(source, /oauth-import/)
})

test('app shell registers tenant shell routing and tenant app entry', async () => {
  const source = await readFile(APP_PATH, 'utf8')
  assert.match(source, /resolveAppShellTarget/)
  assert.match(source, /TenantApp/)
  assert.match(source, /tenant/)
})

test('admin app layout includes the oauth import navigation entry', async () => {
  const source = await readFile(APP_LAYOUT_PATH, 'utf8')
  assert.match(source, /oauth-import/)
})
