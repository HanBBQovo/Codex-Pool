/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterAdminMenuGroupsByCapabilities,
  shouldShowStandaloneAdminApiKeys,
} from './admin-capabilities.ts'

const personalCapabilities = {
  edition: 'personal',
  billing_mode: 'cost_report_only',
  features: {
    multi_tenant: false,
    tenant_portal: false,
    tenant_self_service: false,
    tenant_recharge: false,
    credit_billing: false,
    cost_reports: true,
  },
} as const

const businessCapabilities = {
  edition: 'business',
  billing_mode: 'credit_enforced',
  features: {
    multi_tenant: true,
    tenant_portal: true,
    tenant_self_service: true,
    tenant_recharge: true,
    credit_billing: true,
    cost_reports: true,
  },
} as const

const baseGroups = [
  {
    label: 'assets',
    items: [
      { path: '/accounts' },
      { path: '/tenants' },
      { path: '/api-keys' },
    ],
  },
  {
    label: 'operations',
    items: [{ path: '/groups' }],
  },
]

test('shouldShowStandaloneAdminApiKeys only enables the standalone page for personal-style single-tenant admin', () => {
  assert.equal(shouldShowStandaloneAdminApiKeys(personalCapabilities), true)
  assert.equal(shouldShowStandaloneAdminApiKeys(businessCapabilities), false)
  assert.equal(shouldShowStandaloneAdminApiKeys(undefined), false)
})

test('filterAdminMenuGroupsByCapabilities swaps tenants navigation for api keys in personal edition', () => {
  const personalGroups = filterAdminMenuGroupsByCapabilities(baseGroups, personalCapabilities)
  const businessGroups = filterAdminMenuGroupsByCapabilities(baseGroups, businessCapabilities)

  assert.deepEqual(
    personalGroups.flatMap((group) => group.items.map((item) => item.path)),
    ['/accounts', '/api-keys', '/groups'],
  )

  assert.deepEqual(
    businessGroups.flatMap((group) => group.items.map((item) => item.path)),
    ['/accounts', '/tenants', '/groups'],
  )
})
