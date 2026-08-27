export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getMemberAllocations, getMemberEntitlementCases } from "@/app/actions/member-rights"
import { OkonomiClient } from "./OkonomiClient"

export default async function PortalOkonomiPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/")

    const [result, casesResult] = await Promise.all([getMemberAllocations(), getMemberEntitlementCases()])
    const allocations = result.success ? result.allocations : []
    const entitlementCases = casesResult.success ? casesResult.cases : []

    return <OkonomiClient allocations={allocations} entitlementCases={entitlementCases} />
}
