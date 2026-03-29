/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const PAGE_ARCHETYPES_PATH = new URL('./page-archetypes.tsx', import.meta.url)

test('shared page intro exposes a docked variant and uses the Usage title scale as the default standard', async () => {
  const source = await readFile(PAGE_ARCHETYPES_PATH, 'utf8')

  assert.match(
    source,
    /export function DockedPageIntro/,
    'page archetypes should expose a shared docked page intro primitive',
  )
  assert.match(
    source,
    /text-2xl font-bold tracking-tight text-foreground/,
    'default page titles should use the Usage page scale as the standard size',
  )
  assert.match(
    source,
    /text-sm leading-6 text-default-500/,
    'default page subtitles should use the Usage page subtitle scale',
  )
})
