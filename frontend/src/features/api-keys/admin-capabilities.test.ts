/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterAdminMenuGroupsByCapabilities,
  resolveAdminCapabilityRedirect,
  shouldShowStandaloneAdminApiKeys,
  STANDALONE_ADMIN_API_KEYS_PATH,
} from './admin-capabilities.ts'

const personalCapabilities = {
  features: {
    multi_tenant: false,
  },
}

const businessCapabilities = {
  features: {
    multi_tenant: true,
  },
}

test('standalone admin api keys only show in non-multi-tenant editions', () => {
  assert.equal(shouldShowStandaloneAdminApiKeys(personalCapabilities), true)
  assert.equal(shouldShowStandaloneAdminApiKeys(businessCapabilities), false)
})

test('capability redirects hide unsupported admin routes', () => {
  assert.equal(resolveAdminCapabilityRedirect('/tenants', personalCapabilities), '/dashboard')
  assert.equal(
    resolveAdminCapabilityRedirect(STANDALONE_ADMIN_API_KEYS_PATH, businessCapabilities),
    '/dashboard',
  )
  assert.equal(resolveAdminCapabilityRedirect('/dashboard', personalCapabilities), null)
})

test('menu groups filter out unsupported tenants and admin api key routes', () => {
  const groups = [
    {
      label: 'assets',
      items: [
        { path: '/dashboard' },
        { path: '/tenants' },
        { path: STANDALONE_ADMIN_API_KEYS_PATH },
      ],
    },
  ]

  assert.deepEqual(filterAdminMenuGroupsByCapabilities(groups, personalCapabilities), [
    {
      label: 'assets',
      items: [
        { path: '/dashboard' },
        { path: STANDALONE_ADMIN_API_KEYS_PATH },
      ],
    },
  ])

  assert.deepEqual(filterAdminMenuGroupsByCapabilities(groups, businessCapabilities), [
    {
      label: 'assets',
      items: [
        { path: '/dashboard' },
        { path: '/tenants' },
      ],
    },
  ])
})
