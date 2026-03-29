/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

async function readSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

test('accounts api exposes account-pool contract', async () => {
  const source = await readSource('./api/accounts.ts')
  assert.match(source, /export const accountPoolApi = \{/, 'should expose accountPoolApi')
  assert.match(source, /\/account-pool\/summary/, 'should call account-pool summary')
  assert.match(source, /\/account-pool\/accounts/, 'should call account-pool records')
  assert.match(source, /\/account-pool\/actions/, 'should call account-pool actions')
})

test('logs page uses unified event stream workbench', async () => {
  const source = await readSource('./pages/Logs.tsx')
  assert.match(source, /eventStreamApi/, 'Logs page should use eventStreamApi')
  assert.doesNotMatch(
    source,
    /title=\{t\(["']logs\.request\.title["']/,
    'Logs page should no longer be request-only workbench',
  )
})

test('import jobs page renders admission-aware workflow', async () => {
  const source = await readSource('./pages/ImportJobs.tsx')
  assert.match(source, /admission_counts/, 'ImportJobs should read admission_counts')
  assert.match(source, /admission_status/, 'ImportJobs should display item admission_status')
  assert.match(source, /failure_stage/, 'ImportJobs should display failure_stage')
})

test('dashboard page reads account pool summary', async () => {
  const source = await readSource('./pages/Dashboard.tsx')
  assert.match(source, /accountPoolApi/, 'Dashboard should request accountPoolApi')
  assert.match(source, /pending_delete/, 'Dashboard should expose pending_delete state')
})

test('app adds inventory compatibility route', async () => {
  const source = await readSource('./App.tsx')
  assert.match(source, /path="\/inventory"/, 'App should register /inventory route')
})

test('oauth probe remnants are removed from zh-CN and en locales', async () => {
  const zhSource = await readSource('./locales/zh-CN.ts')
  const enSource = await readSource('./locales/en.ts')

  assert.doesNotMatch(zhSource, /oauthProbe:/, 'zh-CN should not keep oauthProbe copy')
  assert.doesNotMatch(enSource, /oauthProbe:/, 'en should not keep oauthProbe copy')
})
