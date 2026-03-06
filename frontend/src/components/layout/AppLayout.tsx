import { NavLink, Outlet } from 'react-router-dom'
import {
    LayoutDashboard,
    Users,
    UserCog,
    HardDriveDownload,
    ShieldCheck,
    Layers3,
    Box,
    Activity,
    ReceiptText,
    Settings,
    Cpu,
    Network,
    TerminalSquare,
    LogOut,
    ChevronsLeft,
    ChevronsRight,
    Menu,
    X,
    type LucideIcon,
} from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { canAccessByRole, type AppRole } from '@/lib/permissions'
import { useTranslation } from 'react-i18next'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LanguageToggle } from '@/components/LanguageToggle'
import { ParallaxBackground } from '@/components/ui/parallax-background'
import { Button } from '@/components/ui/button'
import { useEffect, useMemo, useRef, useState } from 'react'

const MOBILE_FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableElements(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>(MOBILE_FOCUSABLE_SELECTOR))
        .filter((element) =>
            !element.hasAttribute('disabled') &&
            element.getAttribute('aria-hidden') !== 'true'
        )
}

interface AppLayoutProps {
    onLogout: () => Promise<void>
    appName?: string
    menuGroups?: AppLayoutMenuGroup[]
    role?: AppRole
}

export interface AppLayoutMenuItem {
    path: string
    icon: LucideIcon
    label: string
    roles?: AppRole[]
}

export interface AppLayoutMenuGroup {
    label: string
    items: AppLayoutMenuItem[]
}

export function AppLayout({
    onLogout,
    appName = 'Codex Pool',
    menuGroups,
    role = 'admin',
}: AppLayoutProps) {
    const { t } = useTranslation()
    const prefersReducedMotion = useReducedMotion()
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
    const mobileDrawerRef = useRef<HTMLElement | null>(null)
    const mobileOpenButtonRef = useRef<HTMLButtonElement | null>(null)
    const previousFocusedElementRef = useRef<HTMLElement | null>(null)

    useEffect(() => {
        if (!mobileSidebarOpen) {
            return
        }

        const drawer = mobileDrawerRef.current
        if (!drawer) {
            return
        }

        const previousOverflow = document.body.style.overflow
        const openButton = mobileOpenButtonRef.current
        previousFocusedElementRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null

        const focusFirstElement = () => {
            const focusableElements = getFocusableElements(drawer)
            const target = focusableElements[0] ?? drawer
            target.focus()
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                setMobileSidebarOpen(false)
                return
            }

            if (event.key !== 'Tab') {
                return
            }

            const focusableElements = getFocusableElements(drawer)
            if (focusableElements.length === 0) {
                event.preventDefault()
                drawer.focus()
                return
            }

            const first = focusableElements[0]
            const last = focusableElements[focusableElements.length - 1]
            const active = document.activeElement as HTMLElement | null

            if (event.shiftKey) {
                if (active === first || !active || !drawer.contains(active)) {
                    event.preventDefault()
                    last.focus()
                }
                return
            }

            if (active === last) {
                event.preventDefault()
                first.focus()
            }
        }

        document.body.style.overflow = 'hidden'
        const focusRaf = window.requestAnimationFrame(focusFirstElement)
        window.addEventListener('keydown', handleKeyDown)

        return () => {
            window.cancelAnimationFrame(focusRaf)
            document.body.style.overflow = previousOverflow
            window.removeEventListener('keydown', handleKeyDown)
            const restoreTarget = previousFocusedElementRef.current ?? openButton
            restoreTarget?.focus()
        }
    }, [mobileSidebarOpen])

    const defaultAdminMenuGroups: AppLayoutMenuGroup[] = [
        {
            label: t('nav.groups.analytics'),
            items: [
                { path: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard') },
                { path: '/usage', icon: Activity, label: t('nav.usage') },
                { path: '/billing', icon: ReceiptText, label: t('nav.billing') },
            ]
        },
        {
            label: t('nav.groups.assets'),
            items: [
                { path: '/accounts', icon: UserCog, label: t('nav.accounts') },
                { path: '/models', icon: Box, label: t('nav.models') },
                { path: '/tenants', icon: Users, label: t('nav.tenants') },
                { path: '/proxies', icon: Network, label: t('nav.proxies') },
            ]
        },
        {
            label: t('nav.groups.operations'),
            items: [
                { path: '/groups', icon: Layers3, label: t('nav.apiKeyGroups') },
                { path: '/oauth-import', icon: ShieldCheck, label: t('nav.oauthImport') },
                { path: '/imports', icon: HardDriveDownload, label: t('nav.importJobs') },
            ]
        },
        {
            label: t('nav.groups.system'),
            items: [
                { path: '/config', icon: Settings, label: t('nav.config') },
                { path: '/logs', icon: TerminalSquare, label: t('nav.logs') },
                { path: '/system', icon: Cpu, label: t('nav.system') },
            ]
        }
    ]
    const resolvedMenuGroups = menuGroups ?? defaultAdminMenuGroups
    const visibleMenuGroups = useMemo(() => {
        return resolvedMenuGroups
            .map((group) => ({
                ...group,
                items: group.items.filter((item) => canAccessByRole(item.roles, role)),
            }))
            .filter((group) => group.items.length > 0)
    }, [resolvedMenuGroups, role])

    return (
        <>
            <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
            >
                {t('common.skipToMainContent', { defaultValue: 'Skip to main content' })}
            </a>
            <ParallaxBackground />
            <div className="flex h-screen text-foreground overflow-hidden selection:bg-primary/20 relative z-10 w-full">
                {mobileSidebarOpen ? (
                    <button
                        type="button"
                        className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] md:hidden"
                        onClick={() => setMobileSidebarOpen(false)}
                        aria-label={t('nav.closeNavigation', { defaultValue: 'Close navigation menu' })}
                    />
                ) : null}
                {/* Sidebar */}
                <motion.aside
                    ref={mobileDrawerRef}
                    initial={prefersReducedMotion ? false : { x: -20, opacity: 0 }}
                    animate={prefersReducedMotion ? undefined : { x: 0, opacity: 1 }}
                    transition={prefersReducedMotion ? undefined : { duration: 0.35, ease: "easeOut" }}
                    tabIndex={-1}
                    role={mobileSidebarOpen ? 'dialog' : undefined}
                    aria-modal={mobileSidebarOpen ? true : undefined}
                    aria-label={t('nav.mainNavigation', { defaultValue: 'Main navigation' })}
                    className={cn(
                        "border-r border-border/40 bg-card/40 backdrop-blur-2xl flex flex-col shrink-0 z-40",
                        "fixed inset-y-0 left-0 w-56 transform transition-transform md:static md:translate-x-0",
                        sidebarCollapsed ? "md:w-20" : "md:w-56",
                        mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
                    )}
                >
                    <div className="h-14 relative flex items-center justify-center border-b border-border/40 shrink-0">
                        <div className="flex items-center justify-center gap-2 min-w-0">
                            <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center shadow-inner relative overflow-hidden">
                                {!prefersReducedMotion ? (
                                    <motion.div
                                        className="absolute inset-0 bg-white/20"
                                        animate={{ y: ["100%", "-100%"] }}
                                        transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                                    />
                                ) : null}
                                <Box className="h-4 w-4 text-primary-foreground" />
                            </div>
                            {!sidebarCollapsed ? (
                                <h1 className="font-semibold tracking-tight text-sm truncate">{appName}</h1>
                            ) : null}
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md text-muted-foreground hover:text-foreground md:hidden"
                            onClick={() => setMobileSidebarOpen(false)}
                            aria-label={t('nav.closeNavigation', { defaultValue: 'Close navigation menu' })}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 hidden h-8 w-6 -translate-y-1/2 rounded-md text-muted-foreground hover:text-foreground md:inline-flex"
                            onClick={() => setSidebarCollapsed((prev) => !prev)}
                            aria-label={sidebarCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}
                            title={sidebarCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}
                        >
                            {sidebarCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
                        </Button>
                    </div>

                    <nav
                        aria-label={t('nav.mainNavigation', { defaultValue: 'Main navigation' })}
                        className={cn("flex-1 overflow-y-auto py-6 scrollbar-none", sidebarCollapsed ? "space-y-4" : "space-y-8")}
                    >
                        {visibleMenuGroups.map((group, i) => (
                            <div key={i} className={cn(sidebarCollapsed ? "px-2" : "px-4")}>
                                {!sidebarCollapsed ? (
                                    <h2 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                                        {group.label}
                                    </h2>
                                ) : null}
                                <ul className="space-y-0.5">
                                    {group.items.map(item => (
                                        <li key={item.path}>
                                            <NavLink
                                                to={item.path}
                                                title={sidebarCollapsed ? item.label : undefined}
                                                onClick={() => setMobileSidebarOpen(false)}
                                                className={({ isActive }) =>
                                                    cn(
                                                        "relative flex items-center rounded-md text-sm font-medium transition-colors group",
                                                        sidebarCollapsed ? "justify-center px-2 py-2" : "px-2 py-1.5",
                                                        isActive
                                                            ? "text-primary"
                                                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                                    )
                                                }
                                            >
                                                {({ isActive }) => (
                                                    <>
                                                        {isActive && (
                                                            <motion.div
                                                                layoutId="activeNavIndicator"
                                                                className="absolute inset-0 bg-primary/10 rounded-md"
                                                                initial={false}
                                                                transition={{ type: "spring", stiffness: 350, damping: 30 }}
                                                            />
                                                        )}
                                                        <item.icon className={cn("h-4 w-4 relative z-10 transition-transform group-hover:scale-110", !sidebarCollapsed && "mr-2.5", isActive && "text-primary")} />
                                                        {!sidebarCollapsed ? (
                                                            <span className="relative z-10">{item.label}</span>
                                                        ) : null}
                                                    </>
                                                )}
                                            </NavLink>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </nav>
                    <div className={cn("p-4 border-t border-border/40 text-xs text-muted-foreground/60 flex items-center", sidebarCollapsed ? "justify-center" : "justify-between")}>
                        {!sidebarCollapsed ? <span>v1.0.0</span> : null}
                        <span className="flex items-center gap-1.5" title={t('nav.online')}>
                            <span className="h-2 w-2 rounded-full bg-success motion-reduce:animate-none animate-pulse" />
                            {!sidebarCollapsed ? t('nav.online') : <span className="sr-only">{t('nav.online')}</span>}
                        </span>
                    </div>
                </motion.aside>

                {/* Main Content */}
                <main id="main-content" tabIndex={-1} className="flex-1 bg-transparent relative overflow-hidden flex flex-col z-20">
                    {/* Top Action Header */}
                    <header className="h-14 flex items-center justify-between px-4 sm:px-6 lg:px-8 shrink-0 z-30 gap-3 border-b border-border/10 bg-background/10 backdrop-blur-xl">
                        <div className="md:hidden">
                            <Button
                                ref={mobileOpenButtonRef}
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => {
                                    setSidebarCollapsed(false)
                                    setMobileSidebarOpen(true)
                                }}
                                aria-label={t('nav.openNavigation', { defaultValue: 'Open navigation menu' })}
                            >
                                <Menu className="h-4 w-4" />
                            </Button>
                        </div>
                        <div className="ml-auto flex items-center gap-3">
                            <LanguageToggle />
                            <ThemeToggle />
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                    try {
                                        await onLogout()
                                    } catch {
                                        window.location.reload()
                                    }
                                }}
                            >
                                <LogOut className="h-4 w-4 mr-2" />
                                {t('common.logout')}
                            </Button>
                        </div>
                    </header>

                    <div className="flex-1 relative overflow-auto">
                        <AnimatePresence mode="popLayout">
                            <Outlet />
                        </AnimatePresence>
                    </div>
                </main>
            </div>
        </>
    )
}
