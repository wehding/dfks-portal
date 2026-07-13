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
import { DEFAULT_ORG_ID } from "@/lib/org"
import { sendEmail, inviteEmailHtml } from "@/lib/email"
import { resolveFromEmail, resolveBranding } from "@/lib/branding"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { assertAdminRole, SUPERADMIN_ROLES } from "@/lib/supabase/assert-admin"

function getAdmin() {
    const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!
    if (!url || !key) throw new Error("Supabase admin credentials mangler")
    return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function POST(req: NextRequest) {
    try {
        // Kun admins må kalde denne route — tjek user_org_roles, ikke user_metadata
        const supabase = await createServerClient()
        const caller = await assertAdminRole(supabase)
        if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

        const body = await req.json()
        const admin = getAdmin()

        // ── Invite: opret ny bruger ──────────────────────────────
        if (body.action === "invite") {
            const { email, name, rhId, role: inviteRole, phone, title } = body
            if (!email || !rhId) {
                return NextResponse.json({ error: "email og rhId er påkrævet" }, { status: 400 })
            }

            const isStaff = rhId === "__staff__"
            const userRole = isStaff ? (inviteRole ?? "admin") : "member"
            const redirectTo = isStaff
                ? `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/admin`
                : `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/portal/mine-kontrakter`

            // Tjek max_users-grænse for org
            const DFKS_ORG_ID = DEFAULT_ORG_ID
            const [{ count: userCount }, { data: org }] = await Promise.all([
                admin.from("user_org_roles").select("*", { count: "exact", head: true }).eq("org_id", DFKS_ORG_ID),
                admin.from("organisations").select("max_users, name, from_email, branding").eq("id", DFKS_ORG_ID).single(),
            ])
            if (org && org.max_users !== -1 && (userCount ?? 0) >= org.max_users) {
                return NextResponse.json({ error: `Brugerlimit nået (max ${org.max_users})` }, { status: 403 })
            }

            // Generer invite-link
            const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
                type: "invite",
                email,
                options: {
                    data: {
                        full_name: name || email,
                        role: userRole,
                        ...(phone ? { phone } : {}),
                        ...(title ? { title } : {}),
                    },
                    redirectTo,
                },
            })
            if (linkErr) throw new Error(linkErr.message)

            const newUserId = linkData.user.id
            const { roles, role: singleRole } = body
            const rolesToAssign: string[] = roles ?? (singleRole ? [singleRole] : [])

            // Tildel staff-roller i user_org_roles
            if (rolesToAssign.length > 0 && rhId === "__staff__") {
                await admin.from("user_org_roles").insert(
                    rolesToAssign.map((r: string) => ({ user_id: newUserId, org_id: DFKS_ORG_ID, role: r }))
                )
            }

            // Link user_id på rettighedshaver + markér at invitation er sendt
            if (rhId && rhId !== "__staff__") {
                const { error: rhErr } = await admin
                    .from("rettighedshavere")
                    .update({ user_id: newUserId, invite_sent_at: new Date().toISOString() })
                    .eq("id", rhId)
                if (rhErr) throw new Error(`Kunne ikke linke bruger: ${rhErr.message}`)
            }

            // Send invitationsmail fra foreningens arbejdsmail (branding-styret afsender)
            const orgForMail = org as { name?: string | null; from_email?: string | null; branding?: Record<string, unknown> | null } | null
            const brand = resolveBranding(orgForMail as never)
            const inviteUrl = linkData.properties.action_link
            const mail = await sendEmail({
                to: email,
                from: resolveFromEmail(orgForMail as never),
                subject: `Invitation til ${brand.long_name}s portal`,
                html: inviteEmailHtml({
                    recipientName: name || "",
                    inviteUrl,
                    orgName: brand.long_name,
                    primaryColor: brand.primary_color,
                }),
            })

            return NextResponse.json({
                ok: true,
                user_id: newUserId,
                invite_url: inviteUrl,
                email_sent: mail.ok,
                email_error: mail.ok ? undefined : mail.error,
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

        // ── Reset onboarding ──────────────────────────────────────
        if (body.action === "reset-onboarding") {
            const { rhId } = body
            if (!rhId) return NextResponse.json({ error: "rhId påkrævet" }, { status: 400 })
            const { error: upErr } = await admin
                .from("rettighedshavere")
                .update({ onboarding_completed: false })
                .eq("id", rhId)
            if (upErr) throw new Error(upErr.message)
            return NextResponse.json({ ok: true })
        }

        return NextResponse.json({ error: "Ukendt action" }, { status: 400 })

    } catch (err: any) {
        console.error("[admin/user]", err)
        return NextResponse.json({ error: err.message ?? "Ukendt fejl" }, { status: 500 })
    }
}
