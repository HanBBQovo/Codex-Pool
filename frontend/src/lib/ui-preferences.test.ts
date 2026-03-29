/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_DRAWER_PLACEMENT,
  readStoredDrawerPlacement,
  type DrawerPlacement,
} from './ui-preferences.ts'

test('drawer placement defaults to bottom', () => {
  assert.equal(DEFAULT_DRAWER_PLACEMENT, 'bottom')
})

test('drawer placement reader only accepts supported values', () => {
  const validPlacements: DrawerPlacement[] = ['bottom', 'right', 'left', 'top']

  for (const placement of validPlacements) {
    assert.equal(readStoredDrawerPlacement(placement, 'bottom'), placement)
  }

  assert.equal(readStoredDrawerPlacement('center', 'bottom'), 'bottom')
  assert.equal(readStoredDrawerPlacement('', 'right'), 'right')
  assert.equal(readStoredDrawerPlacement(null, 'left'), 'left')
  assert.equal(readStoredDrawerPlacement(undefined, 'top'), 'top')
})
