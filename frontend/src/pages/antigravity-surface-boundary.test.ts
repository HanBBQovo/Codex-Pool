/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const TARGET_PATHS = [
  new URL('./Accounts.tsx', import.meta.url),
  new URL('./AdminApiKeys.tsx', import.meta.url),
  new URL('./Groups.tsx', import.meta.url),
  new URL('./ModelRouting.tsx', import.meta.url),
  new URL('./OAuthImport.tsx', import.meta.url),
  new URL('./Tenants.tsx', import.meta.url),
  new URL('../features/accounts/account-detail-dialog.tsx', import.meta.url),
  new URL('../features/tenants/tenant-usage-section.tsx', import.meta.url),
  new URL('../tenant/TenantApp.tsx', import.meta.url),
  new URL('../tenant/pages/BillingPage.tsx', import.meta.url),
  new URL('../tenant/pages/DashboardPage.tsx', import.meta.url),
  new URL('../tenant/pages/LogsPage.tsx', import.meta.url),
  new URL('../tenant/pages/UsagePage.tsx', import.meta.url),
]

test('target antigravity surfaces do not regress to old containers or deleted tables', async () => {
  for (const path of TARGET_PATHS) {
    const source = await readFile(path, 'utf8')

    assert.doesNotMatch(
      source,
      /POOL_SECTION_CLASS_NAME|POOL_ELEVATED_SECTION_CLASS_NAME|POOL_TABLE_CONTAINER_CLASS_NAME|POOL_METRIC_CARD_CLASS_NAME/,
      `${path.pathname} should not depend on old pool section containers`,
    )
    assert.doesNotMatch(
      source,
      /standard-data-table|components\/ui\/table/,
      `${path.pathname} should not depend on deleted table implementations`,
    )
    assert.doesNotMatch(
      source,
      /DialogContent className=/,
      `${path.pathname} should not hand-roll a dialog shell with DialogContent className`,
    )
  }
})
