import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { CONTRACT_AI_MODELS, getContractAiModel, isContractAiUseCase } from "@/lib/ai-models"
import { getKeyStatus } from "@/lib/ai-key-store"
import { recordAuditEvent } from "@/lib/audit-log-server"

export const dynamic = "force-dynamic"

const ALLOWED_ROLES = ["superadmin", "admin", "org-admin"] as const
const EVENT_SELECT = "id,run_id,org_id,use_case,stage,provider,model,input_tokens,output_tokens,thinking_tokens,cache_write_tokens,cache_read_tokens,usage_estimated,cost_usd,cost_dkk,latency_ms,status,error_code,created_at,ai_usage_runs(operation_type,entity_type,entity_id,status)"

async function loadUsageEvents(db: ReturnType<typeof createServiceClient>, from: string, orgId?: string) {
    const items: unknown[] = []
    for (let offset = 0; offset < 20_000; offset += 1_000) {
        let query = db.from("ai_usage_events").select(EVENT_SELECT).gte("created_at", from)
            .order("created_at", { ascending: false }).range(offset, offset + 999)
        if (orgId) query = query.eq("org_id", orgId)
        const { data, error } = await query
        if (error) return { data: null, error }
        items.push(...(data ?? []))
        if ((data?.length ?? 0) < 1_000) break
    }
    return { data: items, error: null }
}

export async function GET(req: NextRequest) {
    const session = await createClient()
    const caller = await assertAdminRole(session, ALLOWED_ROLES)
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

    const db = createServiceClient()
    const requestedFrom = req.nextUrl.searchParams.get("from")
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
    const from = requestedFrom && !Number.isNaN(Date.parse(requestedFrom)) ? new Date(requestedFrom).toISOString() : monthStart

    const [settingsResult, pricesResult, ratesResult, eventsResult, organisationsResult, statisticsScopeResult] = await Promise.all([
        db.from("ai_runtime_settings").select("use_case,provider,model,prompt_caching_enabled,updated_at,updated_by").order("use_case"),
        db.from("ai_model_prices").select("provider,model,pricing_mode,effective_from,input_usd_per_million,output_usd_per_million,cache_write_usd_per_million,cache_read_usd_per_million").is("effective_to", null).order("effective_from", { ascending: false }),
        db.from("ai_exchange_rates").select("rate_date,usd_dkk,source").order("rate_date", { ascending: false }).limit(1),
        loadUsageEvents(db, from, caller.role === "superadmin" ? undefined : caller.orgId),
        caller.role === "superadmin" ? db.from("organisations").select("id,name").order("name") : Promise.resolve({ data: [] }),
        db.from("organisations").select("statistics_contract_scope").eq("id", caller.orgId).single(),
    ])

    const firstError = settingsResult.error ?? pricesResult.error ?? ratesResult.error ?? eventsResult.error ?? statisticsScopeResult.error
    if (firstError) {
        console.error("[ai-control] Kunne ikke hente forbrug", firstError.message)
        return NextResponse.json({ error: "AI-forbruget kunne ikke hentes. Kontrollér at migrationen er kørt." }, { status: 500 })
    }

    return NextResponse.json({
        caller: { role: caller.role, orgId: caller.orgId, canEdit: caller.role === "superadmin" },
        models: CONTRACT_AI_MODELS,
        settings: settingsResult.data ?? [],
        prices: pricesResult.data ?? [],
        exchangeRate: ratesResult.data?.[0] ?? null,
        events: eventsResult.data ?? [],
        organisations: organisationsResult.data ?? [],
        statisticsContractScope: statisticsScopeResult.data?.statistics_contract_scope ?? "validated_only",
        from,
    })
}

export async function POST(req: NextRequest) {
    const session = await createClient()
    const caller = await assertAdminRole(session, ALLOWED_ROLES)
    if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

    const body = await req.json().catch(() => null) as null | {
        useCase?: unknown
        provider?: unknown
        model?: unknown
        promptCachingEnabled?: unknown
        statisticsContractScope?: unknown
    }
    if (body?.statisticsContractScope === "validated_only" || body?.statisticsContractScope === "validated_and_drafts") {
        const db = createServiceClient()
        const { error } = await db.from("organisations").update({
            statistics_contract_scope: body.statisticsContractScope,
            updated_at: new Date().toISOString(),
        }).eq("id", caller.orgId)
        if (error) return NextResponse.json({ error: "Statistikgrundlaget kunne ikke gemmes" }, { status: 500 })
        return NextResponse.json({ data: { statisticsContractScope: body.statisticsContractScope } })
    }
    if (caller.role !== "superadmin") {
        return NextResponse.json({ error: "Kun superadmin kan ændre AI-modeller" }, { status: 403 })
    }
    if (!body || !isContractAiUseCase(body.useCase) || typeof body.provider !== "string" || typeof body.model !== "string") {
        return NextResponse.json({ error: "Ugyldig modelindstilling" }, { status: 400 })
    }
    const selected = getContractAiModel(body.useCase, body.provider, body.model)
    if (!selected) return NextResponse.json({ error: "Modellen er ikke godkendt til denne funktion" }, { status: 400 })
    if (!getKeyStatus(selected.provider).configured) {
        return NextResponse.json({ error: `${selected.provider === "google" ? "Google AI" : "Anthropic"} API-nøgle mangler` }, { status: 409 })
    }

    const db = createServiceClient()
    const { data: before } = await db.from("ai_runtime_settings").select("provider,model,prompt_caching_enabled").eq("use_case", body.useCase).maybeSingle()
    const promptCachingEnabled = selected.provider === "anthropic" && body.promptCachingEnabled === true
    const { data, error } = await db.from("ai_runtime_settings").upsert({
        use_case: body.useCase,
        provider: selected.provider,
        model: selected.model,
        prompt_caching_enabled: promptCachingEnabled,
        updated_at: new Date().toISOString(),
        updated_by: caller.userId,
    }).select("use_case,provider,model,prompt_caching_enabled,updated_at").single()
    if (error) return NextResponse.json({ error: "Modelindstillingen kunne ikke gemmes" }, { status: 500 })

    try {
        await recordAuditEvent({
            context: { actorUserId: caller.userId, actorOrgId: caller.orgId, actorRole: caller.role, source: "admin" },
            action: "update",
            entityType: "ai_runtime_settings",
            entityId: body.useCase,
            entityLabel: body.useCase === "contract_extraction" ? "Kontraktaflæsning" : body.useCase === "contract_advice" ? "Kontraktrådgivning" : "Statistikforespørgsler",
            changes: [
                { field: "model", old: before ? `${before.provider}/${before.model}` : null, new: `${selected.provider}/${selected.model}` },
                { field: "prompt_caching_enabled", old: before?.prompt_caching_enabled ?? false, new: promptCachingEnabled },
            ],
        })
    } catch (auditError) {
        console.error("[ai-control] Modelændring blev gemt, men auditlog fejlede", auditError instanceof Error ? auditError.message : "ukendt fejl")
    }

    return NextResponse.json({ data })
}
