import type { AdminTenantCreditLedgerItem } from '../../api/adminTenants.ts'
import type { SystemCapabilitiesResponse } from '../../api/types.ts'

export interface BillingTrendPoint {
  id: string
  event_type: string
  created_at: string
  consumed_microcredits: number
}

export function resolveActiveTenantId(
  tenants: Array<{ id: string }>,
  requestedTenantId?: string | null,
): string | null {
  if (requestedTenantId && tenants.some((tenant) => tenant.id === requestedTenantId)) {
    return requestedTenantId
  }
  return tenants[0]?.id ?? null
}

export function buildBillingTrendPoints(
  items: AdminTenantCreditLedgerItem[],
): BillingTrendPoint[] {
  return [...items]
    .filter((item) => item.delta_microcredits < 0)
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .map((item) => ({
      id: item.id,
      event_type: item.event_type,
      created_at: item.created_at,
      consumed_microcredits: Math.abs(item.delta_microcredits),
    }))
}

export function microcreditsToCredits(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }
  return value / 1_000_000
}

export function shouldUseCostReportBilling(
  capabilities: Pick<SystemCapabilitiesResponse, 'features'>,
): boolean {
  return !capabilities.features.credit_billing && capabilities.features.cost_reports
}
