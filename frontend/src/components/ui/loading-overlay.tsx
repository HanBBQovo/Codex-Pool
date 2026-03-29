import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

import { resolveFeedbackMotion } from '@/lib/motion-presets'
import { cn } from '@/lib/utils'

type LoadingSize = 'default' | 'compact'

interface LoadingBaseProps {
  title: string
  description?: string
  size?: LoadingSize
}

interface LoadingOverlayProps extends LoadingBaseProps {
  show: boolean
  className?: string
}

interface LoadingScreenProps extends LoadingBaseProps {
  className?: string
}

function LoadingBackdrop() {
  return (
    <>
      <div className="absolute inset-0 bg-content1/76 backdrop-blur-[3px]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(84%_64%_at_50%_10%,hsl(var(--primary)/0.14),transparent_64%)]" />
    </>
  )
}

function LoadingContent({
  title,
  description,
  size = 'default',
  reducedMotion = false,
}: LoadingBaseProps & { reducedMotion?: boolean }) {
  const compact = size === 'compact'

  return (
    <div className={cn('max-w-[560px] px-6', compact && 'max-w-[420px] px-4')}>
      <div className="rounded-large border-small border-default-200 bg-content1 px-5 py-5 text-center shadow-medium backdrop-blur-sm">
        <div className="mx-auto flex justify-center">
          <div
            className={cn(
              'relative flex items-center justify-center rounded-full border-small border-primary-200 bg-content1 shadow-small',
              compact ? 'h-10 w-10' : 'h-12 w-12',
            )}
          >
            <div className="absolute inset-[3px] rounded-full border border-primary/10 motion-safe:animate-pulse" />
            <div
              className={cn(
                'rounded-full border-2 border-primary/22 border-t-primary animate-spin motion-reduce:animate-none',
                compact ? 'h-5 w-5' : 'h-6 w-6',
              )}
            />
          </div>
        </div>
        <h3
          className={cn(
            'mt-4 font-semibold tracking-tight text-foreground',
            compact ? 'text-sm' : 'text-lg sm:text-xl',
          )}
        >
          {title}
        </h3>
        {description ? (
          <p className={cn('mt-2 text-muted-foreground', compact ? 'text-xs leading-5' : 'text-sm leading-6')}>
            {description}
          </p>
        ) : null}
        <div className="mt-4 overflow-hidden rounded-full border border-default-200/80 bg-content2/36 p-[2px] dark:bg-content2/24">
          {reducedMotion ? (
            <div className="h-1.5 rounded-full bg-primary/35" />
          ) : (
            <motion.div
              className="h-1.5 w-1/2 rounded-full bg-primary/72"
              initial={{ x: '-42%' }}
              animate={{ x: '126%' }}
              transition={{
                duration: 1.1,
                repeat: Number.POSITIVE_INFINITY,
                repeatType: 'mirror',
                ease: [0.4, 0, 0.2, 1],
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function LoadingOverlay({
  show,
  title,
  description,
  size = 'default',
  className,
}: LoadingOverlayProps) {
  const prefersReducedMotion = useReducedMotion()
  const feedbackMotion = resolveFeedbackMotion(prefersReducedMotion)

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="loading-overlay"
          initial={feedbackMotion.initial}
          animate={feedbackMotion.animate}
          exit={feedbackMotion.exit}
          transition={feedbackMotion.transition}
          className={cn('absolute inset-0 z-20', className)}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <LoadingBackdrop />
          <div className="relative flex h-full items-center justify-center">
            <LoadingContent
              title={title}
              description={description}
              size={size}
              reducedMotion={Boolean(prefersReducedMotion)}
            />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export function LoadingScreen({
  title,
  description,
  size = 'default',
  className,
}: LoadingScreenProps) {
  const prefersReducedMotion = useReducedMotion()
  const feedbackMotion = resolveFeedbackMotion(prefersReducedMotion)

  return (
    <div
      className={cn('relative flex h-full min-h-[280px] w-full items-center justify-center overflow-hidden bg-content1', className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <LoadingBackdrop />
      <motion.div
        className="relative"
        initial={feedbackMotion.initial}
        animate={feedbackMotion.animate}
        transition={feedbackMotion.transition}
      >
        <LoadingContent
          title={title}
          description={description}
          size={size}
          reducedMotion={Boolean(prefersReducedMotion)}
        />
      </motion.div>
    </div>
  )
}
