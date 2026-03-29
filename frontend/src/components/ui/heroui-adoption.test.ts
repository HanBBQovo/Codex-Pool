/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const COMPONENT_PATHS = [
  new URL('../DataTable.tsx', import.meta.url),
  new URL('./input.tsx', import.meta.url),
  new URL('./badge.tsx', import.meta.url),
  new URL('./card.tsx', import.meta.url),
  new URL('./checkbox.tsx', import.meta.url),
  new URL('./textarea.tsx', import.meta.url),
  new URL('./select.tsx', import.meta.url),
  new URL('./dialog.tsx', import.meta.url),
  new URL('./alert-dialog.tsx', import.meta.url),
  new URL('./dropdown-menu.tsx', import.meta.url),
  new URL('./accessible-tabs.tsx', import.meta.url),
]

test('restored ui wrappers are backed by HeroUI', async () => {
  for (const path of COMPONENT_PATHS) {
    const source = await readFile(path, 'utf8')
    assert.match(source, /@heroui\/react/, `${path.pathname} should import HeroUI`)
  }
})
