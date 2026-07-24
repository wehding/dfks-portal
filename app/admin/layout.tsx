"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
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
import { AdminCommandMenu } from "@/components/admin/admin-command-menu"
import { AdminContextualHelp } from "@/components/admin/admin-contextual-help"

const ADMIN_NAV_ITEMS = [
    { key: "overblik",            href: "/admin",                     icon: Home,        labelKey: "nav.dashboard"        },
    { key: "kontrakter",          href: "/admin/kontrakter",          icon: SHARED_NAV_ICONS.contracts,   labelKey: "nav.contracts"        },
    { key: "vaerker",             href: "/admin/vaerker",             icon: SHARED_NAV_ICONS.works,       labelKey: "nav.works"            },
    { key: "aftalelicens",        href: "/admin/aftalelicens",        icon: SHARED_NAV_ICONS.screenings,  labelKey: "nav.visningsadmin"    },
    { key: "rettighedshavere",    href: "/admin/rettighedshavere",    icon: UserCheck,   labelKey: "nav.rightsHolders"    },
    { key: "producenter",         href: "/admin/producenter",         icon: Building2,   labelKey: "nav.producers"        },
    { key: "kontraktgennemgang",  href: "/admin/kontraktgennemgang",  icon: Scale,       labelKey: "nav.contractReview"   },
    { key: "statistik",           href: "/admin/statistik",           icon: BarChart3,   labelKey: "nav.statistics"       },
    { key: "indbetalinger",       href: "/admin/indbetalinger",       icon: Receipt,     labelKey: "nav.producerPayments" },
]

const SETUP_NAV_ITEMS = [
    { key: "ai-kontrolrum",       href: "/admin/ai-kontrolrum",       icon: BrainCircuit, labelKey: "nav.aiKontrolrum"    },
    { key: "organisation",        href: "/admin/organisation",        icon: Building2,   labelKey: "nav.organisation"     },
    { key: "brugere",             href: "/admin/brugere",             icon: Users2,      labelKey: "nav.users"            },
    { key: "min-profil",          href: "/admin/min-profil",          icon: UserCog,     labelKey: "nav.minProfil"        },
    { key: "organisationer",      href: "/admin/organisationer",      icon: ShieldCheck, labelKey: "nav.organisations"    },
]

const RETTIGHEDS_NAV_ITEMS = [
    { key: "udbetalinger",        href: "/admin/udbetalinger",        icon: Wallet,      labelKey: "nav.payouts"          },
    { key: "streaming",           href: "/admin/streaming",           icon: Play,        labelKey: "nav.streaming"        },
    { key: "stamdata",            href: "/admin/stamdata",            icon: Database,    labelKey: "nav.masterData"       },
    { key: "gennemsigtighed",     href: "/admin/gennemsigtighed",     icon: ScrollText,  labelKey: "nav.transparency"     },
]

const USER_NAV_ITEMS = [
    { key: "portal-overblik",     href: "/portal",                    icon: Home,     labelKey: "nav.dashboard"      },
    { key: "mine-vaerker",        href: "/portal/mine-vaerker",       icon: SHARED_NAV_ICONS.works,     labelKey: "nav.myWorks"        },
    { key: "mine-kontrakter",     href: "/portal/mine-kontrakter",    icon: SHARED_NAV_ICONS.contracts, labelKey: "nav.myContracts"    },
    { key: "okonomi",             href: "/portal/okonomi",            icon: Wallet,   labelKey: "nav.economy"        },
    { key: "portal-aftalelicens", href: "/portal/mine-visninger",     icon: SHARED_NAV_ICONS.screenings, labelKey: "nav.mineVisninger"  },
    { key: "portal-gennemgang",   href: "/portal/kontraktgennemgang", icon: Scale,    labelKey: "nav.contractReview" },
]

const ALL_KEYS = [...ADMIN_NAV_ITEMS, ...SETUP_NAV_ITEMS, ...RETTIGHEDS_NAV_ITEMS].map(i => i.key)

// Dæmpede, matchende menu-badges: blå = ulæste beskeder (samme blå som list-markeringen),
// amber = afventer godkendelse.
const MENU_BADGE_BASE = "inline-flex items-center justify-center h-5 min-w-5 rounded-full text-[10px] font-bold px-1"
const MENU_BADGE_BESKED = `${MENU_BADGE_BASE} bg-blue-100 text-blue-700`
const MENU_BADGE_GODKEND = `${MENU_BADGE_BASE} bg-amber-100 text-amber-800`

const ROLE_MODULES: Record<string, string[]> = {
    superadmin:  ALL_KEYS,
    admin:       ALL_KEYS.filter(k => k !== "organisationer"),
    "org-admin": ALL_KEYS.filter(k => k !== "stamdata" && k !== "brugere" && k !== "organisationer"),
    jurist:      ["overblik", "kontrakter", "kontraktgennemgang"],
    viewer:      ["overblik", "kontrakter", "statistik"],
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

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const { t } = useI18n()
    const pathname = usePathname()
    const router = useRouter()
    const [userRole, setUserRole] = useState<string | null>(null)
    const [pendingCount, setPendingCount] = useState<number>(0)
    const [pendingContractMessagesCount, setPendingContractMessagesCount] = useState<number>(0)
    const [pendingWorksCount, setPendingWorksCount] = useState<number>(0)
    const [pendingWorkMessagesCount, setPendingWorkMessagesCount] = useState<number>(0)
    const [pendingReviewCount, setPendingReviewCount] = useState<number>(0)
    const [pendingScreeningCount, setPendingScreeningCount] = useState<number>(0)
    const [isAssociationMember, setIsAssociationMember] = useState(false)

    // Kollaps-tilstand per sektion. Opsætning er lukket som standard.
    const [brugerOpen, setBrugerOpen] = useState(true)
    const [adminOpen, setAdminOpen] = useState(true)
    const [setupOpen, setSetupOpen] = useState(false)
    const [rettighedsOpen, setRettighedsOpen] = useState(true)
    const [brand, setBrand] = useState<{ logo_url: string | null; short_name: string }>({ logo_url: null, short_name: "DFKS" })

    useEffect(() => {
        const supabase = createClient()

        const loadContextAndCounts = async () => {
            const contextResponse = await fetch("/api/admin/context", { cache: "no-store" })
            if (!contextResponse.ok) {
                setUserRole(null)
                return
            }
            const context = await contextResponse.json() as {
                orgId: string
                role: string
                isAssociationMember: boolean
                brand: { logo_url: string | null; short_name: string }
            }
            setUserRole(context.role)
            setIsAssociationMember(context.isAssociationMember)
            setBrand(context.brand)
            const orgId = context.orgId

            const [contractsRes, worksRes, contractMessagesRes, workMessagesRes, reviewsRes, screeningsRes] = await Promise.all([
                supabase.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "kladde").not("work_id", "is", null),
                supabase.from("work_change_requests").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "pending"),
                supabase.from("contract_comments").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("author_role", "member").is("admin_read_at", null),
                supabase.from("work_change_request_comments").select("id, work_change_requests!inner(org_id)", { count: "exact", head: true }).eq("author_role", "member").is("admin_read_at", null).eq("work_change_requests.org_id", orgId),
                supabase.from("contract_reviews").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("status", ["afventer", "behandling"]),
                supabase.from("screening_claims").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "pending"),
            ])
            setPendingCount(contractsRes.count ?? 0)
            setPendingWorksCount(worksRes.count ?? 0)
            setPendingContractMessagesCount(contractMessagesRes.count ?? 0)
            setPendingWorkMessagesCount(workMessagesRes.count ?? 0)
            setPendingReviewCount(reviewsRes.count ?? 0)
            setPendingScreeningCount(screeningsRes.count ?? 0)
        }

        void loadContextAndCounts()

        window.addEventListener("contracts-updated", loadContextAndCounts)
        window.addEventListener("works-updated", loadContextAndCounts)
        window.addEventListener("admin-context-updated", loadContextAndCounts)
        return () => {
            window.removeEventListener("contracts-updated", loadContextAndCounts)
            window.removeEventListener("works-updated", loadContextAndCounts)
            window.removeEventListener("admin-context-updated", loadContextAndCounts)
        }
    }, [])

    const setupRouteActive = SETUP_NAV_ITEMS.some(item => pathname === item.href || pathname.startsWith(`${item.href}/`))

    const handleLogout = async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push("/")
        router.refresh()
    }

    const allowedKeys = userRole ? (ROLE_MODULES[userRole] ?? []) : []

    const adminItems = ADMIN_NAV_ITEMS
        .filter(item => allowedKeys.includes(item.key))
        .map(item => ({ ...item, label: t(item.labelKey as Parameters<typeof t>[0]) }))

    const rettighedsItems = RETTIGHEDS_NAV_ITEMS
        .filter(item => allowedKeys.includes(item.key))
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
                    {item.key === "vaerker" && (pendingWorksCount > 0 || pendingWorkMessagesCount > 0) && (
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                            {pendingWorkMessagesCount > 0 && (
                                <span title={t("common.unreadMessages")} className={MENU_BADGE_BESKED}>{pendingWorkMessagesCount}</span>
                            )}
                            {pendingWorksCount > 0 && (
                                <span title={t("common.pendingApproval")} className={MENU_BADGE_GODKEND}>{pendingWorksCount}</span>
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
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={brand.logo_url} alt={brand.short_name} style={{ maxWidth: 160, maxHeight: 68, objectFit: "contain" }} />
                        ) : (
                            <Image src="/logo.png" alt={brand.short_name} width={160} height={68} className="dark:invert" />
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

            <SidebarInset>
                <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-4">
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="h-4" />
                    <span className="text-sm font-medium text-muted-foreground">{t("nav.admin")}</span>
                    <div className="ml-auto flex items-center gap-1">
                        <AdminContextualHelp />
                        <LanguageToggle />
                        <ThemeToggle />
                    </div>
                </header>
                <main className="min-w-0 flex-1 p-3 sm:p-4 lg:p-6">{children}</main>
            </SidebarInset>
            <AdminCommandMenu />
        </SidebarProvider>
    )
}
