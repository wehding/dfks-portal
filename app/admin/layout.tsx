"use client"

import { useEffect, useState } from "react"
import { resolveBranding } from "@/lib/branding"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import {
    FileText,
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
    Film,
    Library,
    Layers,
    UserCheck,
    BrainCircuit,
    ShieldCheck,
    ChevronRight,
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

const ADMIN_NAV_ITEMS = [
    { key: "kontrakter",          href: "/admin/kontrakter",          icon: SHARED_NAV_ICONS.contracts,   labelKey: "nav.contracts"        },
    { key: "vaerker",             href: "/admin/vaerker",             icon: SHARED_NAV_ICONS.works,       labelKey: "nav.works"            },
    { key: "aftalelicens",        href: "/admin/aftalelicens",        icon: SHARED_NAV_ICONS.screenings,  labelKey: "nav.visningsadmin"    },
    { key: "rettighedshavere",    href: "/admin/rettighedshavere",    icon: UserCheck,   labelKey: "nav.rightsHolders"    },
    { key: "producenter",         href: "/admin/producenter",         icon: Building2,   labelKey: "nav.producers"        },
    { key: "kontraktgennemgang",  href: "/admin/kontraktgennemgang",  icon: Scale,       labelKey: "nav.contractReview"   },
    { key: "ai-kontrolrum",       href: "/admin/ai-kontrolrum",       icon: BrainCircuit, labelKey: "nav.aiKontrolrum"    },
    { key: "statistik",           href: "/admin/statistik",           icon: BarChart3,   labelKey: "nav.statistics"       },
    { key: "indbetalinger",       href: "/admin/indbetalinger",       icon: Receipt,     labelKey: "nav.producerPayments" },
    { key: "organisation",        href: "/admin/organisation",        icon: Building2,   labelKey: "nav.organisation"     },
    { key: "organisationer",      href: "/admin/organisationer",      icon: ShieldCheck, labelKey: "nav.organisations"    },
    { key: "brugere",             href: "/admin/brugere",             icon: Users2,      labelKey: "nav.users"            },
]

const RETTIGHEDS_NAV_ITEMS = [
    { key: "udbetalinger",        href: "/admin/udbetalinger",        icon: Wallet,      labelKey: "nav.payouts"          },
    { key: "streaming",           href: "/admin/streaming",           icon: Play,        labelKey: "nav.streaming"        },
    { key: "stamdata",            href: "/admin/stamdata",            icon: Database,    labelKey: "nav.masterData"       },
    { key: "gennemsigtighed",     href: "/admin/gennemsigtighed",     icon: ScrollText,  labelKey: "nav.transparency"     },
]

const USER_NAV_ITEMS = [
    { key: "mine-vaerker",        href: "/portal/mine-vaerker",       icon: SHARED_NAV_ICONS.works,     labelKey: "nav.myWorks"        },
    { key: "mine-kontrakter",     href: "/portal/mine-kontrakter",    icon: SHARED_NAV_ICONS.contracts, labelKey: "nav.myContracts"    },
    { key: "okonomi",             href: "/portal/okonomi",            icon: Wallet,   labelKey: "nav.economy"        },
    { key: "portal-aftalelicens", href: "/portal/mine-visninger",     icon: SHARED_NAV_ICONS.screenings, labelKey: "nav.mineVisninger"  },
    { key: "portal-gennemgang",   href: "/portal/kontraktgennemgang", icon: Scale,    labelKey: "nav.contractReview" },
]

const ALL_KEYS = [...ADMIN_NAV_ITEMS, ...RETTIGHEDS_NAV_ITEMS].map(i => i.key)

// Dæmpede, matchende menu-badges: blå = ulæste beskeder (samme blå som list-markeringen),
// amber = afventer godkendelse.
const MENU_BADGE_BASE = "inline-flex items-center justify-center h-5 min-w-5 rounded-full text-[10px] font-bold px-1"
const MENU_BADGE_BESKED = `${MENU_BADGE_BASE} bg-blue-100 text-blue-700`
const MENU_BADGE_GODKEND = `${MENU_BADGE_BASE} bg-amber-100 text-amber-800`

const ROLE_MODULES: Record<string, string[]> = {
    superadmin:  ALL_KEYS,
    admin:       ALL_KEYS.filter(k => k !== "organisationer"),
    "org-admin": ALL_KEYS.filter(k => k !== "stamdata" && k !== "brugere" && k !== "organisationer"),
    jurist:      ["kontrakter", "kontraktgennemgang"],
    viewer:      ["kontrakter", "statistik"],
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
    const [userRole, setUserRole] = useState<string>("admin")
    const [isSuperadmin, setIsSuperadmin] = useState<boolean>(false)
    const [pendingCount, setPendingCount] = useState<number>(0)
    const [pendingContractMessagesCount, setPendingContractMessagesCount] = useState<number>(0)
    const [pendingWorksCount, setPendingWorksCount] = useState<number>(0)
    const [pendingWorkMessagesCount, setPendingWorkMessagesCount] = useState<number>(0)
    const [isAssociationMember, setIsAssociationMember] = useState(false)

    // Kollaps-tilstand per sektion — åbne som default
    const [brugerOpen, setBrugerOpen] = useState(true)
    const [adminOpen, setAdminOpen] = useState(true)
    const [rettighedsOpen, setRettighedsOpen] = useState(true)
    const [brand, setBrand] = useState<{ logo_url: string | null; short_name: string }>({ logo_url: null, short_name: "DFKS" })

    useEffect(() => {
        const supabase = createClient()

        const fetchCount = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const { data: roleRow } = await supabase
                .from("user_org_roles")
                .select("org_id")
                .eq("user_id", user.id)
                .limit(1)
                .maybeSingle()
            const orgId = roleRow?.org_id
            if (!orgId) return

            supabase.from("organisations").select("name, logo_url, branding").eq("id", orgId).single().then(({ data: org }) => {
                if (!org) return
                const b = resolveBranding(org as never)
                setBrand({ logo_url: (org as { logo_url?: string | null }).logo_url ?? null, short_name: b.short_name })
            })

            const { data: memberRow } = await supabase
                .from("rettighedshavere")
                .select("id")
                .eq("user_id", user.id)
                .eq("org_id", orgId)
                .maybeSingle()
            setIsAssociationMember(Boolean(memberRow?.id))

            const [contractsRes, worksRes, contractMessagesRes, workMessagesRes] = await Promise.all([
                supabase.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "kladde"),
                supabase.from("work_change_requests").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "pending"),
                supabase.from("contract_comments").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("author_role", "member").is("admin_read_at", null),
                supabase.from("work_change_request_comments").select("id, work_change_requests!inner(org_id)", { count: "exact", head: true }).eq("author_role", "member").is("admin_read_at", null).eq("work_change_requests.org_id", orgId),
            ])
            setPendingCount(contractsRes.count ?? 0)
            setPendingWorksCount(worksRes.count ?? 0)
            setPendingContractMessagesCount(contractMessagesRes.count ?? 0)
            setPendingWorkMessagesCount(workMessagesRes.count ?? 0)
        }

        supabase.auth.getUser().then(async ({ data: { user } }) => {
            if (!user) return
            const { data: roles } = await supabase.from("user_org_roles").select("role").eq("user_id", user.id)
            const roleList = (roles ?? []).map(r => r.role)
            const primary = ["superadmin", "admin", "org-admin", "jurist", "viewer"].find(r => roleList.includes(r)) ?? "viewer"
            setUserRole(primary)
            setIsSuperadmin(roleList.includes("superadmin"))
            fetchCount()
        })

        window.addEventListener("contracts-updated", fetchCount)
        window.addEventListener("works-updated", fetchCount)
        return () => {
            window.removeEventListener("contracts-updated", fetchCount)
            window.removeEventListener("works-updated", fetchCount)
        }
    }, [])

    const handleLogout = async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push("/")
        router.refresh()
    }

    const allowedKeys = ROLE_MODULES[userRole] ?? ALL_KEYS

    const adminItems = ADMIN_NAV_ITEMS
        .filter(item => allowedKeys.includes(item.key))
        .map(item => ({ ...item, label: t(item.labelKey as Parameters<typeof t>[0]) }))

    const rettighedsItems = RETTIGHEDS_NAV_ITEMS
        .filter(item => allowedKeys.includes(item.key))
        .map(item => ({ ...item, label: t(item.labelKey as Parameters<typeof t>[0]) }))

    const userNavItems = USER_NAV_ITEMS
        .filter(item => item.key !== "portal-gennemgang" || isAssociationMember)
        .map(item => ({
            ...item,
            label: t(item.labelKey as Parameters<typeof t>[0]),
        }))

    const renderItem = (item: typeof adminItems[0]) => (
        <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
                asChild
                isActive={pathname === item.href || (pathname?.startsWith(`${item.href}/`) ?? false)}
            >
                <SidebarNavigationLink href={item.href}>
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {item.key === "kontrakter" && (pendingCount > 0 || pendingContractMessagesCount > 0) && (
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                            {pendingContractMessagesCount > 0 && (
                                <span title="Ulæste beskeder" className={MENU_BADGE_BESKED}>{pendingContractMessagesCount}</span>
                            )}
                            {pendingCount > 0 && (
                                <span title="Afventer godkendelse" className={MENU_BADGE_GODKEND}>{pendingCount}</span>
                            )}
                        </span>
                    )}
                    {item.key === "vaerker" && (pendingWorksCount > 0 || pendingWorkMessagesCount > 0) && (
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                            {pendingWorkMessagesCount > 0 && (
                                <span title="Ulæste beskeder" className={MENU_BADGE_BESKED}>{pendingWorkMessagesCount}</span>
                            )}
                            {pendingWorksCount > 0 && (
                                <span title="Afventer godkendelse" className={MENU_BADGE_GODKEND}>{pendingWorksCount}</span>
                            )}
                        </span>
                    )}
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
                    {/* Bruger-sektion */}
                    <NavSection
                        title={t("nav.userSection" as Parameters<typeof t>[0])}
                        isOpen={brugerOpen}
                        onToggle={() => setBrugerOpen(o => !o)}
                    >
                        {userNavItems.map(item => (
                            <SidebarMenuItem key={item.href}>
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
                            title="Rettighedsbetaling"
                            isOpen={rettighedsOpen}
                            onToggle={() => setRettighedsOpen(o => !o)}
                        >
                            {rettighedsItems.map(renderItem)}
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
                        <LanguageToggle />
                        <ThemeToggle />
                    </div>
                </header>
                <main className="min-w-0 flex-1 p-3 sm:p-4 lg:p-6">{children}</main>
            </SidebarInset>
        </SidebarProvider>
    )
}
