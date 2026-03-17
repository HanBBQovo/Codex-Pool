import { type ReactNode } from 'react'
import { useReducedMotion } from 'framer-motion'

import AnimatedContent from '@/components/AnimatedContent'
import { LanguageToggle } from '@/components/LanguageToggle'
import { ThemeToggle } from '@/components/ThemeToggle'
import { BrandStage, PagePanel } from '@/components/layout/page-archetypes'
import { resolvePanelRevealMotion } from '@/lib/motion-presets'
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

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-[#f5f6f8] text-[#0f172a] dark:bg-[#0a0f18] dark:text-[#e2e8f0]">
      <div className="page-grid-wash pointer-events-none absolute inset-0 opacity-80 dark:opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.92),rgba(255,255,255,0.2)_32%,rgba(255,255,255,0)_62%),radial-gradient(circle_at_85%_18%,rgba(226,232,240,0.42),rgba(226,232,240,0)_30%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(148,163,184,0.12),rgba(148,163,184,0)_32%),radial-gradient(circle_at_85%_18%,rgba(59,130,246,0.08),rgba(59,130,246,0)_28%)]" />

      <div className="relative z-10 min-h-dvh px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-8 lg:px-12 lg:py-10">
        <div className="mx-auto flex w-full max-w-7xl justify-end gap-2 pb-2 sm:pb-3">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <div className="mx-auto flex max-w-7xl sm:min-h-[calc(100dvh-3.25rem)] sm:items-start lg:items-center">
          <div className="grid w-full gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(23rem,0.82fr)] lg:gap-8 xl:gap-10">
            <AnimatedContent
              distance={panelRevealMotion.distance}
              direction="horizontal"
              reverse
              duration={panelRevealMotion.duration}
              ease={panelRevealMotion.ease}
              initialOpacity={panelRevealMotion.initialOpacity}
              scale={panelRevealMotion.scale}
              className="order-1 flex w-full items-center justify-center lg:order-2 lg:justify-end"
            >
              <PagePanel
                className={cn(
                  'w-full max-w-[34rem]',
                  prefersReducedMotion ? '' : 'backdrop-blur-[1px]',
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
              className="order-2 lg:order-1"
            >
              <BrandStage
                badge={(
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-300/75 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-700/70 dark:bg-slate-950/65 dark:text-slate-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-900 dark:bg-slate-100" />
                    <span>{badge}</span>
                  </div>
                )}
                title={title}
                subtitle={subtitle}
                points={points}
                className="min-h-[18rem] lg:min-h-[34rem] lg:rounded-[2rem]"
              />
            </AnimatedContent>
          </div>
        </div>
      </div>
    </div>
  )
}
