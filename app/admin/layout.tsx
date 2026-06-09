"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import {
    FileText,
    Building2,
    CheckCircle,
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
    Library,
    Layers,
    UserCheck,
    FlaskConical,
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
    { key: "producenter",          href: "/admin/producenter",          icon: Building2,   labelKey: "nav.producers"          },
    { key: "rettighedshavere",    href: "/admin/rettighedshavere",    icon: UserCheck,   labelKey: "nav.rightsHolders"      },
    { key: "validering",          href: "/admin/validering",          icon: CheckCircle, labelKey: "nav.validation"         },
    { key: "overenskomster",     href: "/admin/overenskomster",     icon: BookOpen,    labelKey: "nav.agreements"       },
    { key: "kontraktgennemgang", href: "/admin/kontraktgennemgang", icon: Scale,       labelKey: "nav.contractReview"   },
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

const ALL_KEYS = ALL_NAV_ITEMS.map(i => i.key)

const ROLE_MODULES: Record<string, string[]> = {
    superadmin:  ALL_KEYS,
    admin:       ALL_KEYS,
    "org-admin": ALL_KEYS.filter(k => k !== "stamdata" && k !== "brugere"),
    jurist:      ["validering", "kontraktgennemgang"],
    viewer:      ["kontrakter", "validering", "statistik"],
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

        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserRole(user?.user_metadata?.role ?? "admin")
            fetchCount()
        })

        // Opdater tæller når kontrakter gemmes eller valideres
        window.addEventListener("contracts-updated", fetchCount)
        return () => window.removeEventListener("contracts-updated", fetchCount)
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
