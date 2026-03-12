/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

async function loadThreadsUtils() {
  try {
    return await import('./threads-utils.ts')
  } catch {
    return null
  }
}

test('initializeThreadsRenderer returns null when renderer creation fails or canvas is unavailable', async () => {
  const module = await loadThreadsUtils()

  assert.equal(
    typeof module?.initializeThreadsRenderer,
    'function',
    'expected initializeThreadsRenderer to be exported',
  )

  const { initializeThreadsRenderer } = module!

  assert.equal(
    initializeThreadsRenderer(() => {
      throw new Error('unable to create webgl context')
    }),
    null,
  )

  let clearColorCalled = false

  assert.equal(
    initializeThreadsRenderer(() => ({
      gl: {
        canvas: null,
        clearColor: () => {
          clearColorCalled = true
        },
      },
    })),
    null,
  )

  assert.equal(clearColorCalled, false)
})

test('initializeThreadsRenderer configures blend state when renderer is valid', async () => {
  const module = await loadThreadsUtils()

  assert.equal(
    typeof module?.initializeThreadsRenderer,
    'function',
    'expected initializeThreadsRenderer to be exported',
  )

  const { initializeThreadsRenderer } = module!
  const calls: string[] = []
  const renderer = {
      gl: {
        canvas: {},
        BLEND: 'blend',
        SRC_ALPHA: 'src',
        ONE_MINUS_SRC_ALPHA: 'dst',
        clearColor: () => {
          calls.push('clearColor')
        },
        enable: (value: string) => {
          calls.push(`enable:${value}`)
        },
        blendFunc: (src: string, dst: string) => {
          calls.push(`blendFunc:${src}:${dst}`)
        },
      },
    }

  assert.equal(initializeThreadsRenderer(() => renderer), renderer)
  assert.deepEqual(calls, ['clearColor', 'enable:blend', 'blendFunc:src:dst'])
})
