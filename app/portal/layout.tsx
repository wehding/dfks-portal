"use client"

import { Fragment, useEffect, useState } from "react"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import {
    Wallet,
    LogOut,
    UserCircle,
    ScanSearch,
    Building2,
    Play,
    BarChart3,
    Database,
    ScrollText,
    Users2,
    Receipt,
    Scale,
    UserCheck,
    BrainCircuit,
    ShieldCheck,
    Home,
    BadgeCheck,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { getAccessContextCached, invalidateAccessContextCache } from "@/lib/access-context-client"
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
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { SHARED_NAV_ICONS } from "@/lib/navigation-icons"
import { SidebarCloseOnNavigation, SidebarNavigationLink } from "@/components/navigation/sidebar-navigation-link"
import { AppShellTopBar } from "@/components/navigation/app-shell-top-bar"
import { resolveNavigationTitle } from "@/lib/navigation-title"
import { PortalContextualHelp } from "@/components/portal/portal-contextual-help"
import { OnboardingRequirementBanner } from "@/components/onboarding-requirement-banner"
import { fetchMemberWorkReviewTasks } from "@/app/actions/work-collaboration-reviews"
import { uniqueMemberWorkReviewCount } from "@/lib/member-work-review"

const ALL_ADMIN_NAV_ITEMS = [
    { key: "kontrakter",           href: "/admin/kontrakter",           icon: SHARED_NAV_ICONS.contracts,   labelKey: "nav.contracts"          },
    { key: "vaerker",            href: "/admin/vaerker",            icon: SHARED_NAV_ICONS.works,       labelKey: "nav.works"            },
    { key: "aftalelicens",       href: "/admin/aftalelicens",       icon: SHARED_NAV_ICONS.screenings,  labelKey: "nav.visningsadmin"    },
    { key: "rettighedshavere",    href: "/admin/rettighedshavere",    icon: UserCheck,   labelKey: "nav.rightsHolders"      },
    { key: "producenter",          href: "/admin/producenter",          icon: Building2,   labelKey: "nav.producers"          },
    { key: "kontraktgennemgang", href: "/admin/kontraktgennemgang", icon: Scale,       labelKey: "nav.contractReview"   },
    { key: "udbetalinger",       href: "/admin/udbetalinger",       icon: Wallet,      labelKey: "nav.payouts"          },
    { key: "streaming",          href: "/admin/streaming",          icon: Play,        labelKey: "nav.streaming"        },
    { key: "statistik",          href: "/admin/statistik",          icon: BarChart3,   labelKey: "nav.statistics"       },
    { key: "stamdata",           href: "/admin/stamdata",           icon: Database,    labelKey: "nav.masterData"       },
    { key: "gennemsigtighed",    href: "/admin/gennemsigtighed",    icon: ScrollText,  labelKey: "nav.transparency"     },
    { key: "indbetalinger",      href: "/admin/indbetalinger",      icon: Receipt,     labelKey: "nav.producerPayments" },
]

const SETUP_ADMIN_NAV_ITEMS = [
    { key: "ai-kontrolrum",      href: "/admin/ai-kontrolrum",      icon: BrainCircuit, labelKey: "nav.aiKontrolrum"     },
    { key: "organisation",       href: "/admin/organisation",       icon: Building2,   labelKey: "nav.organisation"     },
    { key: "brugere",            href: "/admin/brugere",            icon: Users2,      labelKey: "nav.users"            },
    { key: "organisationer",     href: "/admin/organisationer",     icon: ShieldCheck, labelKey: "nav.organisations"    },
    { key: "imdb-kontrol",       href: "/admin/imdb-kontrol",       icon: BadgeCheck,  labelKey: "nav.imdbControl"      },
]

const ADMIN_KEYS = [...ALL_ADMIN_NAV_ITEMS, ...SETUP_ADMIN_NAV_ITEMS].map(i => i.key)

const ROLE_MODULES: Record<string, string[]> = {
    superadmin:  ADMIN_KEYS,
    admin:       ADMIN_KEYS.filter(k => k !== "organisationer" && k !== "imdb-kontrol"),
    "org-admin": ADMIN_KEYS.filter(k => k !== "stamdata" && k !== "brugere" && k !== "imdb-kontrol"),
    jurist:      ["kontrakter", "kontraktgennemgang"],
    viewer:      ["kontrakter", "statistik"],
}

type WorkRequestCounterRow = {
    work_change_request_comments?: Array<{ author_role: string; member_read_at: string | null }>
}

type ContractCommentCounterRow = {
    author_role: string
    member_read_at: string | null
}
type InboxParticipantCounterRow = { last_read_at: string | null; member_message_threads: { member_messages: Array<{ author_role: string; created_at: string }> } | null }
type AccessContextResponse = {
    userId: string
    orgId: string
    rightsHolderId: string | null
    role: string | null
    global: boolean
    canUseAdmin: boolean
    canUseMember: boolean
    brand: { logo_url: string | null; short_name: string; long_name: string }
    organisations: Array<{ id: string; name: string; canUseAdmin: boolean; canUseMember: boolean }>
}

export default function PortalLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { t } = useI18n()
    const pathname = usePathname()
    const router = useRouter()
    const [activeRole, setActiveRole] = useState<string | null>(null)
    const [isSuperadmin, setIsSuperadmin] = useState(false)
    const [hasAdminMenu, setHasAdminMenu] = useState(false)
    const [activeOrgId, setActiveOrgId] = useState("")
    const [organisations, setOrganisations] = useState<AccessContextResponse["organisations"]>([])
    const [pendingCount, setPendingCount] = useState<number>(0)
    const [pendingWorksCount, setPendingWorksCount] = useState<number>(0)
    const [pendingContractMessagesCount, setPendingContractMessagesCount] = useState<number>(0)
    const [workMessageCount, setWorkMessageCount] = useState<number>(0)
    const [memberEpisodeTodoCount, setMemberEpisodeTodoCount] = useState<number>(0)
    const [contractMessageCount, setContractMessageCount] = useState<number>(0)
    const [inboxMessageCount, setInboxMessageCount] = useState<number>(0)
    const [brand, setBrand] = useState<{ logo_url: string | null; short_name: string; long_name: string }>({ logo_url: null, short_name: "DFKS", long_name: "DFKS" })
    const [isAssociationMember, setIsAssociationMember] = useState(false)

    useEffect(() => {
        const supabase = createClient()

        const fetchCount = async () => {
            const contextResponse = await getAccessContextCached<AccessContextResponse>()
            if (!contextResponse.ok) {
                if (contextResponse.status === 401) {
                    router.replace("/")
                    router.refresh()
                }
                return
            }
            const context = contextResponse.data!
            if (!context.canUseMember || !context.rightsHolderId) {
                router.replace(context.canUseAdmin ? "/admin" : "/")
                return
            }
            const orgId = context.orgId
            const rightsHolderId = context.rightsHolderId
            setActiveOrgId(orgId)
            setActiveRole(context.role)
            setIsSuperadmin(context.global)
            setHasAdminMenu(context.canUseAdmin)
            setIsAssociationMember(context.canUseMember)
            setBrand(context.brand)
            setOrganisations(context.organisations)

            const [contractsRes, worksRes, contractMessagesRes] = await Promise.all([
                supabase.from("contracts").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "kladde"),
                supabase.from("work_change_requests").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "pending"),
                supabase.from("contract_comments").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("author_role", "member").is("admin_read_at", null),
            ])
            setPendingCount(contractsRes.count ?? 0)
            setPendingWorksCount(worksRes.count ?? 0)
            setPendingContractMessagesCount(contractMessagesRes.count ?? 0)

            const { data: requests } = await supabase
                .from("work_change_requests")
                .select("id, work_change_request_comments(id, author_role, member_read_at)")
                .eq("org_id", orgId)
                .eq("requested_by_user_id", context.userId)
            setWorkMessageCount(((requests ?? []) as WorkRequestCounterRow[]).reduce((sum, request) => {
                const comments = request.work_change_request_comments ?? []
                return sum + comments.filter(comment => comment.author_role === "admin" && !comment.member_read_at).length
            }, 0))

            if (rightsHolderId) {
                const [reviewResult, { count: shareTodoCount }] = await Promise.all([
                    fetchMemberWorkReviewTasks({ rightsHolderId }),
                    supabase.from("work_share_participants").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("rights_holder_id", rightsHolderId).eq("relationship_status", "pending"),
                ])
                const workReviewCount = reviewResult.success ? uniqueMemberWorkReviewCount(reviewResult.tasks) : 0
                setMemberEpisodeTodoCount(workReviewCount + (shareTodoCount ?? 0))
                const { data: comments } = await supabase
                    .from("contract_comments")
                    .select("id, author_role, member_read_at, contracts!inner(rights_holder_id,org_id)")
                    .eq("contracts.org_id", orgId)
                    .eq("contracts.rights_holder_id", rightsHolderId)
                setContractMessageCount(((comments ?? []) as ContractCommentCounterRow[]).filter(comment => comment.author_role === "admin" && !comment.member_read_at).length)
            }
            const { data: inboxParticipants } = await supabase.from("member_message_participants")
                .select("last_read_at,member_message_threads!inner(org_id,member_messages(author_role,created_at))")
                .eq("user_id", context.userId)
                .eq("member_message_threads.org_id", orgId)
            setInboxMessageCount(((inboxParticipants ?? []) as unknown as InboxParticipantCounterRow[]).reduce((sum, participant) => sum + (participant.member_message_threads?.member_messages ?? []).filter(message => message.author_role === "admin" && message.created_at > (participant.last_read_at ?? "")).length, 0))
        }

        void fetchCount()

        window.addEventListener("contracts-updated", fetchCount)
        window.addEventListener("works-updated", fetchCount)
        window.addEventListener("admin-context-updated", fetchCount)
        return () => {
            window.removeEventListener("contracts-updated", fetchCount)
            window.removeEventListener("works-updated", fetchCount)
            window.removeEventListener("admin-context-updated", fetchCount)
        }
    }, [router])

    const portalNavItems = [
        {
            label: t("nav.dashboard"),
            href: "/portal",
            icon: Home,
        },
        {
            label: t("nav.myWorks"),
            href: "/portal/mine-vaerker",
            icon: SHARED_NAV_ICONS.works,
        },
        {
            label: t("nav.myContracts"),
            href: "/portal/mine-kontrakter",
            icon: SHARED_NAV_ICONS.contracts,
        },
        {
            label: t("nav.economy"),
            href: "/portal/okonomi",
            icon: Wallet,
        },
        {
            label: t("nav.mineVisninger"),
            href: "/portal/mine-visninger",
            icon: SHARED_NAV_ICONS.screenings,
        },
        {
            label: t("nav.myDataAccess"),
            href: "/portal/mine-data",
            icon: ShieldCheck,
        },
        {
            label: t("nav.contractReview"),
            href: "/portal/kontraktgennemgang",
            icon: ScanSearch,
        },
        {
            label: t("nav.myProfile"),
            href: "/portal/min-profil",
            icon: UserCircle,
        },
    ]

    const visiblePortalNavItems = portalNavItems.filter(item => item.href !== "/portal/kontraktgennemgang" || isAssociationMember)
    const adminUserNavItems = isAssociationMember ? visiblePortalNavItems : []
    const myDataAccessNavItem = portalNavItems.find(item => item.href === "/portal/mine-data")
    const allowedKeys = ROLE_MODULES[activeRole ?? ""] ?? []
    const adminNavItems = ALL_ADMIN_NAV_ITEMS
        .filter(item => allowedKeys.includes(item.key))
        .map(item => ({
            ...item,
            label: t(item.labelKey as Parameters<typeof t>[0]),
        }))
    const setupNavItems = SETUP_ADMIN_NAV_ITEMS
        .filter(item => allowedKeys.includes(item.key))
        .map(item => ({
            ...item,
            label: t(item.labelKey as Parameters<typeof t>[0]),
        }))
    const currentPageTitle = resolveNavigationTitle(pathname, visiblePortalNavItems, t("nav.portal"))

    const renderPortalNavItem = (item: (typeof portalNavItems)[number]) => {
        if (item.href === "/portal/mine-data") return null

        const isActive = pathname === item.href ||
            (item.href !== "/portal" && (pathname?.startsWith(`${item.href}/`) ?? false)) ||
            (item.href === "/portal/min-profil" && pathname === "/portal/mine-data")

        return (
            <Fragment key={item.href}>
                <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive}>
                        <SidebarNavigationLink href={item.href}>
                            <item.icon className="h-4 w-4" />
                            <span>{item.label}</span>
                            {item.href === "/portal/mine-vaerker" && (workMessageCount + memberEpisodeTodoCount) > 0 && (
                                <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                                    {workMessageCount + memberEpisodeTodoCount}
                                </span>
                            )}
                            {item.href === "/portal/mine-kontrakter" && contractMessageCount > 0 && (
                                <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                                    {contractMessageCount}
                                </span>
                            )}
                            {item.href === "/portal" && inboxMessageCount > 0 && <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">{inboxMessageCount}</span>}
                        </SidebarNavigationLink>
                    </SidebarMenuButton>
                    {item.href === "/portal/min-profil" && myDataAccessNavItem && (
                        <SidebarMenuSub>
                            <SidebarMenuSubItem>
                                <SidebarMenuSubButton asChild isActive={pathname === myDataAccessNavItem.href}>
                                    <SidebarNavigationLink href={myDataAccessNavItem.href}>
                                        <myDataAccessNavItem.icon className="h-4 w-4" />
                                        <span>{myDataAccessNavItem.label}</span>
                                    </SidebarNavigationLink>
                                </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                        </SidebarMenuSub>
                    )}
                </SidebarMenuItem>
            </Fragment>
        )
    }

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
        window.dispatchEvent(new Event("admin-context-updated"))
        if (!result.canUseMember && result.canUseAdmin) router.replace("/admin")
        else router.refresh()
    }

    return (
        <SidebarProvider>
            <SidebarCloseOnNavigation />
            <Sidebar variant="inset">
                <SidebarHeader className="p-4">
                    <SidebarNavigationLink href="/portal" className="block">
                        {brand.logo_url ? (
                            // Foreningens eget logo (kan være ekstern URL/data-URI) — plain img undgår next/image domæne-config
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={brand.logo_url} alt={brand.short_name} style={{ maxWidth: 160, maxHeight: 68, objectFit: "contain" }} />
                        ) : (
                            <Image
                                src="/logo.png"
                                alt={brand.short_name}
                                width={160}
                                height={68}
                                className="dark:invert"
                            />
                        )}
                    </SidebarNavigationLink>
                </SidebarHeader>

                <SidebarContent>
                    {hasAdminMenu ? (
                        <>
                            {adminUserNavItems.length > 0 && <SidebarGroup>
                                <SidebarGroupContent>
                                    <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                        {t("nav.userSection" as Parameters<typeof t>[0])}
                                    </div>
                                    <SidebarMenu>
                                        {adminUserNavItems.map(renderPortalNavItem)}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>}

                            {adminUserNavItems.length > 0 && <Separator className="mx-4 my-2 w-auto" />}

                            <SidebarGroup>
                                <SidebarGroupContent>
                                    <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                        {t("nav.adminSection" as Parameters<typeof t>[0])}
                                    </div>
                                    <SidebarMenu>
                                        {adminNavItems.map((item) => (
                                            <SidebarMenuItem key={item.href}>
                                                <SidebarMenuButton
                                                    asChild
                                                    isActive={
                                                        pathname === item.href ||
                                                        (item.href !== "/portal" && (pathname?.startsWith(`${item.href}/`) ?? false))
                                                    }
                                                >
                                                    <SidebarNavigationLink href={item.href}>
                                                        <item.icon className="h-4 w-4" />
                                                        <span>{item.label}</span>
                                                        {item.key === "kontrakter" && (pendingCount + pendingContractMessagesCount) > 0 && (
                                                            <span className="ml-auto inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1">
                                                                {pendingCount + pendingContractMessagesCount}
                                                            </span>
                                                        )}
                                                        {item.key === "vaerker" && pendingWorksCount > 0 && (
                                                            <span className="ml-auto inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1">
                                                                {pendingWorksCount}
                                                            </span>
                                                        )}
                                                    </SidebarNavigationLink>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        ))}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>

                            {setupNavItems.length > 0 && (
                                <>
                                    <Separator className="mx-4 my-2 w-auto" />
                                    <SidebarGroup>
                                        <SidebarGroupContent>
                                            <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                                {t("nav.setupSection")}
                                            </div>
                                            <SidebarMenu>
                                                {setupNavItems.map(item => (
                                                    <SidebarMenuItem key={item.href}>
                                                        <SidebarMenuButton
                                                            asChild
                                                            isActive={pathname === item.href || (item.href !== "/portal" && (pathname?.startsWith(`${item.href}/`) ?? false))}
                                                        >
                                                            <SidebarNavigationLink href={item.href}>
                                                                <item.icon className="h-4 w-4" />
                                                                <span>{item.label}</span>
                                                            </SidebarNavigationLink>
                                                        </SidebarMenuButton>
                                                    </SidebarMenuItem>
                                                ))}
                                            </SidebarMenu>
                                        </SidebarGroupContent>
                                    </SidebarGroup>
                                </>
                            )}
                        </>
                    ) : (
                        <SidebarGroup>
                            <SidebarGroupContent>
                                <SidebarMenu>
                                        {visiblePortalNavItems.map(renderPortalNavItem)}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    )}
                </SidebarContent>

                <SidebarFooter>
                    <SidebarMenu>
                        {isSuperadmin && (
                            <SidebarMenuItem>
                                <SidebarMenuButton asChild>
                                    <SidebarNavigationLink href="/admin/organisationer">
                                        <ShieldCheck className="h-4 w-4" />
                                        <span>{t("nav.superadmin")}</span>
                                    </SidebarNavigationLink>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        )}
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
                    <SidebarTrigger className="shrink-0" />
                    <Separator orientation="vertical" className="hidden h-4 sm:block" />
                    <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
                        {currentPageTitle}
                    </h1>
                    <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
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
                        <PortalContextualHelp />
                        <LanguageToggle />
                        <ThemeToggle />
                    </div>
                </AppShellTopBar>
                <OnboardingRequirementBanner />
                <main className="min-w-0 max-w-full flex-1 overflow-x-clip p-3 sm:p-4 lg:p-6">{children}</main>
            </SidebarInset>
        </SidebarProvider>
    )
}
