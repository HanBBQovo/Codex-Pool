export type PageArchetype = 'auth' | 'dashboard' | 'workspace' | 'detail' | 'settings'

export interface PageArchetypeConfig {
  name: PageArchetype
  introStyle: 'stage' | 'compact'
  stageMode: 'split' | 'inline' | 'none'
  headerSurface: 'stage' | 'panel' | 'plain'
  primaryZone: 'form' | 'task' | 'content'
  secondaryDensity: 'narrative' | 'balanced' | 'summary-first'
  surfaceTone: 'refined' | 'neutral' | 'quiet'
  effectProfile: 'subtle' | 'minimal' | 'none'
  mobile: {
    stageCompression: 'condense' | 'hide' | 'keep'
    primaryFirst: boolean
  }
}

export interface PageArchetypeRegions {
  introAlignment: 'start' | 'between'
  contentLayout: 'split' | 'stack'
  secondaryPlacement: 'after' | 'aside'
  stageEmphasis: 'high' | 'medium' | 'low'
}

const ARCHETYPE_CONFIG: Record<PageArchetype, PageArchetypeConfig> = {
  auth: {
    name: 'auth',
    introStyle: 'stage',
    stageMode: 'split',
    headerSurface: 'stage',
    primaryZone: 'form',
    secondaryDensity: 'narrative',
    surfaceTone: 'refined',
    effectProfile: 'subtle',
    mobile: {
      stageCompression: 'condense',
      primaryFirst: true,
    },
  },
  dashboard: {
    name: 'dashboard',
    introStyle: 'compact',
    stageMode: 'inline',
    headerSurface: 'panel',
    primaryZone: 'content',
    secondaryDensity: 'balanced',
    surfaceTone: 'refined',
    effectProfile: 'minimal',
    mobile: {
      stageCompression: 'condense',
      primaryFirst: true,
    },
  },
  workspace: {
    name: 'workspace',
    introStyle: 'compact',
    stageMode: 'none',
    headerSurface: 'panel',
    primaryZone: 'task',
    secondaryDensity: 'summary-first',
    surfaceTone: 'neutral',
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
        contentLayout: 'split',
        secondaryPlacement: 'after',
        stageEmphasis: 'high',
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
        secondaryPlacement: 'after',
        stageEmphasis: 'medium',
      }
    case 'detail':
    case 'settings':
    default:
      return {
        introAlignment: 'start',
        contentLayout: 'stack',
        secondaryPlacement: 'after',
        stageEmphasis: 'low',
      }
  }
}
