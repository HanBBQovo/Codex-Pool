export type PageArchetype = 'auth' | 'dashboard' | 'workspace' | 'detail' | 'settings'

export interface PageArchetypeConfig {
  name: PageArchetype
  introStyle: 'stage' | 'compact'
  stageMode: 'inline' | 'none'
  headerSurface: 'section' | 'plain'
  primaryZone: 'form' | 'task' | 'content'
  secondaryDensity: 'narrative' | 'balanced' | 'summary-first'
  surfaceTone: 'framed' | 'continuous' | 'quiet'
  effectProfile: 'controlled' | 'restrained' | 'none'
  mobile: {
    stageCompression: 'condense' | 'hide' | 'keep'
    primaryFirst: boolean
  }
}

export interface PageArchetypeRegions {
  introAlignment: 'start' | 'between'
  contentLayout: 'split' | 'stack'
  secondaryPlacement: 'after' | 'aside'
  stageEmphasis: 'controlled' | 'medium' | 'low'
}

export interface DashboardShellLayout {
  mobileRailPlacement: 'after-content' | 'after-intro'
  desktopAlignment: 'start' | 'stretch'
  railTone: 'attached' | 'separate'
  headerStyle: 'compressed' | 'panel'
}

export interface DashboardOverviewLayout {
  metricPresentation: 'strip' | 'cards'
  actionDensity: 'tight' | 'relaxed'
  filterTreatment: 'inline-rail' | 'panel'
  pulseTreatment: 'annotated-list' | 'cards'
}

export interface AuthShellLayout {
  shellMode: 'single-surface' | 'split-surface'
  brandPlacement: 'header' | 'aside'
  supportStyle: 'inline' | 'list'
  footerNotePlacement: 'footer' | 'none'
}

export interface ReportShellLayout {
  mobileToolbarPlacement: 'after-intro'
  mobileRailPlacement: 'after-content' | 'after-toolbar'
  desktopContentBalance: 'lead-first' | 'balanced'
}

export interface BillingReportLayout {
  leadSequence: 'summary-then-trend'
  mobileContextPlacement: 'after-lead'
  mobileDetailPlacement: 'after-context'
}

export interface LogsWorkbenchLayout {
  mobileToolbarPlacement: 'after-intro'
  desktopToolbarAlignment: 'between'
  filterPlacement: 'within-panel'
}

export interface AccountsWorkspaceLayout {
  mobileToolbarPlacement: 'after-intro'
  mobileFiltersPlacement: 'after-toolbar'
  batchActionsPlacement: 'with-filters'
}

export interface ModelsWorkspaceLayout {
  mobileContextPlacement: 'after-intro'
  actionPlacement: 'within-status-panel'
  feedbackPlacement: 'within-status-panel'
}

export interface ProxiesWorkspaceLayout {
  mobileControlsPlacement: 'after-intro'
  filterPlacement: 'within-controls-panel'
  densityPlacement: 'within-controls-panel'
}

export interface ConfigSettingsLayout {
  actionPlacement: 'after-sections'
  warningPlacement: 'after-intro'
  sectionFlow: 'stacked-panels'
}

const ARCHETYPE_CONFIG: Record<PageArchetype, PageArchetypeConfig> = {
  auth: {
    name: 'auth',
    introStyle: 'compact',
    stageMode: 'inline',
    headerSurface: 'plain',
    primaryZone: 'form',
    secondaryDensity: 'narrative',
    surfaceTone: 'framed',
    effectProfile: 'controlled',
    mobile: {
      stageCompression: 'condense',
      primaryFirst: true,
    },
  },
  dashboard: {
    name: 'dashboard',
    introStyle: 'compact',
    stageMode: 'none',
    headerSurface: 'plain',
    primaryZone: 'content',
    secondaryDensity: 'balanced',
    surfaceTone: 'continuous',
    effectProfile: 'restrained',
    mobile: {
      stageCompression: 'condense',
      primaryFirst: true,
    },
  },
  workspace: {
    name: 'workspace',
    introStyle: 'compact',
    stageMode: 'none',
    headerSurface: 'plain',
    primaryZone: 'task',
    secondaryDensity: 'summary-first',
    surfaceTone: 'quiet',
    effectProfile: 'none',
    mobile: {
      stageCompression: 'hide',
      primaryFirst: true,
    },
  },
  detail: {
    name: 'detail',
    introStyle: 'compact',
    stageMode: 'none',
    headerSurface: 'plain',
    primaryZone: 'content',
    secondaryDensity: 'balanced',
    surfaceTone: 'quiet',
    effectProfile: 'none',
    mobile: {
      stageCompression: 'hide',
      primaryFirst: true,
    },
  },
  settings: {
    name: 'settings',
    introStyle: 'compact',
    stageMode: 'none',
    headerSurface: 'plain',
    primaryZone: 'content',
    secondaryDensity: 'balanced',
    surfaceTone: 'quiet',
    effectProfile: 'none',
    mobile: {
      stageCompression: 'hide',
      primaryFirst: true,
    },
  },
}

export function resolvePageArchetype(name: PageArchetype | string | undefined): PageArchetypeConfig {
  if (!name) {
    return ARCHETYPE_CONFIG.settings
  }

  if (name in ARCHETYPE_CONFIG) {
    return ARCHETYPE_CONFIG[name as PageArchetype]
  }

  return ARCHETYPE_CONFIG.settings
}

export function describePageRegions(name: PageArchetype | string | undefined): PageArchetypeRegions {
  const archetype = resolvePageArchetype(name)

  switch (archetype.name) {
    case 'auth':
      return {
        introAlignment: 'start',
        contentLayout: 'stack',
        secondaryPlacement: 'after',
        stageEmphasis: 'controlled',
      }
    case 'workspace':
      return {
        introAlignment: 'between',
        contentLayout: 'split',
        secondaryPlacement: 'aside',
        stageEmphasis: 'low',
      }
    case 'dashboard':
      return {
        introAlignment: 'between',
        contentLayout: 'stack',
        secondaryPlacement: 'aside',
        stageEmphasis: 'low',
      }
    case 'detail':
      return {
        introAlignment: 'start',
        contentLayout: 'stack',
        secondaryPlacement: 'after',
        stageEmphasis: 'low',
      }
    case 'settings':
      return {
        introAlignment: 'between',
        contentLayout: 'stack',
        secondaryPlacement: 'after',
        stageEmphasis: 'low',
      }
    default:
      return {
        introAlignment: 'start',
        contentLayout: 'stack',
        secondaryPlacement: 'after',
        stageEmphasis: 'low',
      }
  }
}

export function describeDashboardShellLayout(): DashboardShellLayout {
  return {
    mobileRailPlacement: 'after-content',
    desktopAlignment: 'start',
    railTone: 'attached',
    headerStyle: 'compressed',
  }
}

export function describeDashboardOverviewLayout(): DashboardOverviewLayout {
  return {
    metricPresentation: 'strip',
    actionDensity: 'tight',
    filterTreatment: 'inline-rail',
    pulseTreatment: 'annotated-list',
  }
}

export function describeAuthShellLayout(): AuthShellLayout {
  return {
    shellMode: 'single-surface',
    brandPlacement: 'header',
    supportStyle: 'inline',
    footerNotePlacement: 'footer',
  }
}

export function describeReportShellLayout(): ReportShellLayout {
  return {
    mobileToolbarPlacement: 'after-intro',
    mobileRailPlacement: 'after-content',
    desktopContentBalance: 'lead-first',
  }
}

export function describeBillingReportLayout(): BillingReportLayout {
  return {
    leadSequence: 'summary-then-trend',
    mobileContextPlacement: 'after-lead',
    mobileDetailPlacement: 'after-context',
  }
}

export function describeLogsWorkbenchLayout(): LogsWorkbenchLayout {
  return {
    mobileToolbarPlacement: 'after-intro',
    desktopToolbarAlignment: 'between',
    filterPlacement: 'within-panel',
  }
}

export function describeAccountsWorkspaceLayout(): AccountsWorkspaceLayout {
  return {
    mobileToolbarPlacement: 'after-intro',
    mobileFiltersPlacement: 'after-toolbar',
    batchActionsPlacement: 'with-filters',
  }
}

export function describeModelsWorkspaceLayout(): ModelsWorkspaceLayout {
  return {
    mobileContextPlacement: 'after-intro',
    actionPlacement: 'within-status-panel',
    feedbackPlacement: 'within-status-panel',
  }
}

export function describeProxiesWorkspaceLayout(): ProxiesWorkspaceLayout {
  return {
    mobileControlsPlacement: 'after-intro',
    filterPlacement: 'within-controls-panel',
    densityPlacement: 'within-controls-panel',
  }
}

export function describeConfigSettingsLayout(): ConfigSettingsLayout {
  return {
    actionPlacement: 'after-sections',
    warningPlacement: 'after-intro',
    sectionFlow: 'stacked-panels',
  }
}
