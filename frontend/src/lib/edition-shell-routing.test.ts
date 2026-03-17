/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAppShellTarget } from './edition-shell-routing.ts'

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

test('resolveAppShellTarget only blocks when the initial path needs capability gating to avoid a wrong first render', () => {
  assert.equal(resolveAppShellTarget('/api-keys', undefined), 'loading')
  assert.equal(resolveAppShellTarget('/access-keys', undefined), 'loading')
  assert.equal(resolveAppShellTarget('/tenants', undefined), 'loading')
  assert.equal(resolveAppShellTarget('/dashboard', undefined), 'admin')
})

test('resolveAppShellTarget enters tenant app only when the tenant portal capability is enabled', () => {
  assert.equal(resolveAppShellTarget('/tenant/dashboard', businessCapabilities), 'tenant')
  assert.equal(resolveAppShellTarget('/tenant/dashboard', personalCapabilities), 'admin')
})

test('resolveAppShellTarget routes non-tenant paths to the admin shell once capabilities are known', () => {
  assert.equal(resolveAppShellTarget('/api-keys', personalCapabilities), 'admin')
  assert.equal(resolveAppShellTarget('/access-keys', personalCapabilities), 'admin')
  assert.equal(resolveAppShellTarget('/dashboard', businessCapabilities), 'admin')
})
