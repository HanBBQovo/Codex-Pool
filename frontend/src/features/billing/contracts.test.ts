/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  shouldUseCostReportBilling,
} from './contracts.ts'
import type { SystemCapabilitiesResponse } from '../../api/types.ts'

const costReportCapabilities: SystemCapabilitiesResponse = {
  edition: 'team',
  billing_mode: 'cost_report_only',
  features: {
    multi_tenant: true,
    tenant_portal: true,
    tenant_self_service: false,
    tenant_recharge: false,
    credit_billing: false,
    cost_reports: true,
  },
}

const creditBillingCapabilities: SystemCapabilitiesResponse = {
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

test('shouldUseCostReportBilling 在 cost_report_only edition 下返回 true', () => {
  assert.equal(shouldUseCostReportBilling(costReportCapabilities), true)
})

test('shouldUseCostReportBilling 在 credit billing 模式下返回 false', () => {
  assert.equal(shouldUseCostReportBilling(creditBillingCapabilities), false)
})
