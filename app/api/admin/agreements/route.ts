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

// POST /api/admin/agreements — opret nyt registerkort
export async function POST(req: NextRequest) {
    try {
        const auth = await requireAdminApi(["superadmin", "admin", "jurist"])
        if (!auth.ok) return auth.response

        const body = await req.json()
        const { code, title, parties, valid_from } = body as {
            code?: string
            title?: string
            parties?: string[]
            valid_from?: string
        }

        if (!code || !title) {
            return NextResponse.json({ error: "code og title er påkrævet" }, { status: 400 })
        }

        const supabase = sb()

        // Check for duplicate code
        const { data: existing } = await supabase
            .from("agreements")
            .select("id")
            .eq("code", code)
            .maybeSingle()

        if (existing) {
            return NextResponse.json({ error: `En overenskomst med id '${code}' eksisterer allerede` }, { status: 409 })
        }

        const { data, error } = await supabase
            .from("agreements")
            .insert({
                code,
                title,
                parties: parties ?? [],
                valid_from: valid_from || null,
                status: "draft",
                production_types: [],
                profession_roles: [],
                employment_forms: [],
            })
            .select("id")
            .single()

        if (error) return NextResponse.json({ error: error.message }, { status: 500 })

        return NextResponse.json({ ok: true, id: data.id })
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
    }
}

// PATCH /api/admin/agreements — redigér stamdata eller kilde-felter på løn/pensionsregler
// Body shapes:
//   { agreementId, title?, parties?, valid_from?, valid_to?, notes?, source_url?, content_url? }
//   { wageRuleId, source_title?, source_url?, source_note?, source_checked_at? }
//   { pensionRuleId, source_note? }
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
            // parties kan komme som streng (comma-sep) eller array
            if (typeof patch.parties === "string") {
                patch.parties = (patch.parties as string).split(",").map((s: string) => s.trim()).filter(Boolean)
            }
            const { error } = await supabase.from("agreements").update(patch).eq("id", body.agreementId)
            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            return NextResponse.json({ ok: true })
        }

        if (body.wageRuleId) {
            const allowed = ["source_title", "source_url", "source_note", "source_checked_at"]
            const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
            for (const key of allowed) {
                if (key in body) patch[key] = body[key] === "" ? null : body[key]
            }
            const { error } = await supabase.from("agreement_wage_rules").update(patch).eq("id", body.wageRuleId)
            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            return NextResponse.json({ ok: true })
        }

        if (body.pensionRuleId) {
            const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
            if ("source_note" in body) patch.source_note = body.source_note === "" ? null : body.source_note
            const { error } = await supabase.from("agreement_pension_rules").update(patch).eq("id", body.pensionRuleId)
            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            return NextResponse.json({ ok: true })
        }

        return NextResponse.json({ error: "agreementId, wageRuleId eller pensionRuleId er påkrævet" }, { status: 400 })
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
    }
}
