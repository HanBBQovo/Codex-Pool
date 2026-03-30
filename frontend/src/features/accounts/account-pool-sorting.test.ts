/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import type { AccountPoolRecord } from '@/api/accounts'

async function loadAccountPoolSorting() {
  return import('./account-pool-sorting.ts')
}

function createRecord(
  id: string,
  overrides: Partial<AccountPoolRecord> = {},
): AccountPoolRecord {
  return {
    id,
    record_scope: 'runtime',
    operator_state: 'routable',
    health_freshness: 'fresh',
    reason_class: 'healthy',
    route_eligible: true,
    label: id,
    has_refresh_credential: true,
    has_access_token_fallback: false,
    rate_limits: [],
    created_at: '2026-03-30T00:00:00Z',
    updated_at: '2026-03-30T00:00:00Z',
    ...overrides,
  }
}

test('default account pool sort keeps operator-state grouping but ignores patrol recency as traffic activity', async () => {
  const { sortAccountPoolRecords } = await loadAccountPoolSorting()
  const records = [
    createRecord('routable-patrol', {
      label: 'Zulu patrol',
      operator_state: 'routable',
      last_signal_at: '2026-03-30T10:00:00Z',
      last_signal_source: 'active',
      updated_at: '2026-03-30T10:00:00Z',
    }),
    createRecord('cooling-request', {
      label: 'Cooling request',
      operator_state: 'cooling',
      reason_class: 'quota',
      route_eligible: false,
      last_signal_at: '2026-03-30T11:00:00Z',
      last_signal_source: 'passive',
      updated_at: '2026-03-30T11:00:00Z',
    }),
    createRecord('routable-request-older', {
      label: 'Alpha request older',
      operator_state: 'routable',
      last_signal_at: '2026-03-30T09:00:00Z',
      last_signal_source: 'passive',
      updated_at: '2026-03-30T09:00:00Z',
    }),
    createRecord('routable-request-newer', {
      label: 'Bravo request newer',
      operator_state: 'routable',
      last_signal_at: '2026-03-30T09:30:00Z',
      last_signal_source: 'passive',
      updated_at: '2026-03-30T09:30:00Z',
    }),
    createRecord('inventory-idle', {
      label: 'Inventory idle',
      operator_state: 'inventory',
      record_scope: 'inventory',
      route_eligible: false,
      updated_at: '2026-03-29T22:00:00Z',
    }),
  ]

  const sorted = sortAccountPoolRecords(records)

  assert.deepEqual(sorted.map((item) => item.id), [
    'routable-request-newer',
    'routable-request-older',
    'routable-patrol',
    'cooling-request',
    'inventory-idle',
  ])
})

test('account pool sort supports account label sorting from the table header', async () => {
  const { sortAccountPoolRecords } = await loadAccountPoolSorting()
  const descriptor = {
    column: 'account',
    direction: 'ascending',
  } as const
  const records = [
    createRecord('gamma', { label: 'Gamma' }),
    createRecord('alpha', { label: 'Alpha' }),
    createRecord('beta', { label: 'Beta' }),
  ]

  const sorted = sortAccountPoolRecords(records, descriptor)

  assert.deepEqual(sorted.map((item) => item.label), ['Alpha', 'Beta', 'Gamma'])
})

test('account pool sort supports quota sorting by the tightest remaining window', async () => {
  const { sortAccountPoolRecords } = await loadAccountPoolSorting()
  const descriptor = {
    column: 'quota',
    direction: 'ascending',
  } as const
  const records = [
    createRecord('healthy-roomy', {
      rate_limits: [
        {
          limit_id: 'five-hours',
          limit_name: '5h',
          primary: { used_percent: 15, resets_at: '2026-03-31T00:00:00Z' },
        },
      ],
    }),
    createRecord('healthy-tight', {
      rate_limits: [
        {
          limit_id: 'five-hours',
          limit_name: '5h',
          primary: { used_percent: 82, resets_at: '2026-03-31T00:00:00Z' },
        },
      ],
    }),
    createRecord('unknown', {
      rate_limits: [],
    }),
  ]

  const sorted = sortAccountPoolRecords(records, descriptor)

  assert.deepEqual(sorted.map((item) => item.id), ['healthy-tight', 'healthy-roomy', 'unknown'])
})

test('recent signal sorting prefers real request traffic over newer patrol noise', async () => {
  const { sortAccountPoolRecords } = await loadAccountPoolSorting()
  const descriptor = {
    column: 'recentSignal',
    direction: 'descending',
  } as const
  const records = [
    createRecord('patrol-now', {
      label: 'Patrol now',
      last_signal_at: '2026-03-30T10:00:00Z',
      last_signal_source: 'active',
      updated_at: '2026-03-30T10:00:00Z',
    }),
    createRecord('request-earlier', {
      label: 'Request earlier',
      last_signal_at: '2026-03-30T09:00:00Z',
      last_signal_source: 'passive',
      updated_at: '2026-03-30T09:00:00Z',
    }),
    createRecord('request-newer', {
      label: 'Request newer',
      last_signal_at: '2026-03-30T09:30:00Z',
      last_signal_source: 'passive',
      updated_at: '2026-03-30T09:30:00Z',
    }),
  ]

  const sorted = sortAccountPoolRecords(records, descriptor)

  assert.deepEqual(sorted.map((item) => item.id), [
    'request-newer',
    'request-earlier',
    'patrol-now',
  ])
})
