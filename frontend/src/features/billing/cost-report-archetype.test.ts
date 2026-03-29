/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const ADMIN_COST_REPORT_PATH = new URL('./admin-cost-report.tsx', import.meta.url)
const TENANT_COST_REPORT_PATH = new URL('./tenant-cost-report.tsx', import.meta.url)

test('cost report pages should keep the shared docked workbench intro and avoid legacy card wrappers', async () => {
  for (const fileUrl of [ADMIN_COST_REPORT_PATH, TENANT_COST_REPORT_PATH]) {
    const source = await readFile(fileUrl, 'utf8')

    assert.match(source, /DockedPageIntro/, 'Cost report pages should use DockedPageIntro')
    assert.match(source, /archetype="workspace"/, 'Cost report pages should keep the shared workbench archetype')
    assert.doesNotMatch(source, /components\/ui\/card/, 'Cost report pages should not depend on legacy Card wrapper surfaces')
    assert.doesNotMatch(source, /CardTitle>\{t\('costReports\.(admin|tenant)\.title'\)\}/, 'Cost report pages should not repeat the page title inside body panels')
  }
})
