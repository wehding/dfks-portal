import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { ADMIN_ROLES, USER_ADMIN_ROLES } from "@/lib/admin-roles"
import { parseContractReviewDeleteIds } from "@/lib/contract-review-delete"
import { drainContractReviewStorageDeletionQueue } from "@/lib/contract-review-retention"
import { normalizeContractReviewAnalysisStatus, type ContractReviewJobSnapshot } from "@/lib/contract-review-job-status"
import { postgrestIlikePattern } from "@/lib/postgrest-search"
import { auditRequestContext, auditSearchFingerprint } from "@/lib/audit-access-server"
import { recordAuditEvent } from "@/lib/audit-log-server"

// GET /api/admin/contracts
// Query params: queue=mine|all, status=afventer,behandling, productionType=..., search=..., page=1, limit=20
export async function GET(req: NextRequest) {
    const sessionClient = await createClient()
    const caller = await assertAdminRole(sessionClient, ADMIN_ROLES)
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

    // Service role omgår RLS — admin-rute, ingen bruger-data-lækage
    const supabase = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const url = new URL(req.url)
    const queue = url.searchParams.get("queue") ?? "all"
    const statusParam = url.searchParams.get("status")
    const productionTypeParam = url.searchParams.get("productionType")
    const search = url.searchParams.get("search")?.trim()
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1") || 1)
    const limit = Math.max(1, Math.min(Number.parseInt(url.searchParams.get("limit") ?? "20") || 20, 100))
    const offset = (page - 1) * limit

    let query = supabase
        .from("contract_reviews")
        .select("*", { count: "exact" })
        .eq("org_id", caller.orgId)
        .is("soft_deleted_at", null)
        .order("reviewed_at", { ascending: false })
        .range(offset, offset + limit - 1)

    if (queue === "mine") {
        query = query
            .eq("assigned_to", caller.userId)
            .in("status", ["afventer", "behandling"])
    }

    if (statusParam) {
        const statuses = statusParam.split(",").map(s => s.trim()).filter(Boolean)
        if (statuses.length > 0) query = query.in("status", statuses)
    }

    if (productionTypeParam) {
        const types = productionTypeParam.split(",").map(s => s.trim()).filter(Boolean)
        if (types.length > 0) query = query.in("production_type", types)
    }

    if (search) {
        const pattern = postgrestIlikePattern(search)
        if (pattern) query = query.or(`member_name.ilike.${pattern},file_name.ilike.${pattern},producer_name.ilike.${pattern}`)
    }

    const { data, error, count } = await query

    if (error) {
        console.error("[admin-contract-reviews] list failed", error.code)
        return NextResponse.json({ error: "Kontraktgennemgangen kunne ikke hentes." }, { status: 500 })
    }

    const reviews = data ?? []
    const reviewIds = reviews.map(review => review.id)
    const assigneeIds = [...new Set(reviews.map(review => review.assigned_to).filter((id): id is string => Boolean(id)))]
    const [{ data: jobs }, authUsers] = await Promise.all([
        reviewIds.length
            ? supabase.from("contract_review_jobs")
                .select("review_id,status,attempts,next_attempt_at,error_message,created_at")
                .in("review_id", reviewIds)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [] }),
        assigneeIds.length ? supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }) : Promise.resolve({ data: { users: [] } }),
    ])
    const latestJobByReview = new Map<string, ContractReviewJobSnapshot>()
    for (const job of jobs ?? []) {
        if (!latestJobByReview.has(job.review_id)) {
            latestJobByReview.set(job.review_id, {
                status: job.status,
                attempts: job.attempts,
                next_attempt_at: job.next_attempt_at,
                error_message: job.error_message,
            } as ContractReviewJobSnapshot)
        }
    }
    const assigneeLabels = new Map((authUsers.data?.users ?? [])
        .filter(user => assigneeIds.includes(user.id))
        .map(user => [user.id, typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
            ? user.user_metadata.full_name.trim()
            : user.email ?? user.id]))

    const normalized = reviews.map(review => {
        const analysisJob = latestJobByReview.get(review.id) ?? null
        return {
            ...review,
            assigned_to_name: review.assigned_to ? assigneeLabels.get(review.assigned_to) ?? "Tildelt medarbejder" : null,
            analysis_job: analysisJob ? {
                status: analysisJob.status,
                attempts: analysisJob.attempts,
                next_attempt_at: analysisJob.next_attempt_at,
                error: analysisJob.error_message ? "Kontraktanalysen kunne ikke gennemføres." : null,
            } : null,
            analysis_status: normalizeContractReviewAnalysisStatus({
                aiStatus: review.ai_status,
                intakeStatus: review.intake_status,
                job: analysisJob,
            }),
        }
    })

    await recordAuditEvent({
        context: auditRequestContext(req, caller, "admin", "admin.contract-reviews.list"),
        action: search || statusParam || productionTypeParam ? "search" : "read",
        entityType: "contract_reviews",
        entityLabel: "Kontraktgennemgange",
        purposeCode: "contract_case_management",
        legalBasis: "GDPR Art. 6(1)(b) og 6(1)(f)",
        dataCategories: ["contract_data", "contact_data", "ai_analysis"],
        orgIds: [caller.orgId],
        metadata: {
            resultCount: normalized.length,
            filters: { queue, hasStatus: Boolean(statusParam), hasProductionType: Boolean(productionTypeParam), hasSearch: Boolean(search) },
            queryFingerprint: search ? auditSearchFingerprint(search) : null,
        },
    })

    return NextResponse.json({ data: normalized, count: count ?? 0, page, limit }, { headers: { "cache-control": "no-store" } })
}

// DELETE /api/admin/contracts
// Sletter kun kontraktgennemgange og deres reviewfiler. En eventuelt koblet
// kontrakt i contracts-tabellen bevares altid.
export async function DELETE(req: NextRequest) {
    const sessionClient = await createClient()
    const caller = await assertAdminRole(sessionClient, USER_ADMIN_ROLES)
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

    const body = await req.json().catch(() => null) as { ids?: unknown } | null
    const parsed = parseContractReviewDeleteIds(body?.ids)
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: rows, error: rowsError } = await admin
        .from("contract_reviews")
        .select("id, storage_path")
        .eq("org_id", caller.orgId)
        .in("id", parsed.ids)
    if (rowsError) return NextResponse.json({ error: "Kontraktgennemgangene kunne ikke kontrolleres." }, { status: 500 })

    const rowById = new Map((rows ?? []).map(row => [row.id, row]))
    const results = await Promise.all(parsed.ids.map(async id => {
        const row = rowById.get(id)
        if (!row) return { id, error: "Kontraktgennemgangen blev ikke fundet i organisationen" }

        const { data: deleted, error: deleteError } = await admin.rpc("delete_contract_review_immediately", {
            target_review_id: id,
            target_org_id: caller.orgId,
            actor_id: caller.userId,
            deletion_origin: "admin_manual",
        })
        if (deleteError) return { id, error: "Kontraktgennemgangen kunne ikke slettes." }
        if (!deleted) return { id, error: "Kontraktgennemgangen kunne ikke slettes. Kontrollér eventuelt juridisk hold." }
        return { id, error: null }
    }))

    const storage = await drainContractReviewStorageDeletionQueue(200).catch(() => ({ deleted: 0, failed: 1 }))

    return NextResponse.json({
        deletedIds: results.filter(result => !result.error).map(result => result.id),
        failed: results.filter(result => result.error),
        storage,
    })
}
