export type ThreadsGlLike<TCanvas = unknown, TBlend = unknown> = {
  canvas?: TCanvas | null
  BLEND?: TBlend
  SRC_ALPHA?: TBlend
  ONE_MINUS_SRC_ALPHA?: TBlend
}

export type ThreadsRendererLike<TGl extends ThreadsGlLike = ThreadsGlLike> = {
  gl: TGl | null | undefined
}

export type InitializedThreadsRenderer<TRenderer extends ThreadsRendererLike> = TRenderer & {
  gl: NonNullable<TRenderer['gl']> & {
    canvas: NonNullable<NonNullable<TRenderer['gl']>['canvas']>
  }
}

type ThreadsCanvasProbe = {
  getContext: (contextId: 'webgl' | 'experimental-webgl') => unknown
}

export function canInitializeThreadsRenderer(
  createCanvas: () => ThreadsCanvasProbe | null = () => {
    if (typeof document === 'undefined') {
      return null
    }

    return document.createElement('canvas') as ThreadsCanvasProbe
  },
): boolean {
  try {
    const canvas = createCanvas()
    if (!canvas) {
      return typeof document === 'undefined'
    }

    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
  } catch {
    return false
  }
}

export function initializeThreadsRenderer<TRenderer extends ThreadsRendererLike>(
  createRenderer: () => TRenderer,
): InitializedThreadsRenderer<TRenderer> | null {
  if (!canInitializeThreadsRenderer()) {
    return null
  }

  try {
    const renderer = createRenderer()
    const gl = renderer.gl

    if (!gl?.canvas) {
      return null
    }

    const glControls = gl as NonNullable<TRenderer['gl']> & {
      clearColor?: (red: number, green: number, blue: number, alpha: number) => unknown
      enable?: (value: NonNullable<TRenderer['gl']>['BLEND']) => unknown
      blendFunc?: (
        source: NonNullable<TRenderer['gl']>['SRC_ALPHA'],
        destination: NonNullable<TRenderer['gl']>['ONE_MINUS_SRC_ALPHA'],
      ) => unknown
    }

    glControls.clearColor?.(0, 0, 0, 0)

    if (gl.BLEND !== undefined) {
      glControls.enable?.(gl.BLEND)
    }

    if (gl.SRC_ALPHA !== undefined && gl.ONE_MINUS_SRC_ALPHA !== undefined) {
      glControls.blendFunc?.(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    }

    return renderer as InitializedThreadsRenderer<TRenderer>
  } catch {
    return null
  }
}
