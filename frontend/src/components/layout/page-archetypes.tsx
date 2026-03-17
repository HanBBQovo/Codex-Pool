import { type HTMLAttributes, type ReactNode } from 'react'

import {
  describeDashboardShellLayout,
  describePageRegions,
  describeReportShellLayout,
  resolvePageArchetype,
  type PageArchetype,
} from '@/lib/page-archetypes'
import { cn } from '@/lib/utils'

interface PageIntroProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  archetype?: PageArchetype | string
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}

export function PageIntro({
  archetype = 'detail',
  eyebrow,
  title,
  description,
  meta,
  actions,
  className,
  ...props
}: PageIntroProps) {
  const config = resolvePageArchetype(archetype)
  const regions = describePageRegions(archetype)

  return (
    <div
      className={cn(
        'flex flex-col gap-4 md:gap-5',
        regions.introAlignment === 'between' && 'lg:flex-row lg:items-end lg:justify-between',
        className,
      )}
      {...props}
    >
      <div className={cn('min-w-0 space-y-3', config.introStyle === 'stage' && 'max-w-2xl md:space-y-4')}>
        {eyebrow ? (
          <div className="inline-flex w-fit items-center rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] font-medium tracking-[0.05em] text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        <div className="space-y-2">
          <h1
            className={cn(
              'text-balance font-semibold tracking-[-0.026em] text-foreground',
              config.introStyle === 'stage'
                ? 'text-[clamp(2.15rem,4.8vw,4.2rem)] leading-[0.97]'
                : 'text-[clamp(1.75rem,3.6vw,2.65rem)] leading-[1]',
            )}
          >
            {title}
          </h1>
          {description ? (
            <p
              className={cn(
                'text-sm leading-6 text-muted-foreground sm:text-base',
                config.introStyle === 'stage' && 'max-w-2xl text-[15px] leading-7 sm:text-[16px]',
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
        {meta ? <div className="text-sm leading-6 text-muted-foreground">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

interface BrandStageProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  badge?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  points?: ReactNode[]
  footer?: ReactNode
}

export function BrandStage({
  badge,
  title,
  subtitle,
  points = [],
  footer,
  className,
  ...props
}: BrandStageProps) {
  return (
    <section
      className={cn(
        'page-stage-surface relative overflow-hidden rounded-[1.35rem] p-6 sm:p-7 lg:p-8',
        className,
      )}
      {...props}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-border/70" />
      <div className="relative z-10 space-y-6">
        {badge ? <div>{badge}</div> : null}
        <div className="space-y-3">
          <h1 className="max-w-3xl text-balance text-[clamp(2rem,4.6vw,3.85rem)] font-semibold leading-[0.98] tracking-[-0.028em] text-foreground">
            {title}
          </h1>
          {subtitle ? (
            <p className="max-w-2xl text-[15px] leading-7 text-muted-foreground sm:text-[16px]">
              {subtitle}
            </p>
          ) : null}
        </div>
        {points.length > 0 ? (
          <ul className="grid gap-2.5 text-sm text-foreground/86 sm:grid-cols-2">
            {points.map((point, index) => (
              <li
                key={index}
                className="flex items-start gap-3 rounded-[1rem] border border-border/55 bg-background/56 px-4 py-3"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/80" />
                <span className="leading-6">{point}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {footer ? <div className="text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </section>
  )
}

interface PagePanelProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'div' | 'aside'
  tone?: 'primary' | 'secondary'
}

export function PagePanel({
  as: Component = 'section',
  tone = 'primary',
  className,
  children,
  ...props
}: PagePanelProps) {
  return (
    <Component
      className={cn(
        tone === 'primary' ? 'page-panel-surface' : 'page-panel-surface-muted',
        'rounded-[1.25rem] p-5 sm:p-6',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  )
}

interface WorkspaceShellProps extends HTMLAttributes<HTMLDivElement> {
  intro: ReactNode
  primary: ReactNode
  secondary?: ReactNode
}

export function WorkspaceShell({
  intro,
  primary,
  secondary,
  className,
  ...props
}: WorkspaceShellProps) {
  return (
    <section className={cn('space-y-6 md:space-y-8', className)} {...props}>
      {intro}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="min-w-0 space-y-6">{primary}</div>
        {secondary ? <aside className="min-w-0 space-y-6">{secondary}</aside> : null}
      </div>
    </section>
  )
}

interface ReportShellProps extends HTMLAttributes<HTMLDivElement> {
  intro: ReactNode
  toolbar?: ReactNode
  lead: ReactNode
  rail?: ReactNode
}

export function ReportShell({
  intro,
  toolbar,
  lead,
  rail,
  className,
  children,
  ...props
}: ReportShellProps) {
  const layout = describeReportShellLayout()

  return (
    <section className={cn('space-y-6 md:space-y-8', className)} {...props}>
      {intro}
      {toolbar ? <div>{toolbar}</div> : null}
      <div
        className={cn(
          'grid gap-6 md:gap-8',
          rail && 'xl:grid-cols-[minmax(0,1.14fr)_minmax(18rem,0.86fr)]',
          layout.desktopContentBalance === 'lead-first' && 'xl:items-start',
        )}
      >
        <div className="min-w-0 space-y-6 md:space-y-8">{lead}</div>
        {rail ? (
          <aside
            className={cn(
              'min-w-0 space-y-6',
              layout.mobileRailPlacement === 'after-content' && 'order-2',
            )}
          >
            {rail}
          </aside>
        ) : null}
      </div>
      {children ? <div className="space-y-6 md:space-y-8">{children}</div> : null}
    </section>
  )
}

type ReportMetricGridProps = HTMLAttributes<HTMLDivElement>

export function ReportMetricGrid({
  className,
  children,
  ...props
}: ReportMetricGridProps) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 2xl:grid-cols-3', className)} {...props}>
      {children}
    </div>
  )
}

interface ReportMetricCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode
  value: ReactNode
  description?: ReactNode
  valueTitle?: string
  loading?: boolean
}

export function ReportMetricCard({
  title,
  value,
  description,
  valueTitle,
  loading = false,
  className,
  ...props
}: ReportMetricCardProps) {
  return (
    <PagePanel tone="secondary" className={cn('h-full space-y-3', className)} {...props}>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {loading ? (
          <div className="h-9 w-28 animate-pulse rounded-xl bg-slate-200/75 dark:bg-slate-800/75" />
        ) : (
          <p
            title={valueTitle}
            className="text-[clamp(1.36rem,2.3vw,1.95rem)] font-semibold leading-none tracking-[-0.022em] text-foreground"
          >
            {value}
          </p>
        )}
      </div>
      {description ? (
        loading ? (
          <div className="h-3.5 w-36 animate-pulse rounded bg-slate-200/70 dark:bg-slate-800/70" />
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        )
      ) : null}
    </PagePanel>
  )
}

interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  eyebrow?: ReactNode
}

export function SectionHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
      {...props}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? (
          <p className="text-[11px] font-medium tracking-[0.05em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-lg font-semibold tracking-[-0.018em] text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

interface DashboardShellProps extends HTMLAttributes<HTMLDivElement> {
  intro: ReactNode
  rail?: ReactNode
}

export function DashboardShell({
  intro,
  rail,
  className,
  children,
  ...props
}: DashboardShellProps) {
  const config = resolvePageArchetype('dashboard')
  const layout = describeDashboardShellLayout()

  return (
    <section
      className={cn(
        'grid gap-6 md:gap-8',
        rail && 'xl:grid-cols-[minmax(0,1.08fr)_minmax(19rem,0.92fr)] 2xl:grid-cols-[minmax(0,1.16fr)_minmax(20rem,0.84fr)]',
        layout.desktopAlignment === 'start' && 'xl:items-start',
        className,
      )}
      {...props}
    >
      <PagePanel
        className={cn(
          'relative order-1 overflow-hidden',
          rail && 'xl:col-start-1 xl:row-start-1',
          config.headerSurface === 'panel' && 'rounded-[1.35rem] p-6 sm:p-7 lg:p-8',
        )}
      >
        <div className="relative">{intro}</div>
      </PagePanel>
      <div className={cn('order-2 min-w-0 space-y-6 md:space-y-8', rail && 'xl:order-3 xl:col-span-2')}>
        {children}
      </div>
      {rail ? (
        <div
          className={cn(
            'min-w-0 space-y-4',
            layout.mobileRailPlacement === 'after-content' ? 'order-3' : 'order-2',
            'xl:order-2 xl:col-start-2 xl:row-start-1',
          )}
        >
          {rail}
        </div>
      ) : null}
    </section>
  )
}

type DashboardMetricGridProps = HTMLAttributes<HTMLDivElement>

export function DashboardMetricGrid({
  className,
  children,
  ...props
}: DashboardMetricGridProps) {
  return (
    <div
      className={cn('grid gap-4 sm:grid-cols-2 2xl:grid-cols-4', className)}
      {...props}
    >
      {children}
    </div>
  )
}

interface DashboardMetricCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  eyebrow?: ReactNode
  title: ReactNode
  value: ReactNode
  valueTitle?: string
  description?: ReactNode
  icon?: ReactNode
  loading?: boolean
}

export function DashboardMetricCard({
  eyebrow,
  title,
  value,
  valueTitle,
  description,
  icon,
  loading = false,
  className,
  ...props
}: DashboardMetricCardProps) {
  return (
    <PagePanel className={cn('h-full space-y-4', className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          {eyebrow ? (
            <p className="text-[11px] font-medium tracking-[0.05em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <p className="text-sm font-medium text-foreground/82">{title}</p>
        </div>
        {icon ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/78 text-muted-foreground">
            {icon}
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        {loading ? (
          <div className="h-10 w-32 animate-pulse rounded-xl bg-slate-200/75 dark:bg-slate-800/75" />
        ) : (
          <p
            title={valueTitle}
            className="text-[clamp(1.6rem,2.8vw,2.2rem)] font-semibold leading-none tracking-[-0.026em] text-foreground"
          >
            {value}
          </p>
        )}
        {description ? (
          loading ? (
            <div className="h-3.5 w-40 animate-pulse rounded bg-slate-200/70 dark:bg-slate-800/70" />
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">{description}</p>
          )
        ) : null}
      </div>
    </PagePanel>
  )
}
