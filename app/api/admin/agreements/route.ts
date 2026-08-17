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
