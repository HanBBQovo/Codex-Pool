/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveFeedbackMotion,
  resolvePageEnterMotion,
  resolvePanelRevealMotion,
} from './motion-presets.ts'

test('resolvePageEnterMotion returns a short non-bouncy page transition', () => {
  const motion = resolvePageEnterMotion(false)

  assert.deepEqual(motion.initial, { opacity: 0, y: 18 })
  assert.deepEqual(motion.animate, { opacity: 1, y: 0 })
  assert.deepEqual(motion.exit, { opacity: 0, y: 12 })
  assert.deepEqual(motion.transition.ease, [0.16, 1, 0.3, 1])
  assert.equal(motion.transition.duration, 0.34)
})

test('resolvePanelRevealMotion returns a restrained reveal suited for panels and staged auth content', () => {
  const motion = resolvePanelRevealMotion(false)

  assert.equal(motion.distance, 24)
  assert.equal(motion.duration, 0.3)
  assert.equal(motion.ease, 'power3.out')
  assert.equal(motion.initialOpacity, 0)
  assert.equal(motion.scale, 0.985)
})

test('resolveFeedbackMotion and reduced-motion variants keep state visible without directional travel', () => {
  const feedback = resolveFeedbackMotion(false)
  const reducedPage = resolvePageEnterMotion(true)
  const reducedPanel = resolvePanelRevealMotion(true)

  assert.deepEqual(feedback.initial, { opacity: 0, scale: 0.985 })
  assert.deepEqual(feedback.animate, { opacity: 1, scale: 1 })
  assert.deepEqual(feedback.exit, { opacity: 0, scale: 0.99 })
  assert.equal(feedback.transition.duration, 0.24)

  assert.deepEqual(reducedPage.initial, { opacity: 0, y: 0 })
  assert.deepEqual(reducedPage.exit, { opacity: 0, y: 0 })
  assert.equal(reducedPage.transition.duration, 0.16)

  assert.equal(reducedPanel.distance, 0)
  assert.equal(reducedPanel.duration, 0.16)
  assert.equal(reducedPanel.scale, 1)
})
