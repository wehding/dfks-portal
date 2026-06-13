"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { Film, FileText, Wallet, LogOut, Info, UserCircle, Layers, ScanSearch } from "lucide-react"
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

export default function PortalLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { t } = useI18n()
    const pathname = usePathname()

    const navItems = [
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
                    <div className="mx-2 mb-2 rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-transparent px-3 py-2.5 space-y-1">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                            <Info className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            AI-assisteret system
                        </div>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                            DFKS bruger AI til at screene kontrakter og behandle rettighedsbetalinger. Personfølsomme data anonymiseres inden behandling, og AI-tjenesten træner ikke på dine data.
                        </p>
                    </div>
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
                        {t("nav.portal")}
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
