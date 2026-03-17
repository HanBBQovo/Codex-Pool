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
      <div className="absolute inset-0 bg-background/70 backdrop-blur-[2px]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_10%,hsl(var(--primary)/0.16),transparent_65%)]" />
    </>
  )
}

function LoadingContent({ title, description, size = 'default' }: LoadingBaseProps) {
  const compact = size === 'compact'

  return (
    <div className={cn('max-w-[560px] px-6 text-center', compact && 'max-w-[420px] px-4')}>
      <div
        className={cn(
          'mx-auto rounded-full border-2 border-primary/25 border-t-primary animate-spin motion-reduce:animate-none',
          compact ? 'h-6 w-6' : 'h-8 w-8',
        )}
      />
      <h3
        className={cn(
          'mt-4 font-semibold tracking-tight text-foreground',
          compact ? 'text-sm' : 'text-lg sm:text-xl',
        )}
      >
        {title}
      </h3>
      {description ? (
        <p className={cn('mt-2 text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          {description}
        </p>
      ) : null}
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
            <LoadingContent title={title} description={description} size={size} />
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
      className={cn('relative flex h-full min-h-[280px] w-full items-center justify-center overflow-hidden bg-background', className)}
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
        <LoadingContent title={title} description={description} size={size} />
      </motion.div>
    </div>
  )
}
