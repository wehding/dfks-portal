"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Building2, LogOut } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import {
    Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
    SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
    SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"

const NAV = [
    { href: "/superadmin/organisationer", label: "Organisationer", icon: Building2 },
]

export default function SuperadminLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const router = useRouter()

    async function signOut() {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push("/")
    }

    return (
        <SidebarProvider>
            <Sidebar>
                <SidebarHeader className="p-4">
                    <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Superadmin</div>
                </SidebarHeader>
                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {NAV.map(item => (
                                    <SidebarMenuItem key={item.href}>
                                        <SidebarMenuButton asChild isActive={pathname?.startsWith(item.href) ?? false}>
                                            <Link href={item.href}>
                                                <item.icon className="h-4 w-4" />
                                                {item.label}
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>
                <SidebarFooter className="p-4 space-y-2">
                    <Separator />
                    <Link href="/admin" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                        ← Admin
                    </Link>
                    <button onClick={signOut} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                        <LogOut className="h-4 w-4" />
                        Log ud
                    </button>
                </SidebarFooter>
            </Sidebar>
            <SidebarInset>
                <header className="flex h-12 items-center gap-2 border-b px-4">
                    <SidebarTrigger />
                    <Separator orientation="vertical" className="h-4" />
                </header>
                <main>{children}</main>
            </SidebarInset>
        </SidebarProvider>
    )
}
