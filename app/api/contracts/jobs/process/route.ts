export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { extractWordText } from "@/lib/word-text"
import { createServiceClient } from "@/lib/supabase/service"
import { createClient as createSessionClient } from "@/lib/supabase/server"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { extractPdfText } from "@/lib/pdf-parse"
import { maskPersonalData } from "@/lib/mask-text"
import { runContractExtraction } from "@/lib/contract-extract-core"
import { attachmentChanges } from "@/lib/attachment-ai"
import { requireInternalSecretApi } from "@/lib/api-auth"
import { matchRightsHolder, matchSharedWork } from "@/lib/server/contract-import-matching"
import { CONTRACT_MATCH_VERSION } from "@/lib/contract-import"
import { resolveSeriesScopeTarget, upsertMemberSeriesEpisodeScope } from "@/lib/server/member-series-episode-scopes"

type ContractJob = {
    id: string
    contract_id: string
    org_id: string
    attempts: number
    pdf_url: string | null
    attachment_id: string | null
}

async function runAttachmentJob(admin: ReturnType<typeof createServiceClient>, job: ContractJob) {
    if (!job.attachment_id || !job.pdf_url) throw new Error("Allongen mangler fil eller reference")
    const file = await fileFromStoragePath(job.pdf_url)
    const maskedText = maskPersonalData(file.text)
    const extractResult = await runContractExtraction(maskedText, { orgId: job.org_id, entityId: job.contract_id, source: "cron", pdfBuffer: file.ext === "pdf" ? file.buffer : null })
    if (!extractResult.ok) throw new Error(extractResult.error ?? "AI-aflæsning af allonge fejlede")
    const { data: validation } = await admin.from("contract_validations").select("extracted_data").eq("contract_id", job.contract_id).maybeSingle()
    const { extracted, changes } = attachmentChanges((validation?.extracted_data ?? {}) as Record<string, unknown>, (extractResult.data ?? {}) as Record<string, unknown>)
    const { error } = await admin.from("contract_attachments").update({ ai_status: "klar", ai_result: { extracted, changes, analyzedAt: new Date().toISOString(), includedInPayments: false } }).eq("id", job.attachment_id)
    if (error) throw new Error(error.message)
    await admin.from("contract_ai_jobs").update({ status: "done", masked_text: maskedText, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id)
    return { jobId: job.id, contractId: job.contract_id, attachmentId: job.attachment_id }
}

type DirectContractJob = ContractJob & { id: "__direct__" }

function yearFromValue(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value
    const match = String(value ?? "").match(/\b(19|20)\d{2}\b/)
    return match ? Number(match[0]) : null
}

async function fileFromStoragePath(path: string) {
    const admin = createServiceClient()
    const { data, error } = await admin.storage.from("kontrakter").download(path)
    if (error || !data) throw new Error(`Kunne ikke hente kontraktfil: ${error?.message ?? "ukendt fejl"}`)

    const buffer = Buffer.from(await data.arrayBuffer())
    const ext = path.split(".").pop()?.toLowerCase()
    let text: string
    if (ext === "pdf") text = await extractPdfText(buffer)
    if (ext === "docx" || ext === "doc") {
        text = await extractWordText(buffer, path)
    } else if (ext !== "pdf") text = buffer.toString("utf-8")
    return { buffer, ext, text: text! }
}

// Behandler ét enkelt job: henter fil, kører AI-udtræk, opdaterer validering +
// kontrakt, og markerer jobbet done. Kaster ved fejl (kalderen markerer 'error').
async function runContractJob(admin: ReturnType<typeof createServiceClient>, job: ContractJob) {
    if (job.attachment_id) return runAttachmentJob(admin, job)
    const storagePath = job.pdf_url
    if (!storagePath) throw new Error("Kontrakten mangler filsti")

    if (job.id !== "__direct__") {
        await admin.from("contract_import_items").update({ status: "analysing", updated_at: new Date().toISOString() }).eq("ai_job_id", job.id)
    }
    const file = await fileFromStoragePath(storagePath)
    const maskedText = maskPersonalData(file.text)

    // Kald udtræks-kernen direkte (ingen HTTP-runde), så batch-læsningen ikke
    // afhænger af den nu-autentificerede /api/contracts/extract-rute.
    const extractResult = await runContractExtraction(maskedText, { orgId: job.org_id, entityId: job.contract_id, source: "cron", pdfBuffer: file.ext === "pdf" ? file.buffer : null })
    if (!extractResult.ok) throw new Error(extractResult.error ?? "AI-aflæsning fejlede")
    const ext = extractResult.data ?? {}
    const extractedTitle = String(ext.workTitle ?? ext.title ?? "").trim() || null
    const extractedYear = yearFromValue(ext.premiereYear ?? ext.productionYear ?? ext.year ?? ext.premiereDate ?? ext.contractDate)

    const { data: existingContract } = await admin
        .from("contracts")
        .select("rights_holder_id, work_id, working_title, employer_id")
        .eq("id", job.contract_id)
        .maybeSingle()

    // Udled kun arbejdsgiver når kontrakten ikke allerede har en — så et
    // fuzzy navnematch ikke overskriver en manuelt sat arbejdsgiver.
    let employerId: string | null = existingContract?.employer_id ?? null
    if (!employerId && (ext.employerName || ext.producerName)) {
        const employerName = String(ext.employerName ?? ext.producerName)
        const { data: employer } = await admin
            .from("employers")
            .select("id")
            .ilike("name", employerName)
            .maybeSingle()
        employerId = employer?.id ?? null
    }

    if (job.id !== "__direct__") {
        await admin.from("contract_import_items").update({ status: "matching", updated_at: new Date().toISOString() }).eq("ai_job_id", job.id)
    }
    const extractedType = String(ext.productionType ?? ext.workType ?? "").toLocaleLowerCase("da-DK")
    const workType = extractedType.includes("serie") ? "tv-serie"
        : extractedType.includes("dokumentar") ? "dokumentarfilm"
        : extractedType.includes("kort") ? "kortfilm"
        : extractedType.includes("spille") ? "spillefilm"
        : null

    let workId: string | null = existingContract?.work_id ?? null
    let workMatch = workId
        ? { id: workId, score: 100, evidence: [{ signal: "existing_manual_link", points: 100 }], version: CONTRACT_MATCH_VERSION, candidates: [] }
        : await matchSharedWork(admin, {
            title: extractedTitle,
            premiereYear: extractedYear,
            contractDate: typeof ext.contractDate === "string" ? ext.contractDate : null,
            type: workType,
        })
    workId = workId ?? workMatch.id

    let rightsHolderId: string | null = existingContract?.rights_holder_id ?? null
    const ownerMatch = rightsHolderId
        ? { id: rightsHolderId, score: 100, evidence: [{ signal: "existing_manual_link", points: 100 }], version: CONTRACT_MATCH_VERSION, candidates: [] }
        : await matchRightsHolder(admin, {
            orgId: job.org_id,
            name: ext.rightsHolderName ? String(ext.rightsHolderName) : null,
            workId,
        })
    rightsHolderId = rightsHolderId ?? ownerMatch.id

    if (!workId && rightsHolderId) {
        workMatch = await matchSharedWork(admin, {
            title: extractedTitle,
            premiereYear: extractedYear,
            contractDate: typeof ext.contractDate === "string" ? ext.contractDate : null,
            type: workType,
            rightsHolderId,
        })
        workId = workMatch.id
    }

    const { data: existingValidation } = await admin
        .from("contract_validations")
        .select("extracted_data")
        .eq("contract_id", job.contract_id)
        .maybeSingle()

    const mergedExt = { ...ext }
    if (existingValidation?.extracted_data) {
        const prevData = existingValidation.extracted_data as Record<string, unknown>
        const lockedFields = prevData._lockedFields as string[] | undefined
        if (lockedFields && Array.isArray(lockedFields)) {
            for (const key of lockedFields) {
                if (key.startsWith("rightsOverview.")) {
                    const subKey = key.split(".")[1]
                    const prevOverview = (prevData.rightsOverview as Record<string, unknown> | undefined) ?? {}
                    const mergedOverview = (mergedExt.rightsOverview as Record<string, unknown> | undefined) ?? {}
                    mergedExt.rightsOverview = {
                        ...mergedOverview,
                        [subKey]: prevOverview[subKey]
                    }
                } else {
                    mergedExt[key] = prevData[key]
                }
            }
            mergedExt._lockedFields = lockedFields
        }
    }

    await admin.from("contract_validations").upsert({
        contract_id: job.contract_id,
        org_id: job.org_id,
        holiday_pay_rate: mergedExt.holidayPayRate ?? null,
        beta_rate: mergedExt.betaRate ?? null,
        has_credit_clause: !!mergedExt.hasCreditClause || Boolean(mergedExt.creditedRoles || mergedExt.creditedFunction),
        has_termination_clause: !!mergedExt.hasTerminationClause,
        termination_days_editor: mergedExt.terminationDaysEditor ?? null,
        termination_days_producer: mergedExt.terminationDaysProducer ?? null,
        has_indemnification: !!mergedExt.hasIndemnification,
        has_overenskomst_incorporation: !!mergedExt.hasOverenskomstIncorporation || !!mergedExt.collectiveAgreement,
        extracted_data: mergedExt,
    }, { onConflict: "contract_id" })

    await admin.from("contracts").update({
        status: "kladde",
        type: ext.contractType ?? "a-løn",
        overenskomst: ext.overenskomst === "ingen" ? null : (ext.overenskomst ?? null),
        working_title: extractedTitle ?? existingContract?.working_title ?? null,
        contract_date: ext.contractDate ?? null,
        start_date: ext.startDate ?? null,
        end_date: ext.endDate ?? null,
        ...(employerId ? { employer_id: employerId } : {}),
        ...(rightsHolderId ? { rights_holder_id: rightsHolderId } : {}),
        ...(workId ? { work_id: workId } : {}),
    }).eq("id", job.contract_id)

    if (rightsHolderId && workId) {
        const extractedSeason = Math.max(1, Math.floor(Number(ext.seasonNumber ?? ext.season ?? 1) || 1))
        const target = await resolveSeriesScopeTarget(admin, workId, extractedSeason)
        if (target) {
            const scopeResult = await upsertMemberSeriesEpisodeScope(admin, {
                orgId: job.org_id,
                rightsHolderId,
                seriesWorkId: target.seriesWorkId,
                seasonNumber: target.seasonNumber,
                status: "pending",
                source: "contract_upload",
            })
            if (!scopeResult.success) throw new Error(scopeResult.error)
            await admin.from("contracts").update({
                episode_scope_id: scopeResult.scope.id,
                season_number: scopeResult.scope.season_number,
                episode_numbers: scopeResult.scope.status === "confirmed"
                    ? scopeResult.scope.covers_whole_season ? [] : scopeResult.scope.episode_numbers
                    : null,
            }).eq("id", job.contract_id)
        }
    }

    if (job.id !== "__direct__") {
        let itemStatus = !rightsHolderId ? "missing_owner" : !workId ? "missing_work" : "ready_for_review"
        if (rightsHolderId && workId) {
            const { data: linkedWork } = await admin.from("works").select("type").eq("id", workId).maybeSingle()
            if (String(linkedWork?.type ?? "").includes("serie")) itemStatus = "awaiting_episode_confirmation"
        }
        await admin.from("contract_import_items").update({
            status: itemStatus,
            owner_match_score: ownerMatch.score,
            work_match_score: workMatch.score,
            owner_match_evidence: ownerMatch.evidence,
            work_match_evidence: workMatch.evidence,
            match_version: CONTRACT_MATCH_VERSION,
            updated_at: new Date().toISOString(),
        }).eq("ai_job_id", job.id)
    }

    if (job.id !== "__direct__") {
        await admin.from("contract_ai_jobs").update({
            status: "done",
            masked_text: maskedText,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }).eq("id", job.id)
    }

    return { jobId: job.id, contractId: job.contract_id }
}

async function markJobError(admin: ReturnType<typeof createServiceClient>, jobId: string, message: string, attachmentId?: string | null) {
    if (jobId === "__direct__") return
    const { data: job } = await admin.from("contract_ai_jobs").select("attempts").eq("id", jobId).maybeSingle()
    await admin.from("contract_ai_jobs").update({
        status: "error",
        error_message: message,
        updated_at: new Date().toISOString(),
    }).eq("id", jobId)
    await admin.from("contract_import_items").update({
        status: Number(job?.attempts ?? 0) >= 3 ? "dead" : "retryable_error",
        error_code: "analysis_failed",
        error_message: "Kontrakten kunne ikke analyseres",
        attempts: Number(job?.attempts ?? 0),
        next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
    }).eq("ai_job_id", jobId)
    if (attachmentId) await admin.from("contract_attachments").update({ ai_status: "fejl", ai_result: { error: message } }).eq("id", attachmentId)
}

const MAX_JOBS_PER_RUN = 10
const RUN_TIME_BUDGET_MS = 50_000

export async function processPendingContractJobs(orgId?: string | null) {
    const admin = createServiceClient()
    const deadline = Date.now() + RUN_TIME_BUDGET_MS
    const processedContractIds: string[] = []
    const errors: { jobId: string; error: string }[] = []
    while (processedContractIds.length + errors.length < MAX_JOBS_PER_RUN && Date.now() < deadline) {
        const { data: jobs, error: jobErr } = await admin.rpc("claim_next_contract_ai_job", { p_job_id: null, p_org_id: orgId ?? null })
        if (jobErr) break
        const job = ((jobs?.[0] ?? null) as unknown as ContractJob | null)
        if (!job) break
        try {
            await runContractJob(admin, job)
            processedContractIds.push(job.contract_id)
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Ukendt fejl"
            await markJobError(admin, job.id, message, job.attachment_id)
            errors.push({ jobId: job.id, error: message })
        }
    }
    return { ok: true, processed: processedContractIds.length, processedContractIds, errors }
}

export async function POST(req: NextRequest) {
    const admin = createServiceClient()

    try {
        const hasValidSecret = requireInternalSecretApi(req, "contract-ai")
        let callerOrgId: string | null = null
        if (!hasValidSecret) {
            const sessionClient = await createSessionClient()
            const caller = await assertAdminRole(sessionClient, ["superadmin", "admin", "org-admin"])
            if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })
            callerOrgId = caller.orgId
        }

        const body = await req.json().catch(() => ({}))
        const jobId = typeof body.jobId === "string" ? body.jobId : null
        const contractId = typeof body.contractId === "string" ? body.contractId : null
        const requestedOrgId = typeof body.orgId === "string" ? body.orgId : null
        // Et browserkald må aldrig vælge en anden organisation end den aktive.
        // Kun den dedikerede worker-secret kan behandle et eksplicit scope.
        const orgId = hasValidSecret ? requestedOrgId : callerOrgId

        // Direkte kontrakt-udtræk (bypasser køen — fx manuel re-læsning)
        if (contractId) {
            let contractQuery = admin
                .from("contracts")
                .select("id, org_id, pdf_url")
                .eq("id", contractId)
            if (orgId) contractQuery = contractQuery.eq("org_id", orgId)
            const { data: contract, error: contractErr } = await contractQuery.maybeSingle()
            if (contractErr) throw new Error(contractErr.message)
            if (!contract) throw new Error("Kontrakt ikke fundet")
            const result = await runContractJob(admin, {
                id: "__direct__", contract_id: contract.id, org_id: contract.org_id, attempts: 0, pdf_url: contract.pdf_url, attachment_id: null,
            } satisfies DirectContractJob)
            return NextResponse.json({ ok: true, processed: true, ...result })
        }

        // Specifikt job via jobId (synkront kald fra upload — behandl netop dette job)
        if (jobId) {
            const { data: jobs, error: jobErr } = await admin.rpc("claim_next_contract_ai_job", { p_job_id: jobId, p_org_id: orgId })
            if (jobErr) throw new Error(jobErr.message)
            const job = ((jobs?.[0] ?? null) as unknown as ContractJob | null)
            if (!job) return NextResponse.json({ ok: true, processed: false })
            try {
                const result = await runContractJob(admin, job)
                return NextResponse.json({ ok: true, processed: true, ...result })
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "Ukendt fejl"
                await markJobError(admin, job.id, message, job.attachment_id)
                return NextResponse.json({ ok: false, error: message }, { status: 500 })
            }
        }

        // Kø-dræn
        const result = await processPendingContractJobs(orgId)
        return NextResponse.json(result)
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Ukendt fejl"
        return NextResponse.json({ ok: false, error: message }, { status: 500 })
    }
}

export async function GET(req: NextRequest) {
    return POST(req)
}
