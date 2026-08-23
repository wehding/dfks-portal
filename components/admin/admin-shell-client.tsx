"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { invalidateAccessContextCache } from "@/lib/access-context-client"
import type { AppAccessContext } from "@/lib/app-access-context"
import { EMPTY_NAVIGATION_BADGES, type NavigationBadgeCounts } from "@/lib/navigation-badges"
import {
    Building2,
    Wallet,
    Play,
    BarChart3,
    Database,
    LogOut,
    ScrollText,
    Users2,
    Receipt,
    Scale,
    UserCheck,
    UserCog,
    BrainCircuit,
    ShieldCheck,
    ChevronRight,
    Home,
    FileClock,
    BadgeCheck,
} from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { ThemeToggle } from "@/components/theme-toggle"
import { LanguageToggle } from "@/components/language-toggle"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { SHARED_NAV_ICONS } from "@/lib/navigation-icons"
import { SidebarCloseOnNavigation, SidebarNavigationLink } from "@/components/navigation/sidebar-navigation-link"
import { AppShellTopBar } from "@/components/navigation/app-shell-top-bar"
import { AdminCommandMenu } from "@/components/admin/admin-command-menu"
import { AdminContextualHelp } from "@/components/admin/admin-contextual-help"
import { AdminListAutoTools } from "@/components/admin/admin-list-tools"
import { resolveNavigationTitle } from "@/lib/navigation-title"
import { OnboardingRequirementBanner } from "@/components/onboarding-requirement-banner"

const ADMIN_NAV_ITEMS = [
    { key: "overblik",            href: "/admin",                     icon: Home,        labelKey: "nav.dashboard"        },
    { key: "kontrakter",          href: "/admin/kontrakter",          icon: SHARED_NAV_ICONS.contracts,   labelKey: "nav.contracts"        },
    { key: "vaerker",             href: "/admin/vaerker",             icon: SHARED_NAV_ICONS.works,       labelKey: "nav.works"            },
    { key: "rettighedshavere",    href: "/admin/rettighedshavere",    icon: UserCheck,   labelKey: "nav.rightsHolders"    },
    { key: "producenter",         href: "/admin/producenter",         icon: Building2,   labelKey: "nav.producers"        },
    { key: "kontraktgennemgang",  href: "/admin/kontraktgennemgang",  icon: Scale,       labelKey: "nav.contractReview"   },
    { key: "statistik",           href: "/admin/statistik",           icon: BarChart3,   labelKey: "nav.statistics"       },
    { key: "indbetalinger",       href: "/admin/indbetalinger",       icon: Receipt,     labelKey: "nav.producerPayments" },
]

const SETUP_NAV_ITEMS = [
    { key: "ai-kontrolrum",       href: "/admin/ai-kontrolrum",       icon: BrainCircuit, labelKey: "nav.aiKontrolrum"    },
    { key: "organisation",        href: "/admin/organisation",        icon: Building2,   labelKey: "nav.organisation"     },
    { key: "logning",             href: "/admin/logning",             icon: FileClock,   labelKey: "nav.auditLog"         },
    { key: "imdb-kontrol",        href: "/admin/imdb-kontrol",        icon: BadgeCheck,  labelKey: "nav.imdbControl"      },
    { key: "brugere",             href: "/admin/brugere",             icon: Users2,      labelKey: "nav.users"            },
    { key: "min-profil",          href: "/admin/min-profil",          icon: UserCog,     labelKey: "nav.minProfil"        },
    { key: "organisationer",      href: "/admin/organisationer",      icon: ShieldCheck, labelKey: "nav.organisations"    },
]

const RETTIGHEDS_NAV_ITEMS = [
    { key: "aftalelicens",        href: "/admin/aftalelicens",        icon: SHARED_NAV_ICONS.screenings,  labelKey: "nav.visningsadmin"    },
    { key: "udbetalinger",        href: "/admin/udbetalinger",        icon: Wallet,      labelKey: "nav.payouts"          },
    { key: "streaming",           href: "/admin/streaming",           icon: Play,        labelKey: "nav.streaming"        },
    { key: "stamdata",            href: "/admin/stamdata",            icon: Database,    labelKey: "nav.masterData"       },
    { key: "gennemsigtighed",     href: "/admin/gennemsigtighed",     icon: ScrollText,  labelKey: "nav.transparency"     },
]

const USER_NAV_ITEMS = [
    { key: "portal-overblik",     href: "/portal",                    icon: Home,     labelKey: "nav.dashboard"      },
    { key: "mine-kontrakter",     href: "/portal/mine-kontrakter",    icon: SHARED_NAV_ICONS.contracts, labelKey: "nav.myContracts"    },
    { key: "mine-vaerker",        href: "/portal/mine-vaerker",       icon: SHARED_NAV_ICONS.works,     labelKey: "nav.myWorks"        },
    { key: "okonomi",             href: "/portal/okonomi",            icon: Wallet,   labelKey: "nav.economy"        },
    { key: "portal-aftalelicens", href: "/portal/mine-visninger",     icon: SHARED_NAV_ICONS.screenings, labelKey: "nav.mineVisninger"  },
    { key: "portal-gennemgang",   href: "/portal/kontraktgennemgang", icon: Scale,    labelKey: "nav.contractReview" },
]

const ALL_KEYS = [...ADMIN_NAV_ITEMS, ...SETUP_NAV_ITEMS, ...RETTIGHEDS_NAV_ITEMS].map(i => i.key)
const PRODUCTION_PROTOTYPE_KEYS = new Set<string>([])
const isProductionPortal = process.env.NODE_ENV === "production"

// Dæmpede, matchende menu-badges: blå = ulæste beskeder (samme blå som list-markeringen),
// amber = afventer godkendelse.
const MENU_BADGE_BASE = "inline-flex items-center justify-center h-5 min-w-5 rounded-full text-[10px] font-bold px-1"
const MENU_BADGE_BESKED = `${MENU_BADGE_BASE} bg-blue-100 text-blue-700`
const MENU_BADGE_GODKEND = `${MENU_BADGE_BASE} bg-amber-100 text-amber-800`

const ROLE_MODULES: Record<string, string[]> = {
    superadmin:  ALL_KEYS,
    admin:       ALL_KEYS.filter(k => k !== "organisationer" && k !== "imdb-kontrol"),
    "org-admin": ALL_KEYS.filter(k => k !== "stamdata" && k !== "brugere" && k !== "organisationer" && k !== "imdb-kontrol"),
    jurist:      ["overblik", "kontrakter", "rettighedshavere", "kontraktgennemgang", "logning"],
    viewer:      ["overblik", "kontrakter"],
}

// ── Kollapsibel sektion ───────────────────────────────────────

function NavSection({
    title,
    isOpen,
    onToggle,
    children,
}: {
    title: string
    isOpen: boolean
    onToggle: () => void
    children: React.ReactNode
}) {
    return (
        <SidebarGroup>
            <SidebarGroupContent>
                <button
                    onClick={onToggle}
                    className="flex w-full items-center justify-between px-2 pb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                >
                    <span>{title}</span>
                    <ChevronRight className={`h-3 w-3 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
                </button>
                {isOpen && (
                    <SidebarMenu>
                        {children}
                    </SidebarMenu>
                )}
            </SidebarGroupContent>
        </SidebarGroup>
    )
}

export default function AdminShellClient({ children, initialContext }: { children: React.ReactNode; initialContext: AppAccessContext }) {
    const { t } = useI18n()
    const pathname = usePathname()
    const router = useRouter()
    const userRole = initialContext.role
    const [badges, setBadges] = useState<NavigationBadgeCounts>(EMPTY_NAVIGATION_BADGES)
    const isAssociationMember = initialContext.canUseMember
    const [activeOrgId, setActiveOrgId] = useState(initialContext.orgId)
    const organisations = initialContext.organisations

    // Kollaps-tilstand per sektion. Opsætning er lukket som standard.
    const [brugerOpen, setBrugerOpen] = useState(true)
    const [adminOpen, setAdminOpen] = useState(true)
    const [setupOpen, setSetupOpen] = useState(false)
    const [rettighedsOpen, setRettighedsOpen] = useState(true)
    const brand = initialContext.brand

    useEffect(() => {
        const loadBadges = async () => {
            const response = await fetch("/api/navigation/badges", { cache: "no-store" })
            if (response.ok) setBadges(await response.json() as NavigationBadgeCounts)
        }
        window.dispatchEvent(new CustomEvent("dfks-terminology", { detail: { coeditorWord: initialContext.terminology.coeditor_word } }))
        void loadBadges()
        window.addEventListener("contracts-updated", loadBadges)
        window.addEventListener("works-updated", loadBadges)
        return () => {
            window.removeEventListener("contracts-updated", loadBadges)
            window.removeEventListener("works-updated", loadBadges)
        }
    }, [initialContext.terminology.coeditor_word])

    const pendingCount = badges.adminContracts
    const pendingContractMessagesCount = badges.adminContractMessages
    const pendingWorksCount = badges.adminWorks
    const pendingWorkMessagesCount = badges.adminWorkMessages
    const pendingWorkShareCount = badges.adminWorkShareTasks
    const pendingReviewCount = badges.adminReviews
    const pendingScreeningCount = badges.adminScreenings

    const setupRouteActive = SETUP_NAV_ITEMS.some(item => pathname === item.href || pathname.startsWith(`${item.href}/`))

    const handleLogout = async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push("/")
        router.refresh()
    }

    const handleOrganisationChange = async (orgId: string) => {
        invalidateAccessContextCache()
        const response = await fetch("/api/access/context", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orgId }),
        })
        if (!response.ok) return
        invalidateAccessContextCache()
        const result = await response.json() as { canUseAdmin?: boolean; canUseMember?: boolean }
        setActiveOrgId(orgId)
        if (!result.canUseAdmin && result.canUseMember) router.replace("/portal")
        else router.refresh()
    }

    const allowedKeys = userRole ? (ROLE_MODULES[userRole] ?? []) : []

    const adminItems = ADMIN_NAV_ITEMS
        .filter(item => allowedKeys.includes(item.key) && (!isProductionPortal || !PRODUCTION_PROTOTYPE_KEYS.has(item.key)))
        .map(item => ({ ...item, label: t(item.labelKey as Parameters<typeof t>[0]) }))

    const rettighedsItems = RETTIGHEDS_NAV_ITEMS
        .filter(item => allowedKeys.includes(item.key) && (!isProductionPortal || !PRODUCTION_PROTOTYPE_KEYS.has(item.key)))
        .map(item => ({ ...item, label: t(item.labelKey as Parameters<typeof t>[0]) }))

    const setupItems = SETUP_NAV_ITEMS
        .filter(item => allowedKeys.includes(item.key))
        .map(item => ({ ...item, label: t(item.labelKey as Parameters<typeof t>[0]) }))

    const userNavItems = USER_NAV_ITEMS
        .filter(item => item.key !== "portal-gennemgang" || isAssociationMember)
        .map(item => ({
            ...item,
            label: t(item.labelKey as Parameters<typeof t>[0]),
        }))
    const currentPageTitle = resolveNavigationTitle(pathname, [...adminItems, ...rettighedsItems, ...setupItems, ...userNavItems], t("nav.admin"))

    const renderItem = (item: typeof adminItems[0]) => (
        <SidebarMenuItem key={item.key}>
            <SidebarMenuButton
                asChild
                isActive={item.href === "/admin" || item.href === "/portal"
                    ? pathname === item.href
                    : pathname === item.href || (pathname?.startsWith(`${item.href}/`) ?? false)}
            >
                <SidebarNavigationLink href={item.href}>
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {item.key === "kontrakter" && (pendingCount > 0 || pendingContractMessagesCount > 0) && (
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                            {pendingContractMessagesCount > 0 && (
                                <span title={t("common.unreadMessages")} className={MENU_BADGE_BESKED}>{pendingContractMessagesCount}</span>
                            )}
                            {pendingCount > 0 && (
                                <span title={t("common.pendingApproval")} className={MENU_BADGE_GODKEND}>{pendingCount}</span>
                            )}
                        </span>
                    )}
                    {item.key === "vaerker" && (pendingWorksCount > 0 || pendingWorkMessagesCount > 0 || pendingWorkShareCount > 0) && (
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                            {pendingWorkMessagesCount > 0 && (
                                <span title={t("common.unreadMessages")} className={MENU_BADGE_BESKED}>{pendingWorkMessagesCount}</span>
                            )}
                            {pendingWorksCount > 0 && (
                                <span title={t("common.pendingApproval")} className={MENU_BADGE_GODKEND}>{pendingWorksCount}</span>
                            )}
                            {pendingWorkShareCount > 0 && (
                                <span title="Arbejdsandele til afstemning" className={MENU_BADGE_GODKEND}>{pendingWorkShareCount}</span>
                            )}
                        </span>
                    )}
                    {item.key === "kontraktgennemgang" && pendingReviewCount > 0 && <span title={t("common.pendingApproval")} className={`ml-auto ${MENU_BADGE_GODKEND}`}>{pendingReviewCount}</span>}
                    {item.key === "aftalelicens" && pendingScreeningCount > 0 && <span title={t("common.pendingApproval")} className={`ml-auto ${MENU_BADGE_GODKEND}`}>{pendingScreeningCount}</span>}
                </SidebarNavigationLink>
            </SidebarMenuButton>
        </SidebarMenuItem>
    )

    return (
        <SidebarProvider>
            <SidebarCloseOnNavigation />
            <Sidebar variant="inset">
                <SidebarHeader className="p-4">
                    <SidebarNavigationLink href="/admin" className="block">
                        {brand.logo_url ? (
                            <Image src={brand.logo_url} alt={brand.short_name} width={160} height={68} sizes="160px" loading="eager" fetchPriority="high" unoptimized className="h-[68px] w-[160px] object-contain" />
                        ) : (
                            <Image src="/logo.png" alt={brand.short_name} width={160} height={53} sizes="160px" preload className="h-[53px] w-[160px] object-contain dark:invert" />
                        )}
                    </SidebarNavigationLink>
                </SidebarHeader>

                <SidebarContent>
                    {/* Bruger-sektion vises kun for staff, som også er rettighedshaver. */}
                    {isAssociationMember && <>
                        <NavSection
                            title={t("nav.userSection" as Parameters<typeof t>[0])}
                            isOpen={brugerOpen}
                            onToggle={() => setBrugerOpen(o => !o)}
                        >
                            {userNavItems.map(item => (
                            <SidebarMenuItem key={item.key}>
                                <SidebarMenuButton asChild isActive={pathname === item.href || (pathname?.startsWith(`${item.href}/`) ?? false)}>
                                    <SidebarNavigationLink href={item.href}>
                                        <item.icon className="h-4 w-4" />
                                        <span>{item.label}</span>
                                    </SidebarNavigationLink>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                            ))}
                        </NavSection>
                        <Separator className="mx-4 my-1 w-auto" />
                    </>}

                    {/* Administrator-sektion */}
                    <NavSection
                        title={t("nav.adminSection" as Parameters<typeof t>[0])}
                        isOpen={adminOpen}
                        onToggle={() => setAdminOpen(o => !o)}
                    >
                        {adminItems.map(renderItem)}
                    </NavSection>

                    <Separator className="mx-4 my-1 w-auto" />

                    {/* Rettighedsbetaling-sektion */}
                    {rettighedsItems.length > 0 && (
                        <NavSection
                            title={t("nav.rightsPaymentsSection")}
                            isOpen={rettighedsOpen}
                            onToggle={() => setRettighedsOpen(o => !o)}
                        >
                            {rettighedsItems.map(renderItem)}
                        </NavSection>
                    )}

                    <Separator className="mx-4 my-1 w-auto" />

                    {/* Opsætning-sektion */}
                    {setupItems.length > 0 && (
                        <NavSection
                            title={t("nav.setupSection")}
                            isOpen={setupOpen || setupRouteActive}
                            onToggle={() => setSetupOpen(open => !open)}
                        >
                            {setupItems.map(renderItem)}
                        </NavSection>
                    )}
                </SidebarContent>

                <SidebarFooter>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton onClick={handleLogout}>
                                <LogOut className="h-4 w-4" />
                                <span>{t("nav.logout")}</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarFooter>
            </Sidebar>

            <SidebarInset className="min-w-0 max-w-full overflow-x-clip">
                <AppShellTopBar>
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="hidden h-4 sm:block" />
                    <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{currentPageTitle}</h1>
                    <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
                        <AdminCommandMenu inline />
                        {organisations.length > 1 && (
                            <label className="flex items-center gap-1.5">
                                <Building2 className="hidden h-4 w-4 text-muted-foreground sm:block" />
                                <span className="sr-only">Aktiv organisation</span>
                                <select
                                    aria-label="Aktiv organisation"
                                    value={activeOrgId}
                                    onChange={event => void handleOrganisationChange(event.target.value)}
                                    className="h-8 max-w-32 rounded-md border bg-background px-2 text-xs sm:max-w-52 sm:text-sm"
                                >
                                    {organisations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
                                </select>
                            </label>
                        )}
                        <AdminContextualHelp />
                        <LanguageToggle />
                        <ThemeToggle />
                    </div>
                </AppShellTopBar>
                <OnboardingRequirementBanner />
                <main className="min-w-0 max-w-full flex-1 overflow-x-clip p-3 sm:p-4 lg:p-6">{children}</main>
                <AdminListAutoTools />
            </SidebarInset>
        </SidebarProvider>
    )
}
