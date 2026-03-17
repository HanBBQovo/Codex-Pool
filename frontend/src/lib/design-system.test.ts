/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveDesignLanguage, resolveSurfaceRecipe } from './design-system.ts'

test('resolveDesignLanguage returns a restrained mineral palette for light mode', () => {
  const language = resolveDesignLanguage('light')

  assert.equal(language.mode, 'light')
  assert.equal(language.palette.neutralFamily, 'graphite')
  assert.equal(language.palette.accentFamily, 'mineral-teal')
  assert.equal(language.radius.control, '14px')
  assert.equal(language.radius.panel, '24px')
  assert.equal(language.shadow.panel, 'soft')
  assert.equal(language.shadow.stage, 'lifted')
  assert.equal(language.density.controls, 'comfortable')
})

test('resolveDesignLanguage keeps the same visual family in dark mode without becoming neon', () => {
  const language = resolveDesignLanguage('dark')

  assert.equal(language.mode, 'dark')
  assert.equal(language.palette.neutralFamily, 'graphite')
  assert.equal(language.palette.accentFamily, 'mineral-teal')
  assert.equal(language.palette.canvasTone, 'deep')
  assert.equal(language.shadow.panel, 'deep-soft')
  assert.equal(language.shadow.stage, 'deep-lifted')
  assert.equal(language.density.panels, 'relaxed')
})

test('resolveDesignLanguage falls back to the light redesign baseline for unknown modes', () => {
  const language = resolveDesignLanguage('sepia')

  assert.equal(language.mode, 'light')
  assert.equal(language.palette.accentFamily, 'mineral-teal')
  assert.equal(language.radius.stage, '32px')
})

test('resolveSurfaceRecipe returns shared panel, muted panel, stage, and sidebar material recipes', () => {
  assert.deepEqual(resolveSurfaceRecipe('panel', 'light'), {
    kind: 'panel',
    emphasis: 'medium',
    border: 'defined',
    background: 'elevated',
    shadow: 'soft',
    temperature: 'neutral',
  })

  assert.deepEqual(resolveSurfaceRecipe('panel-muted', 'light'), {
    kind: 'panel-muted',
    emphasis: 'low',
    border: 'soft',
    background: 'subtle',
    shadow: 'softest',
    temperature: 'neutral',
  })

  assert.deepEqual(resolveSurfaceRecipe('stage', 'dark'), {
    kind: 'stage',
    emphasis: 'high',
    border: 'glow-edge',
    background: 'atmospheric',
    shadow: 'deep-lifted',
    temperature: 'cool',
  })

  assert.deepEqual(resolveSurfaceRecipe('sidebar', 'dark'), {
    kind: 'sidebar',
    emphasis: 'medium',
    border: 'soft',
    background: 'chrome',
    shadow: 'none',
    temperature: 'cool',
  })
})

test('resolveSurfaceRecipe keeps panel tiers restrained while giving stage and sidebar their own material role', () => {
  const panel = resolveSurfaceRecipe('panel', 'dark')
  const mutedPanel = resolveSurfaceRecipe('panel-muted', 'dark')
  const stage = resolveSurfaceRecipe('stage', 'light')
  const sidebar = resolveSurfaceRecipe('sidebar', 'light')

  assert.equal(panel.shadow, 'deep-soft')
  assert.equal(mutedPanel.shadow, 'softest')
  assert.equal(mutedPanel.emphasis, 'low')
  assert.equal(stage.emphasis, 'high')
  assert.equal(stage.temperature, 'cool')
  assert.equal(sidebar.background, 'chrome')
})
