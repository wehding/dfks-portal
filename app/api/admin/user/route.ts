/**
 * app/api/admin/user/route.ts
 *
 * Server-side brugeradministration via Supabase Admin API.
 * Kræver SUPABASE_SERVICE_ROLE_KEY — bruges aldrig client-side.
 *
 * POST { action: "invite", email, name, rhId }
 *   → Opretter Supabase auth-bruger + linker user_id på rettighedshaver
 *   → Returnerer invite_url (kopieres og sendes manuelt hvis email ikke er sat op)
 *
 * POST { action: "reset", userId }
 *   → Genererer et password-reset link
 *   → Returnerer reset_url
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

function getAdmin() {
    const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!url || !key) throw new Error("Supabase admin credentials mangler")
    return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function POST(req: NextRequest) {
    try {
        // Kun admins må kalde denne route
        const supabase = await createServerClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 401 })
        const role = user.user_metadata?.role
        if (!["superadmin", "admin", "org-admin"].includes(role)) {
            return NextResponse.json({ error: "Mangler admin-rettigheder" }, { status: 403 })
        }

        const body = await req.json()
        const admin = getAdmin()

        // ── Invite: opret ny bruger ──────────────────────────────
        if (body.action === "invite") {
            const { email, name, rhId } = body
            if (!email || !rhId) {
                return NextResponse.json({ error: "email og rhId er påkrævet" }, { status: 400 })
            }

            // Generer invite-link
            const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
                type: "invite",
                email,
                options: {
                    data: { full_name: name, role: "member" },
                    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/portal/mine-kontrakter`,
                },
            })
            if (linkErr) throw new Error(linkErr.message)

            const newUserId = linkData.user.id

            // Link user_id på rettighedshaver (kun hvis det er en reel rettighedshaver, ikke staff)
            if (rhId && rhId !== "__staff__") {
                const { error: rhErr } = await admin
                    .from("rettighedshavere")
                    .update({ user_id: newUserId })
                    .eq("id", rhId)
                if (rhErr) throw new Error(`Kunne ikke linke bruger: ${rhErr.message}`)
            }

            return NextResponse.json({
                ok: true,
                user_id: newUserId,
                invite_url: linkData.properties.action_link,
            })
        }

        // ── Reset: generer password-reset link ───────────────────
        if (body.action === "reset") {
            const { userId, email } = body
            if (!email) return NextResponse.json({ error: "email er påkrævet" }, { status: 400 })

            const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
                type: "recovery",
                email,
                options: {
                    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/portal/mine-kontrakter`,
                },
            })
            if (linkErr) throw new Error(linkErr.message)

            return NextResponse.json({
                ok: true,
                reset_url: linkData.properties.action_link,
            })
        }

        // ── Unlink: fjern user_id fra rettighedshaver ────────────
        if (body.action === "unlink") {
            const { rhId } = body
            if (!rhId) return NextResponse.json({ error: "rhId påkrævet" }, { status: 400 })
            await admin.from("rettighedshavere").update({ user_id: null }).eq("id", rhId)
            return NextResponse.json({ ok: true })
        }

        return NextResponse.json({ error: "Ukendt action" }, { status: 400 })

    } catch (err: any) {
        console.error("[admin/user]", err)
        return NextResponse.json({ error: err.message ?? "Ukendt fejl" }, { status: 500 })
    }
}
