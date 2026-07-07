export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import mammoth from "mammoth"
import { createServiceClient } from "@/lib/supabase/service"
import { createClient as createSessionClient } from "@/lib/supabase/server"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { extractPdfText } from "@/lib/pdf-parse"
import { maskPersonalData } from "@/lib/mask-text"

type ContractJob = {
    id: string
    contract_id: string
    org_id: string
    attempts: number
    pdf_url: string | null
}

type DirectContractJob = ContractJob & { id: "__direct__" }

type OwnWorkMatchRow = {
    works: { id: string; title: string; year: number | null } | { id: string; title: string; year: number | null }[] | null
}

type RightsHolderMatchRow = { id: string; full_name: string | null }

function normalizeMatchText(value: unknown) {
    return String(value ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9æøå]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function levenshtein(a: string, b: string) {
    const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i])
    for (let j = 1; j <= b.length; j++) matrix[0][j] = j
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            matrix[i][j] = a[i - 1] === b[j - 1]
                ? matrix[i - 1][j - 1]
                : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1
        }
    }
    return matrix[a.length][b.length]
}

function fuzzyTitleScore(a: string, b: string) {
    const left = normalizeMatchText(a)
    const right = normalizeMatchText(b)
    if (!left || !right) return 0
    if (left === right) return 1
    const distance = levenshtein(left, right)
    const similarity = 1 - distance / Math.max(left.length, right.length)
    const leftTokens = new Set(left.split(" "))
    const rightTokens = new Set(right.split(" "))
    const overlap = [...leftTokens].filter(token => rightTokens.has(token)).length / Math.max(1, Math.min(leftTokens.size, rightTokens.size))
    return Math.max(similarity, overlap)
}

function yearFromValue(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value
    const match = String(value ?? "").match(/\b(19|20)\d{2}\b/)
    return match ? Number(match[0]) : null
}

function firstRelation<T>(value: T | T[] | null) {
    return Array.isArray(value) ? value[0] ?? null : value
}

async function findSingleOwnWorkMatch(
    admin: ReturnType<typeof createServiceClient>,
    rightsHolderId: string | null,
    title: string | null,
    year: number | null,
) {
    if (!rightsHolderId || !title) return null
    const normalizedTitle = normalizeMatchText(title)
    if (!normalizedTitle) return null

    const { data } = await admin
        .from("work_assignments")
        .select("works(id, title, year)")
        .eq("rights_holder_id", rightsHolderId)

    const works = ((data ?? []) as OwnWorkMatchRow[])
        .map(row => firstRelation(row.works))
        .filter((work): work is { id: string; title: string; year: number | null } => Boolean(work))

    const uniqueWorks = [...new Map(works.map(work => [work.id, work])).values()]
    const scoredMatches = uniqueWorks
        .map(work => ({
            work,
            titleScore: fuzzyTitleScore(work.title, normalizedTitle),
            yearScore: year && work.year ? Math.max(0, 1 - Math.abs(work.year - year) / 2) : 0.75,
        }))
        .map(match => ({ ...match, score: match.titleScore * 0.75 + match.yearScore * 0.25 }))
        .filter(match => match.titleScore >= 0.82 && match.yearScore >= 0.5 && match.score >= 0.78)
        .sort((a, b) => b.score - a.score)

    if (scoredMatches.length === 1) return scoredMatches[0].work.id
    if (scoredMatches.length > 1 && scoredMatches[0].score - scoredMatches[1].score >= 0.12) return scoredMatches[0].work.id
    return null
}

async function findSingleRightsHolderMatch(
    admin: ReturnType<typeof createServiceClient>,
    orgId: string,
    name: string | null,
) {
    if (!name) return null
    const normalizedName = normalizeMatchText(name)
    if (!normalizedName) return null

    const { data } = await admin
        .from("rettighedshavere")
        .select("id, full_name, org_affiliations!inner(org_id)")
        .eq("org_affiliations.org_id", orgId)

    const matches = ((data ?? []) as RightsHolderMatchRow[])
        .filter(row => row.full_name)
        .map(row => ({
            id: row.id,
            score: fuzzyTitleScore(row.full_name ?? "", normalizedName),
        }))
        .filter(match => match.score >= 0.86)
        .sort((a, b) => b.score - a.score)

    if (matches.length === 1) return matches[0].id
    if (matches.length > 1 && matches[0].score - matches[1].score >= 0.1) return matches[0].id
    return null
}

async function textFromStoragePath(path: string): Promise<string> {
    const admin = createServiceClient()
    const { data, error } = await admin.storage.from("kontrakter").download(path)
    if (error || !data) throw new Error(`Kunne ikke hente kontraktfil: ${error?.message ?? "ukendt fejl"}`)

    const buffer = Buffer.from(await data.arrayBuffer())
    const ext = path.split(".").pop()?.toLowerCase()
    if (ext === "pdf") return extractPdfText(buffer)
    if (ext === "docx" || ext === "doc") {
        const result = await mammoth.extractRawText({ buffer })
        return result.value
    }
    return buffer.toString("utf-8")
}

// Behandler ét enkelt job: henter fil, kører AI-udtræk, opdaterer validering +
// kontrakt, og markerer jobbet done. Kaster ved fejl (kalderen markerer 'error').
async function runContractJob(admin: ReturnType<typeof createServiceClient>, job: ContractJob, req: NextRequest) {
    const storagePath = job.pdf_url
    if (!storagePath) throw new Error("Kontrakten mangler filsti")

    const rawText = await textFromStoragePath(storagePath)
    const maskedText = maskPersonalData(rawText)

    const fd = new FormData()
    fd.append("maskedText", maskedText)
    const extractRes = await fetch(new URL("/api/contracts/extract", req.url), {
        method: "POST",
        body: fd,
    })
    const extractJson = await extractRes.json()
    if (!extractRes.ok || !extractJson.ok) {
        throw new Error(extractJson.error ?? "AI-aflæsning fejlede")
    }
    const ext = extractJson.data ?? {}
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

    // Bevar eksisterende ejer. Kun når kontrakten endnu ikke har en ejer
    // (fx admin-batch-upload) forsøges udledning fra det AI-udtrukne navn —
    // ellers kan et forkert navnematch omdøbe ejeren på en medlems-kontrakt,
    // så den forsvinder fra medlemmets liste.
    let rightsHolderId: string | null = existingContract?.rights_holder_id ?? null
    if (!rightsHolderId && ext.rightsHolderName) {
        const { data: rh } = await admin
            .from("rettighedshavere")
            .select("id")
            .ilike("full_name", String(ext.rightsHolderName))
            .maybeSingle()
        rightsHolderId = rh?.id ?? null
    }
    if (!rightsHolderId) {
        rightsHolderId = await findSingleRightsHolderMatch(admin, job.org_id, ext.rightsHolderName ? String(ext.rightsHolderName) : null)
    }
    const matchRightsHolderId = rightsHolderId ?? existingContract?.rights_holder_id ?? null
    const autoMatchedWorkId = existingContract?.work_id
        ? null
        : await findSingleOwnWorkMatch(admin, matchRightsHolderId, extractedTitle, extractedYear)

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
        has_credit_clause: !!mergedExt.hasCreditClause || Boolean(mergedExt.creditedRoles),
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
        ...(autoMatchedWorkId ? { work_id: autoMatchedWorkId } : {}),
    }).eq("id", job.contract_id)

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

async function markJobError(admin: ReturnType<typeof createServiceClient>, jobId: string, message: string) {
    if (jobId === "__direct__") return
    await admin.from("contract_ai_jobs").update({
        status: "error",
        error_message: message,
        updated_at: new Date().toISOString(),
    }).eq("id", jobId)
}

// Hvor mange jobs én kø-dræn-kørsel behandler, og hvor længe den må køre.
// Holdes under Vercel-serverless-timeout så kørslen altid afsluttes rent.
const MAX_JOBS_PER_RUN = 10
const RUN_TIME_BUDGET_MS = 50_000

export async function POST(req: NextRequest) {
    const admin = createServiceClient()

    try {
        const configuredSecret = process.env.CONTRACT_AI_JOB_SECRET
        const cronSecret = process.env.CRON_SECRET
        const authHeader = req.headers.get("authorization") ?? ""
        const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null
        const hasValidSecret = Boolean(
            bearer && ((configuredSecret && bearer === configuredSecret) || (cronSecret && bearer === cronSecret))
        )
        if (!hasValidSecret) {
            const sessionClient = await createSessionClient()
            const caller = await assertAdminRole(sessionClient, ["superadmin", "admin", "org-admin"])
            if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })
        }

        const body = await req.json().catch(() => ({}))
        const jobId = typeof body.jobId === "string" ? body.jobId : null
        const contractId = typeof body.contractId === "string" ? body.contractId : null
        const orgId = typeof body.orgId === "string" ? body.orgId : null

        // Direkte kontrakt-udtræk (bypasser køen — fx manuel re-læsning)
        if (contractId) {
            const { data: contract, error: contractErr } = await admin
                .from("contracts")
                .select("id, org_id, pdf_url")
                .eq("id", contractId)
                .maybeSingle()
            if (contractErr) throw new Error(contractErr.message)
            if (!contract) throw new Error("Kontrakt ikke fundet")
            const result = await runContractJob(admin, {
                id: "__direct__", contract_id: contract.id, org_id: contract.org_id, attempts: 0, pdf_url: contract.pdf_url,
            } satisfies DirectContractJob, req)
            return NextResponse.json({ ok: true, processed: true, ...result })
        }

        // Specifikt job via jobId (synkront kald fra upload — behandl netop dette job)
        if (jobId) {
            const { data: jobs, error: jobErr } = await admin.rpc("claim_next_contract_ai_job", { p_job_id: jobId, p_org_id: orgId })
            if (jobErr) throw new Error(jobErr.message)
            const job = ((jobs?.[0] ?? null) as unknown as ContractJob | null)
            if (!job) return NextResponse.json({ ok: true, processed: false })
            try {
                const result = await runContractJob(admin, job, req)
                return NextResponse.json({ ok: true, processed: true, ...result })
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "Ukendt fejl"
                await markJobError(admin, job.id, message)
                return NextResponse.json({ ok: false, error: message }, { status: 500 })
            }
        }

        // Kø-dræn (cron / uden specifikt job): behandl flere jobs pr. kald indtil
        // køen er tom, loftet er nået, eller tidsbudgettet er brugt. Ét fejl-job
        // stopper ikke resten.
        const deadline = Date.now() + RUN_TIME_BUDGET_MS
        const processedContractIds: string[] = []
        const errors: { jobId: string; error: string }[] = []
        while (processedContractIds.length + errors.length < MAX_JOBS_PER_RUN && Date.now() < deadline) {
            const { data: jobs, error: jobErr } = await admin.rpc("claim_next_contract_ai_job", { p_job_id: null, p_org_id: orgId })
            if (jobErr) throw new Error(jobErr.message)
            const job = ((jobs?.[0] ?? null) as unknown as ContractJob | null)
            if (!job) break
            try {
                await runContractJob(admin, job, req)
                processedContractIds.push(job.contract_id)
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "Ukendt fejl"
                await markJobError(admin, job.id, message)
                errors.push({ jobId: job.id, error: message })
            }
        }
        return NextResponse.json({ ok: true, processed: processedContractIds.length, processedContractIds, errors })
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Ukendt fejl"
        return NextResponse.json({ ok: false, error: message }, { status: 500 })
    }
}

export async function GET(req: NextRequest) {
    return POST(req)
}
