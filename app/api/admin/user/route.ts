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
import { sendEmail, inviteEmailHtml } from "@/lib/email"
import { resolveFromEmail, resolveBranding } from "@/lib/branding"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { assertRightsHolderInOrg, assertUserInOrg, getRightsHolderInOrg } from "@/lib/authz"

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

        // ── Invite / reminder: opret eller gensend link ──────────
        if (body.action === "invite" || body.action === "reminder") {
            const { rhId, role: inviteRole, title } = body
            if (!rhId) return NextResponse.json({ error: "rhId er påkrævet" }, { status: 400 })

            const isStaff = rhId === "__staff__"
            if (isStaff && !["superadmin", "admin", "org-admin"].includes(caller.role)) {
                return NextResponse.json({ error: "Kun administratorer kan invitere medarbejdere" }, { status: 403 })
            }
            if (isStaff && inviteRole === "superadmin" && caller.role !== "superadmin") {
                return NextResponse.json({ error: "Kun superadmin kan invitere en superadmin" }, { status: 403 })
            }
            const holder = isStaff ? null : await getRightsHolderInOrg(admin, rhId, caller.orgId)
            if (!isStaff && !holder) {
                return NextResponse.json({ error: "Rettighedshaveren tilhører ikke din organisation" }, { status: 403 })
            }

            const email = isStaff ? String(body.email ?? "") : holder?.email
            const name = isStaff ? String(body.name ?? "") : holder?.full_name
            const phone = isStaff ? String(body.phone ?? "") : holder?.phone
            if (!email) return NextResponse.json({ error: "Der mangler email på brugeren" }, { status: 400 })

            const requestedRoles = Array.isArray(body.roles)
                ? body.roles
                : body.role ? [body.role] : []
            const allowedRoles = ["superadmin", "admin", "org-admin", "jurist", "viewer"]
            if (isStaff && requestedRoles.some((role: unknown) => typeof role !== "string" || !allowedRoles.includes(role))) {
                return NextResponse.json({ error: "En eller flere roller er ugyldige" }, { status: 400 })
            }
            if (isStaff && requestedRoles.includes("superadmin") && caller.role !== "superadmin") {
                return NextResponse.json({ error: "Kun superadmin kan tildele superadmin-rollen" }, { status: 403 })
            }

            const userRole = isStaff ? (inviteRole ?? "admin") : "member"
            const redirectTo = isStaff
                ? `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/admin`
                : `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/portal/mine-kontrakter`

            const orgId = caller.orgId
            if (!orgId) return NextResponse.json({ error: "Din bruger er ikke knyttet til en organisation" }, { status: 403 })

            // Tjek max_users-grænse for den aktuelle org
            const [{ count: userCount }, { data: org }] = await Promise.all([
                admin.from("user_org_roles").select("*", { count: "exact", head: true }).eq("org_id", orgId),
                admin.from("organisations").select("max_users, name, from_email, branding, invite_email_text, invite_reminder_text").eq("id", orgId).single(),
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
            const rolesToAssign = requestedRoles as string[]

            // Tildel staff-roller i user_org_roles
            if (rolesToAssign.length > 0 && rhId === "__staff__") {
                await admin.from("user_org_roles").insert(
                    rolesToAssign.map((r: string) => ({ user_id: newUserId, org_id: orgId, role: r }))
                )
            }

            // Link user_id på rettighedshaver. invite_sent_at sættes kun hvis mailen faktisk sendes.
            if (rhId && rhId !== "__staff__") {
                const { error: rhErr } = await admin
                    .from("rettighedshavere")
                    .update({ user_id: newUserId })
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
                subject: body.action === "reminder"
                    ? `2. invitation til ${brand.long_name}s portal`
                    : `Invitation til ${brand.long_name}s portal`,
                html: inviteEmailHtml({
                    recipientName: name || "",
                    inviteUrl,
                    orgName: brand.long_name,
                    primaryColor: brand.primary_color,
                    bodyText: body.action === "reminder"
                        ? ((org as { invite_reminder_text?: string | null } | null)?.invite_reminder_text ?? null)
                        : ((org as { invite_email_text?: string | null } | null)?.invite_email_text ?? null),
                    variant: body.action === "reminder" ? "reminder" : "invite",
                }),
            })

            if (mail.ok && rhId && rhId !== "__staff__") {
                await admin
                    .from("rettighedshavere")
                    .update({ invite_sent_at: new Date().toISOString() })
                    .eq("id", rhId)
            }

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
            let email: string | null = null
            if (body.rhId) {
                const holder = await getRightsHolderInOrg(admin, String(body.rhId), caller.orgId)
                if (!holder) return NextResponse.json({ error: "Rettighedshaveren tilhører ikke din organisation" }, { status: 403 })
                email = holder.email
            } else if (body.userId) {
                try {
                    await assertUserInOrg(admin, String(body.userId), caller.orgId)
                } catch {
                    return NextResponse.json({ error: "Brugeren tilhører ikke din organisation" }, { status: 403 })
                }
                const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(String(body.userId))
                if (authErr) throw new Error(authErr.message)
                email = authUser.user?.email ?? null
            }
            if (!email) return NextResponse.json({ error: "Der mangler email på brugeren" }, { status: 400 })

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
            try {
                await assertRightsHolderInOrg(admin, String(rhId), caller.orgId)
            } catch {
                return NextResponse.json({ error: "Rettighedshaveren tilhører ikke din organisation" }, { status: 403 })
            }
            await admin.from("rettighedshavere").update({ user_id: null }).eq("id", rhId)
            return NextResponse.json({ ok: true })
        }

        // ── Reset onboarding ──────────────────────────────────────
        if (body.action === "reset-onboarding") {
            const { rhId } = body
            if (!rhId) return NextResponse.json({ error: "rhId påkrævet" }, { status: 400 })
            try {
                await assertRightsHolderInOrg(admin, String(rhId), caller.orgId)
            } catch {
                return NextResponse.json({ error: "Rettighedshaveren tilhører ikke din organisation" }, { status: 403 })
            }
            const { error: upErr } = await admin
                .from("rettighedshavere")
                .update({ onboarding_completed: false })
                .eq("id", rhId)
            if (upErr) throw new Error(upErr.message)
            return NextResponse.json({ ok: true })
        }

        return NextResponse.json({ error: "Ukendt action" }, { status: 400 })

    } catch (err: unknown) {
        console.error("[admin/user]", err)
        return NextResponse.json({ error: err instanceof Error ? err.message : "Ukendt fejl" }, { status: 500 })
    }
}
