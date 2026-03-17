export interface PageEnterMotion {
  initial: {
    opacity: number
    y: number
  }
  animate: {
    opacity: number
    y: number
  }
  exit: {
    opacity: number
    y: number
  }
  transition: {
    duration: number
    ease: [number, number, number, number]
  }
}

export interface PanelRevealMotion {
  distance: number
  duration: number
  ease: 'power3.out'
  initialOpacity: number
  scale: number
}

export interface FeedbackMotion {
  initial: {
    opacity: number
    scale: number
  }
  animate: {
    opacity: number
    scale: number
  }
  exit: {
    opacity: number
    scale: number
  }
  transition: {
    duration: number
    ease: [number, number, number, number]
  }
}

export function resolvePageEnterMotion(reducedMotion: boolean | null | undefined): PageEnterMotion {
  if (reducedMotion) {
    return {
      initial: { opacity: 0, y: 0 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: 0 },
      transition: {
        duration: 0.16,
        ease: [0.16, 1, 0.3, 1],
      },
    }
  }

  return {
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 12 },
    transition: {
      duration: 0.34,
      ease: [0.16, 1, 0.3, 1],
    },
  }
}

export function resolvePanelRevealMotion(reducedMotion: boolean | null | undefined): PanelRevealMotion {
  if (reducedMotion) {
    return {
      distance: 0,
      duration: 0.16,
      ease: 'power3.out',
      initialOpacity: 0,
      scale: 1,
    }
  }

  return {
    distance: 24,
    duration: 0.3,
    ease: 'power3.out',
    initialOpacity: 0,
    scale: 0.985,
  }
}

export function resolveFeedbackMotion(reducedMotion: boolean | null | undefined): FeedbackMotion {
  if (reducedMotion) {
    return {
      initial: { opacity: 0, scale: 1 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 1 },
      transition: {
        duration: 0.16,
        ease: [0.16, 1, 0.3, 1],
      },
    }
  }

  return {
    initial: { opacity: 0, scale: 0.985 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.99 },
    transition: {
      duration: 0.24,
      ease: [0.16, 1, 0.3, 1],
    },
  }
}
