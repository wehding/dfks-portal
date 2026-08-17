import { NextRequest, NextResponse } from "next/server"
import { requireStaffModuleApi } from "@/lib/api-auth"
import { assertContractReviewInOrg } from "@/lib/authz"
import { createServiceClient } from "@/lib/supabase/service"
import { recordAuditEvent } from "@/lib/audit-log-server"

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

    const auth = await requireStaffModuleApi("contract_reviews", "read")
    if (!auth.ok) return auth.response

    const auditContext = {
        actorUserId: auth.userId,
        actorOrgId: auth.orgId,
        actorRole: auth.role,
        source: "admin" as const,
        correlationId: crypto.randomUUID(),
    }
    const admin = createServiceClient({ audit: auditContext })

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

    await recordAuditEvent({
        context: auditContext,
        action: "download",
        entityType: "contract_reviews",
        entityId: id,
        entityLabel: "Kontraktdokument",
        orgIds: [auth.orgId],
    })

    return NextResponse.json({ url: data.signedUrl })
}
