"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
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
    Award,
    Users2,
    Receipt,
    BookOpen,
    Scale,
    Film,
    Library,
    Layers,
    UserCheck,
    FlaskConical,
    BrainCircuit,
    ShieldCheck,
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

const ALL_NAV_ITEMS = [
    { key: "kontrakter",           href: "/admin/kontrakter",           icon: FileText,    labelKey: "nav.contracts"          },
    { key: "vaerker",            href: "/admin/vaerker",            icon: Library,     labelKey: "nav.works"            },
    { key: "rettighedshavere",    href: "/admin/rettighedshavere",    icon: UserCheck,   labelKey: "nav.rightsHolders"      },
    { key: "producenter",          href: "/admin/producenter",          icon: Building2,   labelKey: "nav.producers"          },
    { key: "overenskomster",     href: "/admin/overenskomster",     icon: BookOpen,    labelKey: "nav.agreements"       },
    { key: "kontraktgennemgang", href: "/admin/kontraktgennemgang", icon: Scale,       labelKey: "nav.contractReview"   },
    { key: "ai-kontrolrum",      href: "/admin/ai-kontrolrum",      icon: BrainCircuit, labelKey: "nav.aiKontrolrum"     },
    { key: "videnbase",          href: "/admin/videnbase",          icon: BrainCircuit, labelKey: "nav.knowledgeBase"    },
    { key: "udbetalinger",       href: "/admin/udbetalinger",       icon: Wallet,      labelKey: "nav.payouts"          },
    { key: "streaming",          href: "/admin/streaming",          icon: Play,        labelKey: "nav.streaming"        },
    { key: "aftalelicens",       href: "/admin/aftalelicens",       icon: Layers,      labelKey: "nav.aftalelicens"     },
    { key: "statistik",          href: "/admin/statistik",          icon: BarChart3,   labelKey: "nav.statistics"       },
    { key: "stamdata",           href: "/admin/stamdata",           icon: Database,    labelKey: "nav.masterData"       },
    { key: "gennemsigtighed",    href: "/admin/gennemsigtighed",    icon: ScrollText,  labelKey: "nav.transparency"     },
    { key: "krediteringer",      href: "/admin/krediteringer",      icon: Award,       labelKey: "nav.credits"          },
    { key: "indbetalinger",      href: "/admin/indbetalinger",      icon: Receipt,     labelKey: "nav.producerPayments" },
    { key: "brugere",            href: "/admin/brugere",            icon: Users2,      labelKey: "nav.users"            },
]

const USER_NAV_ITEMS = [
    { key: "mine-vaerker",        href: "/portal/mine-vaerker",        icon: Film,     labelKey: "nav.myWorks"        },
    { key: "mine-kontrakter",     href: "/portal/mine-kontrakter",     icon: FileText, labelKey: "nav.myContracts"    },
    { key: "okonomi",             href: "/portal/okonomi",             icon: Wallet,   labelKey: "nav.economy"        },
    { key: "portal-aftalelicens", href: "/portal/aftalelicens",        icon: Layers,   labelKey: "nav.aftalelicens"   },
    { key: "portal-gennemgang",   href: "/portal/kontraktgennemgang", icon: Scale,    labelKey: "nav.contractReview" },
]

const ALL_KEYS = ALL_NAV_ITEMS.map(i => i.key)

const ROLE_MODULES: Record<string, string[]> = {
    superadmin:  ALL_KEYS,
    admin:       ALL_KEYS,
    "org-admin": ALL_KEYS.filter(k => k !== "stamdata" && k !== "brugere"),
    jurist:      ["kontrakter", "kontraktgennemgang"],
    viewer:      ["kontrakter", "statistik"],
}

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { t } = useI18n()
    const pathname = usePathname()
    const router = useRouter()
    const [userRole, setUserRole] = useState<string>("admin")
    const [isSuperadmin, setIsSuperadmin] = useState<boolean>(false)
    const [pendingCount, setPendingCount] = useState<number>(0)
    const [pendingWorksCount, setPendingWorksCount] = useState<number>(0)

    useEffect(() => {
        const supabase = createClient()

        const fetchCount = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const orgId = user?.user_metadata?.org_id ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"
            const [contractsRes, worksRes] = await Promise.all([
                supabase
                    .from("contracts")
                    .select("id", { count: "exact", head: true })
                    .eq("org_id", orgId)
                    .eq("status", "kladde"),
                supabase
                    .from("work_change_requests")
                    .select("id", { count: "exact", head: true })
                    .eq("org_id", orgId)
                    .eq("status", "pending"),
            ])
            setPendingCount(contractsRes.count ?? 0)
            setPendingWorksCount(worksRes.count ?? 0)
        }

        supabase.auth.getUser().then(async ({ data: { user } }) => {
            if (!user) return
            // Slå rolle op i user_org_roles — ikke user_metadata (kan være forældet)
            const { data: roles } = await supabase
                .from("user_org_roles")
                .select("role")
                .eq("user_id", user.id)
            const roleList = (roles ?? []).map(r => r.role)
            const primary = ["superadmin", "admin", "org-admin", "jurist", "viewer"]
                .find(r => roleList.includes(r)) ?? "viewer"
            setUserRole(primary)
            setIsSuperadmin(roleList.includes("superadmin"))
            fetchCount()
        })

        // Opdater tæller når kontrakter gemmes eller valideres
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
    const navItems = ALL_NAV_ITEMS
        .filter(item => allowedKeys.includes(item.key))
        .map(item => ({
            ...item,
            label: t(item.labelKey as Parameters<typeof t>[0]),
        }))
    const userNavItems = USER_NAV_ITEMS.map(item => ({
        ...item,
        label: t(item.labelKey as Parameters<typeof t>[0]),
    }))

    return (
        <SidebarProvider>
            <Sidebar variant="inset">
                <SidebarHeader className="p-4">
                    <Link href="/admin" className="block">
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
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                {t("nav.userSection" as Parameters<typeof t>[0])}
                            </div>
                            <SidebarMenu>
                                {userNavItems.map((item) => (
                                    <SidebarMenuItem key={item.href}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={
                                                pathname === item.href ||
                                                pathname.startsWith(`${item.href}/`) ||
                                                (item.key === "kontrakter" && pathname.startsWith("/admin/validering"))
                                            }
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
                                {navItems.map((item) => (
                                    <SidebarMenuItem key={item.href}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={pathname === item.href}
                                        >
                                            <Link href={item.href}>
                                                <item.icon className="h-4 w-4" />
                                                <span>{item.label}</span>
                                                {item.key === "kontrakter" && pendingCount > 0 && (
                                                    <span className="ml-auto inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1">
                                                        {pendingCount}
                                                    </span>
                                                )}
                                                {item.key === "vaerker" && pendingWorksCount > 0 && (
                                                    <span className="ml-auto inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1">
                                                        {pendingWorksCount}
                                                    </span>
                                                )}
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>

                <SidebarFooter>
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

            <SidebarInset>
                <header className="flex h-12 items-center gap-2 border-b px-4">
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="h-4" />
                    <span className="text-sm font-medium text-muted-foreground">
                        {t("nav.admin")}
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                        <LanguageToggle />
                        <ThemeToggle />
                    </div>
                </header>
                <main className="flex-1 p-6">{children}</main>
            </SidebarInset>
        </SidebarProvider>
    )
}
