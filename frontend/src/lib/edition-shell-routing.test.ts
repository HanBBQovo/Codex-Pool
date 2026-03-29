/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAppShellTarget } from './edition-shell-routing.ts'
import type { SystemCapabilitiesResponse } from '../api/types.ts'

const personalCapabilities: SystemCapabilitiesResponse = {
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
}

const businessCapabilities: SystemCapabilitiesResponse = {
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
}

test('resolveAppShellTarget 仅在需要 capability 判定的初始路径上返回 loading', () => {
  assert.equal(resolveAppShellTarget('/admin-api-keys', undefined), 'loading')
  assert.equal(resolveAppShellTarget('/access-keys', undefined), 'loading')
  assert.equal(resolveAppShellTarget('/tenants', undefined), 'loading')
  assert.equal(resolveAppShellTarget('/tenant/dashboard', undefined), 'loading')
  assert.equal(resolveAppShellTarget('/dashboard', undefined), 'admin')
})

test('resolveAppShellTarget 只在 tenant_portal 开启时进入 tenant shell', () => {
  assert.equal(resolveAppShellTarget('/tenant/dashboard', businessCapabilities), 'tenant')
  assert.equal(resolveAppShellTarget('/tenant/auth/login', businessCapabilities), 'tenant')
  assert.equal(resolveAppShellTarget('/tenant/dashboard', personalCapabilities), 'admin')
  assert.equal(resolveAppShellTarget('/tenant/auth/login', personalCapabilities), 'admin')
  assert.equal(resolveAppShellTarget('/tenants', businessCapabilities), 'admin')
})

test('resolveAppShellTarget 在已知 capability 后将非 tenant 路径交给 admin shell', () => {
  assert.equal(resolveAppShellTarget('/admin-api-keys', personalCapabilities), 'admin')
  assert.equal(resolveAppShellTarget('/access-keys', personalCapabilities), 'admin')
  assert.equal(resolveAppShellTarget('/dashboard', businessCapabilities), 'admin')
})
