/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import * as pageArchetypes from './page-archetypes.ts'

import {
  describeAuthShellLayout,
  describeDashboardOverviewLayout,
  describeDashboardShellLayout,
  describePageRegions,
  resolvePageArchetype,
  type PageArchetype,
} from './page-archetypes.ts'

test('resolvePageArchetype gives auth a controlled single-workspace posture instead of a showcase split', () => {
  const archetype = resolvePageArchetype('auth')

  assert.equal(archetype.name, 'auth')
  assert.equal(archetype.introStyle, 'compact')
  assert.equal(archetype.headerSurface, 'plain')
  assert.equal(archetype.stageMode, 'inline')
  assert.equal(archetype.primaryZone, 'form')
  assert.equal(archetype.effectProfile, 'controlled')
  assert.equal(archetype.surfaceTone, 'framed')
  assert.equal(archetype.mobile.stageCompression, 'condense')
  assert.equal(archetype.mobile.primaryFirst, true)
})

test('resolvePageArchetype keeps workspace compact, quiet, and task-first', () => {
  const archetype = resolvePageArchetype('workspace')

  assert.equal(archetype.name, 'workspace')
  assert.equal(archetype.introStyle, 'compact')
  assert.equal(archetype.headerSurface, 'plain')
  assert.equal(archetype.primaryZone, 'task')
  assert.equal(archetype.secondaryDensity, 'summary-first')
  assert.equal(archetype.surfaceTone, 'quiet')
  assert.equal(archetype.stageMode, 'none')
  assert.equal(archetype.mobile.primaryFirst, true)
  assert.equal(archetype.mobile.stageCompression, 'hide')
})

test('resolvePageArchetype keeps dashboard continuous and non-theatrical', () => {
  const archetype = resolvePageArchetype('dashboard')

  assert.equal(archetype.name, 'dashboard')
  assert.equal(archetype.introStyle, 'compact')
  assert.equal(archetype.headerSurface, 'plain')
  assert.equal(archetype.stageMode, 'none')
  assert.equal(archetype.surfaceTone, 'continuous')
  assert.equal(archetype.secondaryDensity, 'balanced')
  assert.equal(archetype.effectProfile, 'restrained')
})

test('resolvePageArchetype falls back to settings for unknown variants', () => {
  const archetype = resolvePageArchetype('unknown' as PageArchetype)

  assert.equal(archetype.name, 'settings')
  assert.equal(archetype.introStyle, 'compact')
  assert.equal(archetype.headerSurface, 'plain')
  assert.equal(archetype.primaryZone, 'content')
  assert.equal(archetype.effectProfile, 'none')
  assert.equal(archetype.surfaceTone, 'quiet')
  assert.equal(archetype.mobile.primaryFirst, true)
})

test('describePageRegions keeps auth singular, dashboard attached, and workspace summary after the main task', () => {
  assert.deepEqual(describePageRegions('auth'), {
    introAlignment: 'start',
    contentLayout: 'stack',
    secondaryPlacement: 'after',
    stageEmphasis: 'controlled',
  })

  assert.deepEqual(describePageRegions('dashboard'), {
    introAlignment: 'between',
    contentLayout: 'stack',
    secondaryPlacement: 'aside',
    stageEmphasis: 'low',
  })

  assert.deepEqual(describePageRegions('workspace'), {
    introAlignment: 'between',
    contentLayout: 'split',
    secondaryPlacement: 'aside',
    stageEmphasis: 'low',
  })
})

test('dashboard keeps a more editorial structure than settings without regressing to stage surfaces', () => {
  const dashboard = resolvePageArchetype('dashboard')
  const settings = resolvePageArchetype('settings')

  assert.equal(dashboard.surfaceTone, 'continuous')
  assert.equal(dashboard.effectProfile, 'restrained')
  assert.equal(settings.surfaceTone, 'quiet')
  assert.equal(settings.effectProfile, 'none')
})

test('describeAuthShellLayout keeps login as a single workspace surface with compact supporting copy', () => {
  assert.deepEqual(describeAuthShellLayout(), {
    shellMode: 'single-surface',
    brandPlacement: 'header',
    supportStyle: 'inline',
    footerNotePlacement: 'footer',
  })
})

test('describeDashboardShellLayout keeps the rail attached and the header compressed', () => {
  assert.deepEqual(describeDashboardShellLayout(), {
    mobileRailPlacement: 'after-content',
    desktopAlignment: 'start',
    railTone: 'attached',
    headerStyle: 'compressed',
  })
})

test('describeDashboardOverviewLayout keeps dashboard metrics in a strip and actions context-like instead of CTA-like', () => {
  assert.deepEqual(describeDashboardOverviewLayout(), {
    metricPresentation: 'strip',
    actionDensity: 'tight',
    filterTreatment: 'inline-rail',
    pulseTreatment: 'annotated-list',
  })
})

test('describeReportShellLayout keeps filters near the intro, shows the main trend first, and defers rail content until after the lead report on mobile', () => {
  const describeReportShellLayout = (
    pageArchetypes as typeof pageArchetypes & {
      describeReportShellLayout?: () => unknown
    }
  ).describeReportShellLayout

  assert.deepEqual(describeReportShellLayout?.(), {
    mobileToolbarPlacement: 'after-intro',
    mobileRailPlacement: 'after-content',
    desktopContentBalance: 'lead-first',
  })
})

test('describeBillingReportLayout keeps billing summaries ahead of the primary trend, pushes context tools into the rail, and keeps detailed tables behind them on mobile', () => {
  const describeBillingReportLayout = (
    pageArchetypes as typeof pageArchetypes & {
      describeBillingReportLayout?: () => unknown
    }
  ).describeBillingReportLayout

  assert.deepEqual(describeBillingReportLayout?.(), {
    leadSequence: 'summary-then-trend',
    mobileContextPlacement: 'after-lead',
    mobileDetailPlacement: 'after-context',
  })
})

test('describeLogsWorkbenchLayout keeps tab switching near the intro and keeps filters inside the active log panel', () => {
  const describeLogsWorkbenchLayout = (
    pageArchetypes as typeof pageArchetypes & {
      describeLogsWorkbenchLayout?: () => unknown
    }
  ).describeLogsWorkbenchLayout

  assert.deepEqual(describeLogsWorkbenchLayout?.(), {
    mobileToolbarPlacement: 'after-intro',
    desktopToolbarAlignment: 'between',
    filterPlacement: 'within-panel',
  })
})

test('describeAccountsWorkspaceLayout keeps primary actions ahead of filters and keeps batch actions attached to the workbench controls', () => {
  const describeAccountsWorkspaceLayout = (
    pageArchetypes as typeof pageArchetypes & {
      describeAccountsWorkspaceLayout?: () => unknown
    }
  ).describeAccountsWorkspaceLayout

  assert.deepEqual(describeAccountsWorkspaceLayout?.(), {
    mobileToolbarPlacement: 'after-intro',
    mobileFiltersPlacement: 'after-toolbar',
    batchActionsPlacement: 'with-filters',
  })
})

test('describeModelsWorkspaceLayout keeps the intro separate from the actions context and keeps feedback above the table', () => {
  const describeModelsWorkspaceLayout = (
    pageArchetypes as typeof pageArchetypes & {
      describeModelsWorkspaceLayout?: () => unknown
    }
  ).describeModelsWorkspaceLayout

  assert.deepEqual(describeModelsWorkspaceLayout?.(), {
    mobileContextPlacement: 'after-intro',
    actionPlacement: 'within-status-panel',
    feedbackPlacement: 'within-status-panel',
  })
})

test('describeProxiesWorkspaceLayout keeps filters and density controls grouped with health-check actions ahead of the table', () => {
  const describeProxiesWorkspaceLayout = (
    pageArchetypes as typeof pageArchetypes & {
      describeProxiesWorkspaceLayout?: () => unknown
    }
  ).describeProxiesWorkspaceLayout

  assert.deepEqual(describeProxiesWorkspaceLayout?.(), {
    mobileControlsPlacement: 'after-intro',
    filterPlacement: 'within-controls-panel',
    densityPlacement: 'within-controls-panel',
  })
})

test('describeConfigSettingsLayout keeps save actions after the settings sections, places runtime warnings ahead of settings sections, and stacks panels predictably', () => {
  const describeConfigSettingsLayout = (
    pageArchetypes as typeof pageArchetypes & {
      describeConfigSettingsLayout?: () => unknown
    }
  ).describeConfigSettingsLayout

  assert.deepEqual(describeConfigSettingsLayout?.(), {
    actionPlacement: 'after-sections',
    warningPlacement: 'after-intro',
    sectionFlow: 'stacked-panels',
  })
})
