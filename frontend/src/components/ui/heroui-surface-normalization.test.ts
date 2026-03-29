/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const ROOT = new URL('../../', import.meta.url)

const SHARED_SURFACE_FILES = [
  'components/ui/card.tsx',
  'components/ui/dialog.tsx',
  'components/layout/dialog-archetypes.tsx',
  'components/layout/page-archetypes.tsx',
] as const

const DRAWER_SURFACE_FILES = [
  'pages/Groups.tsx',
  'pages/ModelRouting.tsx',
  'pages/Tenants.tsx',
  'features/accounts/account-detail-dialog.tsx',
] as const

const HEROUI_NORMALIZED_FILES = [
  'pages/AdminApiKeys.tsx',
  'pages/Accounts.tsx',
  'pages/OAuthImport.tsx',
  'features/billing/admin-cost-report.tsx',
  'features/billing/tenant-cost-report.tsx',
  'tenant/pages/ApiKeysPage.tsx',
  'tenant/pages/UsagePage.tsx',
  'tenant/pages/BillingPage.tsx',
  'tenant/TenantApp.tsx',
  'features/import-jobs/panels.tsx',
] as const

test('shared HeroUI surfaces avoid arbitrary visual values', async () => {
  const sources = await Promise.all(
    SHARED_SURFACE_FILES.map(async (relativePath) => ({
      relativePath,
      source: await readFile(new URL(relativePath, ROOT), 'utf8'),
    })),
  )

  for (const { relativePath, source } of sources) {
    assert.doesNotMatch(
      source,
      /rounded-\[/,
      `${relativePath} should not hard-code arbitrary rounded values`,
    )
    assert.doesNotMatch(
      source,
      /shadow-\[/,
      `${relativePath} should not hard-code arbitrary shadow values`,
    )
  }
})

test('high-traffic drawer pages depend on shared HeroUI surface primitives', async () => {
  const sources = await Promise.all(
    DRAWER_SURFACE_FILES.map(async (relativePath) => ({
      relativePath,
      source: await readFile(new URL(relativePath, ROOT), 'utf8'),
    })),
  )

  for (const { relativePath, source } of sources) {
    assert.match(
      source,
      /@\/components\/ui\/surface/,
      `${relativePath} should import shared HeroUI surface primitives`,
    )
    assert.doesNotMatch(
      source,
      /rounded-\[/,
      `${relativePath} should not keep arbitrary rounded values inside drawers`,
    )
    assert.doesNotMatch(
      source,
      /(?:^|[\s"'`])border(?!-)/,
      `${relativePath} should not keep naked border classes inside drawers`,
    )
    assert.doesNotMatch(
      source,
      /shadow-\[/,
      `${relativePath} should not keep arbitrary shadow values inside drawers`,
    )
  }
})

test('remaining shared pages avoid arbitrary and slate-specific surface styling', async () => {
  const sources = await Promise.all(
    HEROUI_NORMALIZED_FILES.map(async (relativePath) => ({
      relativePath,
      source: await readFile(new URL(relativePath, ROOT), 'utf8'),
    })),
  )

  for (const { relativePath, source } of sources) {
    assert.doesNotMatch(
      source,
      /rounded-\[/,
      `${relativePath} should not keep arbitrary rounded values`,
    )
    assert.doesNotMatch(
      source,
      /shadow-\[/,
      `${relativePath} should not keep arbitrary shadow values`,
    )
    assert.doesNotMatch(
      source,
      /slate-/,
      `${relativePath} should not keep slate-specific colors outside HeroUI tokens`,
    )
  }
})

test('legacy pool surface constants are removed', async () => {
  await assert.rejects(readFile(new URL('../../lib/pool-styles.ts', ROOT), 'utf8'))
})
