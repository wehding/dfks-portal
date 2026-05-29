"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
    FileText,
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

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { t } = useI18n()
    const pathname = usePathname()

    const navItems = [
        {
            label: t("nav.contracts"),
            href: "/admin/kontrakter",
            icon: FileText,
        },
        {
            label: t("nav.validation"),
            href: "/admin/validering",
            icon: CheckCircle,
        },
        {
            label: t("nav.agreements"),
            href: "/admin/overenskomster",
            icon: BookOpen,
        },
        {
            label: t("nav.contractReview"),
            href: "/admin/kontraktgennemgang",
            icon: Scale,
        },
        {
            label: t("nav.payouts"),
            href: "/admin/udbetalinger",
            icon: Wallet,
        },
        {
            label: t("nav.works"),
            href: "/admin/vaerker",
            icon: Library,
        },
        {
            label: t("nav.streaming"),
            href: "/admin/streaming",
            icon: Play,
        },
        {
            label: t("nav.aftalelicens"),
            href: "/admin/aftalelicens",
            icon: Layers,
        },
        {
            label: t("nav.statistics"),
            href: "/admin/statistik",
            icon: BarChart3,
        },
        {
            label: t("nav.masterData"),
            href: "/admin/stamdata",
            icon: Database,
        },
        {
            label: t("nav.transparency"),
            href: "/admin/gennemsigtighed",
            icon: ScrollText,
        },
        {
            label: t("nav.credits"),
            href: "/admin/krediteringer",
            icon: Award,
        },
        // Helligdagsfond & Barselspulje removed from admin nav per Martin's request
        // Data is tracked via contract validation fields instead
        {
            label: t("nav.producerPayments"),
            href: "/admin/indbetalinger",
            icon: Receipt,
        },
        {
            label: t("nav.users"),
            href: "/admin/brugere",
            icon: Users2,
        },
    ]

    return (
        <SidebarProvider>
            <Sidebar variant="inset">
                <SidebarHeader className="p-4">
                    <Link href="/admin/kontrakter" className="block">
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
                            <SidebarMenuButton asChild>
                                <Link href="/">
                                    <LogOut className="h-4 w-4" />
                                    <span>{t("nav.logout")}</span>
                                </Link>
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
