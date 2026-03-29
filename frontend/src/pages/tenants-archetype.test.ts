/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const TENANTS_PATH = new URL('./Tenants.tsx', import.meta.url)
const TENANT_USAGE_SECTION_PATH = new URL('../features/tenants/tenant-usage-section.tsx', import.meta.url)

test('Tenants dialog and usage section stay on the shared antigravity archetypes', async () => {
  const [tenantsSource, usageSource] = await Promise.all([
    readFile(TENANTS_PATH, 'utf8'),
    readFile(TENANT_USAGE_SECTION_PATH, 'utf8'),
  ])

  assert.doesNotMatch(
    tenantsSource,
    /POOL_ELEVATED_SECTION_CLASS_NAME|POOL_TABLE_CONTAINER_CLASS_NAME/,
    'Tenants page should not depend on old pool elevated sections or table containers',
  )
  assert.match(
    tenantsSource,
    /AntigravityDialogShell/,
    'Tenants profile dialog should use the shared antigravity dialog shell',
  )
  assert.doesNotMatch(
    usageSource,
    /POOL_ELEVATED_SECTION_CLASS_NAME|POOL_METRIC_CARD_CLASS_NAME/,
    'Tenant usage section should not depend on old pool section or metric card classes',
  )
  assert.match(tenantsSource, /DockedPageIntro/, 'Tenants should use DockedPageIntro as the page entry')
})
