import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminApi } from "@/lib/api-auth"
import { errorMessage } from "@/lib/error-message"

function sb() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )
}

// POST /api/admin/agreements — opret nyt registerkort ELLER løn/pensionsregel
export async function POST(req: NextRequest) {
    try {
        const auth = await requireAdminApi(["superadmin", "admin", "jurist"])
        if (!auth.ok) return auth.response

        const body = await req.json()
        const supabase = sb()

        // Opret ny lønregel
        if (body.wageRule) {
            const r = body.wageRule as Record<string, unknown>
            if (!r.agreementId || !r.rate_key || !r.profession_role || !r.employment_form || !r.rate_kind || !r.valid_from || !r.source_title || !r.source_url || !r.source_checked_at) {
                return NextResponse.json({ error: "agreementId, rate_key, profession_role, employment_form, rate_kind, valid_from, source_title, source_url og source_checked_at er påkrævet" }, { status: 400 })
            }
            const { data, error } = await supabase
                .from("agreement_wage_rules")
                .insert({
                    agreement_id: r.agreementId,
                    rate_key: r.rate_key,
                    profession_role: r.profession_role,
                    wage_group: r.wage_group ?? null,
                    employment_form: r.employment_form,
                    rate_kind: r.rate_kind,
                    amount: r.amount != null && r.amount !== "" ? Number(r.amount) : null,
                    currency: "DKK",
                    unit: r.unit ?? null,
                    pension_included: r.pension_included ?? false,
                    valid_from: r.valid_from,
                    valid_to: r.valid_to ?? null,
                    source_title: r.source_title,
                    source_url: r.source_url,
                    source_section: r.source_section ?? null,
                    source_checked_at: r.source_checked_at,
                    source_note: r.source_note ?? null,
                    status: "draft",
                })
                .select("id")
                .single()
            if (error) {
                if (error.code === "23505") return NextResponse.json({ error: "En regel med dette rate_key og valid_from findes allerede for denne overenskomst" }, { status: 409 })
                return NextResponse.json({ error: error.message }, { status: 500 })
            }
            return NextResponse.json({ ok: true, id: data.id })
        }

        // Opret ny pensionsregel
        if (body.pensionRule) {
            const r = body.pensionRule as Record<string, unknown>
            if (!r.agreementId || !r.employment_form || r.employer_percent == null || r.employee_percent == null || !r.basis || !r.scheme_kind || !r.valid_from || !r.section_reference) {
                return NextResponse.json({ error: "agreementId, employment_form, employer_percent, employee_percent, basis, scheme_kind, valid_from og section_reference er påkrævet" }, { status: 400 })
            }
            const { data, error } = await supabase
                .from("agreement_pension_rules")
                .insert({
                    agreement_id: r.agreementId,
                    employment_form: r.employment_form,
                    employer_percent: Number(r.employer_percent),
                    employee_percent: Number(r.employee_percent),
                    basis: r.basis,
                    scheme_kind: r.scheme_kind,
                    valid_from: r.valid_from,
                    valid_to: r.valid_to ?? null,
                    section_reference: r.section_reference,
                    source_note: r.source_note ?? null,
                    status: "draft",
                })
                .select("id")
                .single()
            if (error) {
                if (error.code === "23505") return NextResponse.json({ error: "En pensionsregel med denne ansættelsesform og valid_from findes allerede for denne overenskomst" }, { status: 409 })
                return NextResponse.json({ error: error.message }, { status: 500 })
            }
            return NextResponse.json({ ok: true, id: data.id })
        }

        // Opret nyt overenskomst-registerkort
        const { code, title, parties, valid_from } = body as {
            code?: string; title?: string; parties?: string[]; valid_from?: string
        }
        if (!code || !title) {
            return NextResponse.json({ error: "code og title er påkrævet" }, { status: 400 })
        }
        const { data: existing } = await supabase.from("agreements").select("id").eq("code", code).maybeSingle()
        if (existing) {
            return NextResponse.json({ error: `En overenskomst med id '${code}' eksisterer allerede` }, { status: 409 })
        }
        const { data, error } = await supabase
            .from("agreements")
            .insert({
                code, title, parties: parties ?? [], valid_from: valid_from || null,
                status: "draft", production_types: [], profession_roles: [], employment_forms: [],
            })
            .select("id")
            .single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true, id: data.id })
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
    }
}

// POST /api/admin/agreements — opret nyt registerkort ELLER opret løn/pensionsregel
// Body shapes:
//   { code, title, parties?, valid_from? }
//   { wageRule: { agreementId, rate_key, profession_role, employment_form, rate_kind, valid_from, source_title, source_url, source_checked_at, ...optional } }
//   { pensionRule: { agreementId, employment_form, employer_percent, employee_percent, basis, scheme_kind, valid_from, section_reference, ...optional } }

// PATCH /api/admin/agreements — redigér stamdata eller alle felter på løn/pensionsregler
// Body shapes:
//   { agreementId, title?, parties?, valid_from?, valid_to?, notes?, source_url?, content_url? }
//   { wageRuleId, profession_role?, wage_group?, employment_form?, rate_kind?, amount?, currency?, unit?, pension_included?, valid_from?, valid_to?, source_title?, source_url?, source_section?, source_checked_at?, source_note?, status? }
//   { pensionRuleId, employment_form?, employer_percent?, employee_percent?, basis?, scheme_kind?, valid_from?, valid_to?, section_reference?, source_note?, status? }
export async function PATCH(req: NextRequest) {
    try {
        const auth = await requireAdminApi()
        if (!auth.ok) return auth.response

        const body = await req.json()
        const supabase = sb()

        if (body.agreementId) {
            const allowed = ["title", "parties", "valid_from", "valid_to", "notes", "source_url", "content_url"]
            const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
            for (const key of allowed) {
                if (key in body) patch[key] = body[key] === "" ? null : body[key]
            }
            if (typeof patch.parties === "string") {
                patch.parties = (patch.parties as string).split(",").map((s: string) => s.trim()).filter(Boolean)
            }
            const { error } = await supabase.from("agreements").update(patch).eq("id", body.agreementId)
            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            return NextResponse.json({ ok: true })
        }

        if (body.wageRuleId) {
            const allowed = [
                "profession_role", "wage_group", "employment_form", "rate_kind",
                "amount", "currency", "unit", "pension_included",
                "valid_from", "valid_to",
                "source_title", "source_url", "source_section", "source_checked_at", "source_note",
                "status",
            ]
            const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
            for (const key of allowed) {
                if (key in body) patch[key] = body[key] === "" ? null : body[key]
            }
            if (patch.status === "approved") {
                patch.approved_by = auth.userId
                patch.approved_at = new Date().toISOString()
            } else if (patch.status === "draft" || patch.status === "archived") {
                patch.approved_by = null
                patch.approved_at = null
            }
            const { error } = await supabase.from("agreement_wage_rules").update(patch).eq("id", body.wageRuleId)
            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            return NextResponse.json({ ok: true })
        }

        if (body.pensionRuleId) {
            const allowed = [
                "employment_form", "employer_percent", "employee_percent",
                "basis", "scheme_kind", "valid_from", "valid_to",
                "section_reference", "source_note", "status",
            ]
            const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
            for (const key of allowed) {
                if (key in body) patch[key] = body[key] === "" ? null : body[key]
            }
            if (patch.status === "approved") {
                patch.approved_by = auth.userId
                patch.approved_at = new Date().toISOString()
            } else if (patch.status === "draft" || patch.status === "archived") {
                patch.approved_by = null
                patch.approved_at = null
            }
            const { error } = await supabase.from("agreement_pension_rules").update(patch).eq("id", body.pensionRuleId)
            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            return NextResponse.json({ ok: true })
        }

        return NextResponse.json({ error: "agreementId, wageRuleId eller pensionRuleId er påkrævet" }, { status: 400 })
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
    }
}

// DELETE /api/admin/agreements — slet eller arkivér individuel løn/pensionsregel
// Draft-regler slettes hårdt; approved-regler arkiveres for sporbarhed
export async function DELETE(req: NextRequest) {
    try {
        const auth = await requireAdminApi()
        if (!auth.ok) return auth.response

        const body = await req.json()
        const supabase = sb()

        if (body.wageRuleId) {
            const { data: rule } = await supabase
                .from("agreement_wage_rules")
                .select("id,status")
                .eq("id", body.wageRuleId)
                .maybeSingle()
            if (!rule) return NextResponse.json({ error: "Reglen blev ikke fundet" }, { status: 404 })
            if (rule.status === "draft" || rule.status === "archived") {
                const { error } = await supabase.from("agreement_wage_rules").delete().eq("id", body.wageRuleId)
                if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            } else {
                const { error } = await supabase.from("agreement_wage_rules")
                    .update({ status: "archived", updated_at: new Date().toISOString() })
                    .eq("id", body.wageRuleId)
                if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            }
            return NextResponse.json({ ok: true })
        }

        if (body.pensionRuleId) {
            const { data: rule } = await supabase
                .from("agreement_pension_rules")
                .select("id,status")
                .eq("id", body.pensionRuleId)
                .maybeSingle()
            if (!rule) return NextResponse.json({ error: "Reglen blev ikke fundet" }, { status: 404 })
            if (rule.status === "draft" || rule.status === "archived") {
                const { error } = await supabase.from("agreement_pension_rules").delete().eq("id", body.pensionRuleId)
                if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            } else {
                const { error } = await supabase.from("agreement_pension_rules")
                    .update({ status: "archived", updated_at: new Date().toISOString() })
                    .eq("id", body.pensionRuleId)
                if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            }
            return NextResponse.json({ ok: true })
        }

        return NextResponse.json({ error: "wageRuleId eller pensionRuleId er påkrævet" }, { status: 400 })
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
    }
}
