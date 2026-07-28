import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { assertAdminRole } from "@/lib/supabase/assert-admin"

export default async function AiKontrolrumLayout({ children }: { children: React.ReactNode }) {
    const session = await createClient()
    const caller = await assertAdminRole(session, ["superadmin", "admin", "org-admin"])
    if (!caller) redirect("/admin")
    return children
}

