"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import {
    Film,
    FileText,
    Wallet,
    LogOut,
    Info,
    UserCircle,
    Layers,
    ScanSearch,
    Building2,
    CheckCircle,
    Play,
    BarChart3,
    Database,
    ScrollText,
    Award,
    Users2,
    Receipt,
    BookOpen,
    Scale,
    Library,
    UserCheck,
    FlaskConical,
    BrainCircuit,
    ShieldCheck,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
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

const ALL_ADMIN_NAV_ITEMS = [
    { key: "kontrakter",           href: "/admin/kontrakter",           icon: FileText,    labelKey: "nav.contracts"          },
    { key: "producenter",          href: "/admin/producenter",          icon: Building2,   labelKey: "nav.producers"          },
    { key: "rettighedshavere",    href: "/admin/rettighedshavere",    icon: UserCheck,   labelKey: "nav.rightsHolders"      },
    { key: "validering",          href: "/admin/validering",          icon: CheckCircle, labelKey: "nav.validation"         },
    { key: "overenskomster",     href: "/admin/overenskomster",     icon: BookOpen,    labelKey: "nav.agreements"       },
    { key: "kontraktgennemgang", href: "/admin/kontraktgennemgang", icon: Scale,       labelKey: "nav.contractReview"   },
    { key: "ai-kontrolrum",      href: "/admin/ai-kontrolrum",      icon: BrainCircuit, labelKey: "nav.aiKontrolrum"     },
    { key: "videnbase",          href: "/admin/videnbase",          icon: BrainCircuit, labelKey: "nav.knowledgeBase"    },
    { key: "kvalitet",           href: "/admin/kvalitet",           icon: FlaskConical, labelKey: "nav.quality"          },
    { key: "udbetalinger",       href: "/admin/udbetalinger",       icon: Wallet,      labelKey: "nav.payouts"          },
    { key: "vaerker",            href: "/admin/vaerker",            icon: Library,     labelKey: "nav.works"            },
    { key: "streaming",          href: "/admin/streaming",          icon: Play,        labelKey: "nav.streaming"        },
    { key: "aftalelicens",       href: "/admin/aftalelicens",       icon: Layers,      labelKey: "nav.aftalelicens"     },
    { key: "statistik",          href: "/admin/statistik",          icon: BarChart3,   labelKey: "nav.statistics"       },
    { key: "stamdata",           href: "/admin/stamdata",           icon: Database,    labelKey: "nav.masterData"       },
    { key: "gennemsigtighed",    href: "/admin/gennemsigtighed",    icon: ScrollText,  labelKey: "nav.transparency"     },
    { key: "krediteringer",      href: "/admin/krediteringer",      icon: Award,       labelKey: "nav.credits"          },
    { key: "indbetalinger",      href: "/admin/indbetalinger",      icon: Receipt,     labelKey: "nav.producerPayments" },
    { key: "brugere",            href: "/admin/brugere",            icon: Users2,      labelKey: "nav.users"            },
]

const ADMIN_KEYS = ALL_ADMIN_NAV_ITEMS.map(i => i.key)

const ROLE_MODULES: Record<string, string[]> = {
    superadmin:  ADMIN_KEYS,
    admin:       ADMIN_KEYS,
    "org-admin": ADMIN_KEYS.filter(k => k !== "stamdata" && k !== "brugere"),
    jurist:      ["validering", "kontraktgennemgang"],
    viewer:      ["kontrakter", "validering", "statistik"],
}

export default function PortalLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { t } = useI18n()
    const pathname = usePathname()
    const router = useRouter()
    const [roleList, setRoleList] = useState<string[]>([])
    const [pendingCount, setPendingCount] = useState<number>(0)

    useEffect(() => {
        const supabase = createClient()

        const fetchCount = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const orgId = user?.user_metadata?.org_id ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"
            const { count } = await supabase
                .from("contracts")
                .select("id", { count: "exact", head: true })
                .eq("org_id", orgId)
                .eq("status", "kladde")
            setPendingCount(count ?? 0)
        }

        supabase.auth.getUser().then(async ({ data: { user } }) => {
            if (!user) return
            const { data: roles } = await supabase
                .from("user_org_roles")
                .select("role")
                .eq("user_id", user.id)
            setRoleList((roles ?? []).map(r => r.role))
            fetchCount()
        })

        window.addEventListener("contracts-updated", fetchCount)
        return () => window.removeEventListener("contracts-updated", fetchCount)
    }, [])

    const portalNavItems = [
        {
            label: t("nav.myWorks"),
            href: "/portal/mine-vaerker",
            icon: Film,
        },
        {
            label: t("nav.myContracts"),
            href: "/portal/mine-kontrakter",
            icon: FileText,
        },
        {
            label: t("nav.economy"),
            href: "/portal/okonomi",
            icon: Wallet,
        },
        {
            label: "Aftalelicens",
            href: "/portal/aftalelicens",
            icon: Layers,
        },
        {
            label: "Kontraktgennemgang",
            href: "/portal/kontraktgennemgang",
            icon: ScanSearch,
        },
        {
            label: "Min profil",
            href: "/portal/min-profil",
            icon: UserCircle,
        },
    ]

    const adminUserNavItems = portalNavItems.filter(item => item.href !== "/portal/min-profil")
    const primaryRole = ["superadmin", "admin", "org-admin", "jurist", "viewer"]
        .find(role => roleList.includes(role)) ?? null
    const hasAdminMenu = primaryRole !== null
    const isSuperadmin = roleList.includes("superadmin")
    const allowedKeys = ROLE_MODULES[primaryRole ?? ""] ?? []
    const adminNavItems = ALL_ADMIN_NAV_ITEMS
        .filter(item => allowedKeys.includes(item.key))
        .map(item => ({
            ...item,
            label: t(item.labelKey as Parameters<typeof t>[0]),
        }))

    const handleLogout = async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push("/")
        router.refresh()
    }

    return (
        <SidebarProvider>
            <Sidebar variant="inset">
                <SidebarHeader className="p-4">
                    <Link href="/portal/mine-vaerker" className="block">
                        <Image
                            src="/logo.png"
                            alt="DFKS"
                            width={160}
                            height={68}
                            className="dark:invert"
                        />
                    </Link>
                </SidebarHeader>

                <SidebarContent>
                    {hasAdminMenu ? (
                        <>
                            <SidebarGroup>
                                <SidebarGroupContent>
                                    <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                        {t("nav.userSection" as Parameters<typeof t>[0])}
                                    </div>
                                    <SidebarMenu>
                                        {adminUserNavItems.map((item) => (
                                            <SidebarMenuItem key={item.href}>
                                                <SidebarMenuButton
                                                    asChild
                                                    isActive={pathname === item.href}
                                                >
                                                    <Link href={item.href}>
                                                        <item.icon className="h-4 w-4" />
                                                        <span>{item.label}</span>
                                                    </Link>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        ))}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>

                            <Separator className="mx-4 my-2 w-auto" />

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
                                                    isActive={pathname === item.href}
                                                >
                                                    <Link href={item.href}>
                                                        <item.icon className="h-4 w-4" />
                                                        <span>{item.label}</span>
                                                        {item.key === "validering" && pendingCount > 0 && (
                                                            <span className="ml-auto inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1">
                                                                {pendingCount}
                                                            </span>
                                                        )}
                                                    </Link>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        ))}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>
                        </>
                    ) : (
                        <SidebarGroup>
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    {portalNavItems.map((item) => (
                                        <SidebarMenuItem key={item.href}>
                                            <SidebarMenuButton
                                                asChild
                                                isActive={pathname === item.href}
                                            >
                                                <Link href={item.href}>
                                                    <item.icon className="h-4 w-4" />
                                                    <span>{item.label}</span>
                                                </Link>
                                            </SidebarMenuButton>
                                        </SidebarMenuItem>
                                    ))}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    )}
                </SidebarContent>

                <SidebarFooter>
                    {!hasAdminMenu && (
                        <div className="mx-2 mb-2 rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-transparent px-3 py-2.5 space-y-1">
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                                <Info className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                AI-assisteret system
                            </div>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                                DFKS bruger AI til at screene kontrakter og behandle rettighedsbetalinger. Personfølsomme data anonymiseres inden behandling, og AI-tjenesten træner ikke på dine data.
                            </p>
                        </div>
                    )}
                    <SidebarMenu>
                        {isSuperadmin && (
                            <SidebarMenuItem>
                                <SidebarMenuButton asChild>
                                    <Link href="/superadmin/organisationer">
                                        <ShieldCheck className="h-4 w-4" />
                                        <span>Superadmin</span>
                                    </Link>
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

            <SidebarInset className="min-w-0 overflow-x-hidden">
                <header className="flex h-12 items-center gap-2 border-b px-4">
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="h-4" />
                    <span className="text-sm font-medium text-muted-foreground">
                        {t("nav.portal")}
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                        <LanguageToggle />
                        <ThemeToggle />
                    </div>
                </header>
                <main className="flex-1 p-4 md:p-6">{children}</main>
            </SidebarInset>
        </SidebarProvider>
    )
}
