import { NextRequest, NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { requireAdminApi } from "@/lib/api-auth"
import { assertContractReviewInOrg } from "@/lib/authz"

/**
 * GET /api/admin/contracts/[id]/pdf
 *
 * Genererer en signed URL til kontrakten i "contract-reviews" storage.
 * Bruger service role for at omgå RLS på storage-bucketen.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params

    const auth = await requireAdminApi()
    if (!auth.ok) return auth.response

    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    let review: { storage_path: string | null }
    try {
        review = await assertContractReviewInOrg(admin, id, auth.orgId)
    } catch {
        return NextResponse.json({ error: "Ikke fundet" }, { status: 404 })
    }
    if (!review.storage_path) return NextResponse.json({ error: "Ingen fil gemt" }, { status: 404 })

    const { data, error: signErr } = await admin.storage
        .from("contract-reviews")
        .createSignedUrl(review.storage_path, 3600)

    if (signErr || !data?.signedUrl) {
        return NextResponse.json({ error: "Kunne ikke generere download-link" }, { status: 500 })
    }

    return NextResponse.json({ url: data.signedUrl })
}
