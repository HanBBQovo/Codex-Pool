/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

type PageExpectation = {
  relativePath: string
  requiredPatterns: RegExp[]
  forbiddenPatterns: RegExp[]
}

const PAGE_EXPECTATIONS: PageExpectation[] = [
  {
    relativePath: 'Config.tsx',
    requiredPatterns: [/import \{ notify \} from ['"]@\/lib\/notification['"]/],
    forbiddenPatterns: [
      /const \[message, setMessage\]/,
      /const \[error, setError\]/,
      /border-success-200/,
      /border-danger-200/,
    ],
  },
  {
    relativePath: 'Groups.tsx',
    requiredPatterns: [/import \{ notify \} from ['"]@\/lib\/notification['"]/],
    forbiddenPatterns: [
      /const \[error, setError\]/,
      /const \[notice, setNotice\]/,
      /<SurfaceNotice tone="danger">\{error\}<\/SurfaceNotice>/,
      /<SurfaceNotice tone="brand">\{notice\}<\/SurfaceNotice>/,
    ],
  },
  {
    relativePath: 'Login.tsx',
    requiredPatterns: [/import \{ notify \} from ['"]@\/lib\/notification['"]/],
    forbiddenPatterns: [
      /const \[errorMsg, setErrorMsg\]/,
      /<SurfaceNotice tone="danger" className="mb-4">/,
    ],
  },
  {
    relativePath: 'ImportJobs.tsx',
    requiredPatterns: [/import \{ notify \} from ['"]@\/lib\/notification['"]/],
    forbiddenPatterns: [
      /const uploadError = uploadMutation\.error/,
      /\{uploadError \? \(/,
    ],
  },
  {
    relativePath: 'ModelRouting.tsx',
    requiredPatterns: [/import \{ notify \} from ['"]@\/lib\/notification['"]/],
    forbiddenPatterns: [
      /const \[error, setError\]/,
      /const \[notice, setNotice\]/,
      /<SurfaceNotice tone="danger">\{error\}<\/SurfaceNotice>/,
      /<SurfaceNotice tone="success">\{notice\}<\/SurfaceNotice>/,
    ],
  },
  {
    relativePath: 'Proxies.tsx',
    requiredPatterns: [/import \{ notify \} from ['"]@\/lib\/notification['"]/],
    forbiddenPatterns: [
      /const \[message, setMessage\]/,
      /const \[error, setError\]/,
      /<SurfaceNotice tone="success">\{message\}<\/SurfaceNotice>/,
      /<SurfaceNotice tone="danger">\{error\}<\/SurfaceNotice>/,
    ],
  },
  {
    relativePath: 'Tenants.tsx',
    requiredPatterns: [/import \{ notify \} from ['"]@\/lib\/notification['"]/],
    forbiddenPatterns: [
      /const \[error, setError\]/,
      /const \[notice, setNotice\]/,
      /<SurfaceNotice tone="danger" role="status" aria-live="polite">/,
      /<SurfaceNotice tone="success" role="status" aria-live="polite">/,
    ],
  },
  {
    relativePath: '../tenant/TenantApp.tsx',
    requiredPatterns: [/import \{ notify \} from ['"]@\/lib\/notification['"]/],
    forbiddenPatterns: [
      /const \[error, setError\]/,
      /const \[notice, setNotice\]/,
      /SurfaceNotice/,
      /const statusNode =/,
    ],
  },
]

test('workbench mutation feedback pages use notify instead of top-level banners', async () => {
  for (const expectation of PAGE_EXPECTATIONS) {
    const source = await readFile(new URL(`./${expectation.relativePath}`, import.meta.url), 'utf8')

    for (const pattern of expectation.requiredPatterns) {
      assert.match(
        source,
        pattern,
        `${expectation.relativePath} should adopt the shared notify(...) feedback path`,
      )
    }

    for (const pattern of expectation.forbiddenPatterns) {
      assert.doesNotMatch(
        source,
        pattern,
        `${expectation.relativePath} should not keep page-level action feedback banners after adopting notify(...)`,
      )
    }
  }
})
