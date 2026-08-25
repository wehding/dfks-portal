export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getMemberAllocations } from "@/app/actions/member-rights"
import { OkonomiClient } from "./OkonomiClient"

export default async function PortalOkonomiPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/")

    const result = await getMemberAllocations()
    const allocations = result.success ? result.allocations : []

    return <OkonomiClient allocations={allocations} />
}
