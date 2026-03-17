import { type ReactNode } from 'react'
import { useReducedMotion } from 'framer-motion'

import AnimatedContent from '@/components/AnimatedContent'
import { LanguageToggle } from '@/components/LanguageToggle'
import { ThemeToggle } from '@/components/ThemeToggle'
import { PagePanel } from '@/components/layout/page-archetypes'
import { resolvePanelRevealMotion } from '@/lib/motion-presets'
import { describeAuthShellLayout } from '@/lib/page-archetypes'
import { cn } from '@/lib/utils'

interface AuthShellProps {
  badge: string
  title: string
  subtitle: string
  points: string[]
  rightSlot: ReactNode
  rightSlotClassName?: string
}

export function AuthShell({
  badge,
  title,
  subtitle,
  points,
  rightSlot,
  rightSlotClassName,
}: AuthShellProps) {
  const prefersReducedMotion = useReducedMotion()
  const panelRevealMotion = resolvePanelRevealMotion(prefersReducedMotion)
  const authLayout = describeAuthShellLayout()

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-background text-foreground">
      <div className="page-grid-wash pointer-events-none absolute inset-0 opacity-90 dark:opacity-80" />

      <div className="relative z-10 min-h-dvh px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-8 lg:px-12 lg:py-10">
        <div className="mx-auto flex w-full max-w-6xl justify-end gap-2 pb-2 sm:pb-3">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <div className="mx-auto flex max-w-6xl sm:min-h-[calc(100dvh-3.25rem)] sm:items-center">
          <div className="grid w-full gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.72fr)] lg:gap-6 xl:gap-8">
            <AnimatedContent
              distance={panelRevealMotion.distance}
              direction="horizontal"
              reverse
              duration={panelRevealMotion.duration}
              ease={panelRevealMotion.ease}
              initialOpacity={panelRevealMotion.initialOpacity}
              scale={panelRevealMotion.scale}
              className="order-1 flex w-full items-center justify-center lg:justify-start"
            >
              <PagePanel
                tone={authLayout.formPanelTone}
                className={cn(
                  'w-full max-w-[33rem] rounded-[1.35rem] p-6 sm:p-7',
                  rightSlotClassName,
                )}
              >
                {rightSlot}
              </PagePanel>
            </AnimatedContent>

            <AnimatedContent
              distance={panelRevealMotion.distance}
              duration={panelRevealMotion.duration}
              ease={panelRevealMotion.ease}
              initialOpacity={panelRevealMotion.initialOpacity}
              scale={panelRevealMotion.scale}
              className="order-2"
            >
              <PagePanel
                tone={authLayout.brandPanelTone}
                className="h-full rounded-[1.35rem] p-6 sm:p-7"
              >
                <div className="space-y-5">
                  <div className="space-y-3">
                    <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background/72 px-2.5 py-1 text-[11px] font-medium tracking-[0.05em] text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/85" />
                      <span>{badge}</span>
                    </div>
                    <div className="space-y-2">
                      <h1 className="text-balance text-[clamp(1.9rem,4vw,3.3rem)] font-semibold leading-[0.98] tracking-[-0.026em] text-foreground">
                        {title}
                      </h1>
                      <p className="text-sm leading-6 text-muted-foreground sm:text-[15px]">
                        {subtitle}
                      </p>
                    </div>
                  </div>

                  {authLayout.pointsStyle === 'list' ? (
                    <ul className="space-y-3 border-t border-border/60 pt-5 text-sm leading-6 text-foreground/82">
                      {points.map((point, index) => (
                        <li key={index} className="flex items-start gap-3">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/80" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </PagePanel>
            </AnimatedContent>
          </div>
        </div>
      </div>
    </div>
  )
}
