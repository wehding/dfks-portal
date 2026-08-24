import { NextRequest, NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { requireStaffModuleApi } from "@/lib/api-auth"
import { assertContractReviewInOrg } from "@/lib/authz"
import { normalizeContractReviewAnalysisStatus, type ContractReviewJobSnapshot } from "@/lib/contract-review-job-status"
import { auditRequestContext } from "@/lib/audit-access-server"
import { recordAuditEvent } from "@/lib/audit-log-server"
import { getContractReviewThread, syncContractReviewThread } from "@/lib/gmail-contract-thread"
import { normalizeReviewEmailAddress, normalizeReviewEmailAddresses } from "@/lib/contract-review-email"

// GET /api/admin/contracts/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const auth = await requireStaffModuleApi("contract_reviews", "read")
    if (!auth.ok) return auth.response

    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
    try {
        await assertContractReviewInOrg(admin, id, auth.orgId)
    } catch {
        return NextResponse.json({ error: "Ikke fundet" }, { status: 404 })
    }

    // Ved åbning forsøges en frisk trådsynkronisering. En kort cacheperiode
    // forhindrer, at almindelig sidepolling kalder Gmail gentagne gange.
    await syncContractReviewThread(id, auth.orgId, { minimumAgeMs: 60_000 }).catch(() => null)

    const { data, error } = await admin
        .from("contract_reviews")
        .select("*")
        .eq("id", id)
        .single()

    if (error || !data) return NextResponse.json({ error: "Ikke fundet" }, { status: 404 })

    const canAssign = new Set(["superadmin", "admin", "org-admin"]).has(auth.role)
    let assignees: Array<{ id: string; label: string }> = []
    if (canAssign) {
        const { data: roleRows } = await admin
            .from("user_org_roles")
            .select("user_id")
            .eq("org_id", auth.orgId)
            .in("role", ["superadmin", "admin", "org-admin", "jurist"])

        const userIds = [...new Set((roleRows ?? []).map(row => row.user_id))]
        if (userIds.length > 0) {
            const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 })
            const allowedIds = new Set(userIds)
            assignees = (authUsers?.users ?? [])
                .filter(user => allowedIds.has(user.id))
                .map(user => ({
                    id: user.id,
                    label: typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
                        ? user.user_metadata.full_name.trim()
                        : user.email ?? user.id,
                }))
                .sort((a, b) => a.label.localeCompare(b.label, "da"))
        }
    }

    let emailSource = null
    if (data.gmail_contract_message_id) {
        const { data: source } = await admin
            .from("gmail_contract_messages")
            .select("subject,from_address,to_addresses,cc_addresses,received_at,body_text")
            .eq("id", data.gmail_contract_message_id)
            .eq("org_id", auth.orgId)
            .maybeSingle()
        emailSource = source ?? null
    }
    const emailThread = await getContractReviewThread(id, auth.orgId).catch(() => [])
    const suggestedTo = data.response_draft_to ?? emailThread.find(message => message.direction === "incoming")?.from ?? data.member_email ?? null

    const { data: latestJob } = await admin.from("contract_review_jobs")
        .select("status,attempts,next_attempt_at,error_message")
        .eq("review_id", id)
        .eq("org_id", auth.orgId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    const job = latestJob as ContractReviewJobSnapshot | null
    const assignedToName = data.assigned_to
        ? assignees.find(assignee => assignee.id === data.assigned_to)?.label ?? "Tildelt medarbejder"
        : null
    const normalizedData = {
        ...data,
        assigned_to_name: assignedToName,
        analysis_job: job ? {
            status: job.status,
            attempts: job.attempts,
            next_attempt_at: job.next_attempt_at,
            error: job.error_message ? "Kontraktanalysen kunne ikke gennemføres." : null,
        } : null,
        analysis_status: normalizeContractReviewAnalysisStatus({ aiStatus: data.ai_status, intakeStatus: data.intake_status, job }),
    }

    await recordAuditEvent({
        context: auditRequestContext(req, { userId: auth.userId, orgId: auth.orgId, role: auth.role }, "admin", "admin.contract-reviews.detail"),
        action: "read",
        entityType: "contract_reviews",
        entityId: id,
        entityLabel: "Kontraktgennemgang",
        purposeCode: "contract_case_management",
        legalBasis: "GDPR Art. 6(1)(b) og 6(1)(f)",
        dataCategories: ["contract_data", "contact_data", "ai_analysis", "message_data"],
        orgIds: [auth.orgId],
    })

    return NextResponse.json({
        data: { ...normalizedData, response_draft_to: suggestedTo },
        assignees, canAssign, emailSource, emailThread,
    }, { headers: { "cache-control": "no-store" } })
}

// PATCH /api/admin/contracts/[id]
// Body: { status?: string, assignedTo?: string }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const auth = await requireStaffModuleApi("contract_reviews", "write")
    if (!auth.ok) return auth.response

    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
    try {
        await assertContractReviewInOrg(admin, id, auth.orgId)
    } catch {
        return NextResponse.json({ error: "Ikke fundet" }, { status: 404 })
    }

    const body = await req.json()
    const updates: Record<string, unknown> = {}

    const allowedStatuses = new Set(["afventer", "behandling", "afsluttet"])
    if (body.status) {
        if (!allowedStatuses.has(body.status)) return NextResponse.json({ error: "Ugyldig status" }, { status: 400 })
        updates.status = body.status
        updates.completed_at = body.status === "afsluttet" ? new Date().toISOString() : null
    }

    if (body.action === "claim") {
        const { data: claimed, error: claimError } = await admin
            .from("contract_reviews")
            .update({ assigned_to: auth.userId, status: "behandling" })
            .eq("id", id)
            .eq("org_id", auth.orgId)
            .eq("status", "afventer")
            .is("assigned_to", null)
            .select()
            .maybeSingle()
        if (claimError) return NextResponse.json({ error: "Opgaven kunne ikke tages" }, { status: 500 })
        if (!claimed) return NextResponse.json({ error: "Opgaven er allerede taget" }, { status: 409 })
        return NextResponse.json({ data: claimed })
    }

    if (body.action === "release") {
        let release = admin.from("contract_reviews").update({ assigned_to: null, status: "afventer" }).eq("id", id).eq("org_id", auth.orgId)
        if (auth.role === "jurist") release = release.eq("assigned_to", auth.userId)
        const { data: released, error: releaseError } = await release.select().maybeSingle()
        if (releaseError) return NextResponse.json({ error: "Opgaven kunne ikke frigives" }, { status: 500 })
        if (!released) return NextResponse.json({ error: "Opgaven kan ikke frigives af denne bruger" }, { status: 403 })
        return NextResponse.json({ data: released })
    }

    if (body.action === "assign") {
        if (!new Set(["superadmin", "admin", "org-admin"]).has(auth.role)) return NextResponse.json({ error: "Kun administratorer kan tildele opgaver" }, { status: 403 })
        const assignedTo = typeof body.assignedTo === "string" ? body.assignedTo : ""
        const { data: eligible } = await admin.from("user_org_roles").select("user_id").eq("org_id", auth.orgId).eq("user_id", assignedTo).in("role", ["superadmin", "admin", "org-admin", "jurist"]).limit(1).maybeSingle()
        if (!eligible) return NextResponse.json({ error: "Modtageren kan ikke behandle opgaver i organisationen" }, { status: 400 })
        updates.assigned_to = assignedTo
        updates.status = "behandling"
    } else if (body.assignedTo !== undefined) {
        return NextResponse.json({ error: "Brug en tildelingshandling" }, { status: 400 })
    }
    if (body.jurist_response !== undefined) {
        updates.jurist_response = body.jurist_response || null
        updates.jurist_response_at = body.jurist_response ? new Date().toISOString() : null
    }
    if (body.responseDraft !== undefined) {
        if (typeof body.responseDraft !== "string" || body.responseDraft.length > 50_000) {
            return NextResponse.json({ error: "Svarudkastet er ugyldigt eller for langt" }, { status: 400 })
        }
        updates.response_draft = body.responseDraft.trim() || null
        updates.response_draft_updated_at = new Date().toISOString()
    }
    if (body.responseDraftSubject !== undefined) {
        if (typeof body.responseDraftSubject !== "string" || body.responseDraftSubject.length > 500) {
            return NextResponse.json({ error: "Emnet er ugyldigt eller for langt" }, { status: 400 })
        }
        updates.response_draft_subject = body.responseDraftSubject.trim() || null
        updates.response_draft_updated_at = new Date().toISOString()
    }
    if (body.responseDraftTo !== undefined) {
        try { updates.response_draft_to = typeof body.responseDraftTo === "string" && body.responseDraftTo.trim() ? normalizeReviewEmailAddress(body.responseDraftTo) : null }
        catch { return NextResponse.json({ error: "Modtagerens e-mailadresse er ugyldig" }, { status: 400 }) }
    }
    if (body.responseDraftCc !== undefined) {
        try { updates.response_draft_cc = normalizeReviewEmailAddresses(body.responseDraftCc) }
        catch { return NextResponse.json({ error: "En eller flere Cc-adresser er ugyldige" }, { status: 400 }) }
    }

    const changesDraft = ["responseDraft", "responseDraftSubject", "responseDraftTo", "responseDraftCc"]
        .some(field => body[field] !== undefined)
    const expectedVersion = Number(body.responseDraftVersion)
    if (changesDraft) {
        if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
            return NextResponse.json({ error: "Mailudkastets version mangler" }, { status: 400 })
        }
        updates.response_draft_version = expectedVersion + 1
    }

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: "Ingen felter at opdatere" }, { status: 400 })
    }

    let updateQuery = admin.from("contract_reviews").update(updates).eq("id", id).eq("org_id", auth.orgId)
    if (changesDraft) updateQuery = updateQuery.eq("response_draft_version", expectedVersion)
    const { data, error } = await updateQuery.select().maybeSingle()

    if (error) {
        console.error("[admin-contract] update failed", error.code)
        return NextResponse.json({ error: "Kontrakten kunne ikke opdateres." }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: "Mailudkastet blev ændret samtidig. Genindlæs sagen." }, { status: 409 })

    return NextResponse.json({ data })
}
