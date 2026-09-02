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
import { resolveBranding, resolveEmailSenderName, resolveReplyToEmail } from "@/lib/branding"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { recordAuditEvent } from "@/lib/audit-log-server"
import type { AuditContext } from "@/lib/audit-log"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { USER_ADMIN_ROLES } from "@/lib/admin-roles"
import { assertRightsHolderInOrg, assertUserInOrg, getRightsHolderInOrg } from "@/lib/authz"
import { buildAccountAccessUrl } from "@/lib/auth/account-access"
import { invitationAccessType, inviteSentAtAfterMail, isNewUserLimitReached } from "@/lib/auth/invitation-policy"
import { requireConfiguredSiteUrl } from "@/lib/site-url"
import {
    MEMBER_WORK_INVITE_SUBJECT,
    MEMBER_WORK_INVITE_TEXT,
    NON_MEMBER_WORK_INVITE_SUBJECT,
    NON_MEMBER_WORK_INVITE_TEXT,
} from "@/lib/rights-holder-invitation-templates"
import { renderInvitationTemplate } from "@/lib/work-share-reconciliation"
import { DEFAULT_BETA_INVITE_SUBJECT, DEFAULT_BETA_INVITE_TEXT, renderBetaInviteTemplate, todayInCopenhagen, validateBetaPeriod } from "@/lib/beta-test"

async function invitationWorkList(admin: ReturnType<typeof getAdmin>, orgId: string, rightsHolderId: string, preferredWorkId?: string | null) {
    const [{ data: assignments }, { data: participants }] = await Promise.all([
        admin.from("work_assignments").select("work_id,works(title,year)").eq("org_id", orgId).eq("rights_holder_id", rightsHolderId).limit(100),
        admin.from("work_share_participants").select("work_id,source_tags,work_share_cases!inner(org_id),works(title,year)").eq("rights_holder_id", rightsHolderId).eq("work_share_cases.org_id", orgId).is("excluded_at", null).limit(100),
    ])
    const rows = [
      ...(assignments ?? []).map(row => ({ ...row, sources: ["Portal"] })),
      ...(participants ?? []).map(row => ({ ...row, sources: Array.isArray(row.source_tags) && row.source_tags.length ? row.source_tags.map(source => source === "dfi" ? "DFI" : source === "tmdb" ? "TMDb" : source === "member" ? "Indtastet" : "Portal") : ["Portal"] })),
    ].flatMap(row => {
        const work = row.works as unknown as { title?: string | null; year?: number | null } | null
        return work?.title ? [{ id: row.work_id as string, title: work.title, year: work.year ?? null, sources: row.sources }] : []
    })
    const unique = [...rows.reduce((map, row) => {
      const existing = map.get(row.id)
      map.set(row.id, existing ? { ...existing, sources: [...new Set([...existing.sources, ...row.sources])] } : row)
      return map
    }, new Map<string, typeof rows[number]>()).values()]
      .sort((left, right) => Number(right.id === preferredWorkId) - Number(left.id === preferredWorkId) || (right.year ?? 0) - (left.year ?? 0) || left.title.localeCompare(right.title, "da"))
    return unique
}

function getAdmin(audit?: AuditContext) {
    return createServiceClient({ audit })
}

async function findAuthUserByEmail(admin: ReturnType<typeof getAdmin>, email: string) {
    const normalizedEmail = email.trim().toLowerCase()
    for (let page = 1; page <= 20; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) throw new Error(error.message)
        const match = data.users.find(user => user.email?.trim().toLowerCase() === normalizedEmail)
        if (match) return match
        if (data.users.length < 1000) return null
    }
    throw new Error("Brugerlisten er for stor til at kontrollere e-mailen sikkert.")
}

async function linkExistingAuthUserToHolder(
    admin: ReturnType<typeof getAdmin>,
    userId: string,
    holderId: string,
) {
    const { data: target, error: targetError } = await admin
        .from("rettighedshavere")
        .select("id, user_id")
        .eq("id", holderId)
        .single()
    if (targetError) throw new Error(targetError.message)
    if (target.user_id && target.user_id !== userId) throw new Error("Rettighedshaveren er allerede knyttet til en anden loginbruger.")

    const { data: currentProfile, error: currentProfileError } = await admin
        .from("rettighedshavere")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle()
    if (currentProfileError) throw new Error(currentProfileError.message)

    if (currentProfile && currentProfile.id !== holderId) {
        const [{ count: affiliations }, { count: contracts }, { count: assignments }] = await Promise.all([
            admin.from("org_affiliations").select("id", { count: "exact", head: true }).eq("rights_holder_id", currentProfile.id),
            admin.from("contracts").select("id", { count: "exact", head: true }).eq("rights_holder_id", currentProfile.id),
            admin.from("work_assignments").select("id", { count: "exact", head: true }).eq("rights_holder_id", currentProfile.id),
        ])
        // En profil med relationer (affiliation/kontrakt/assignment) må aldrig auto-slettes — det
        // ville kunne ramme en profil i en anden org. Kun en fuldt forældreløs stub (0 af alt, dvs.
        // ikke tilknyttet nogen org) sammenflettes automatisk; alt andet kræver manuel sammenfletning.
        if ((affiliations ?? 0) > 0 || (contracts ?? 0) > 0 || (assignments ?? 0) > 0) {
            throw new Error("Der findes allerede en anden aktiv rettighedshaverprofil med denne loginbruger. Sammenflet profilerne manuelt.")
        }
        const { error: detachError } = await admin.from("rettighedshavere").update({ user_id: null }).eq("id", currentProfile.id)
        if (detachError) throw new Error(detachError.message)
        const { error: linkError } = await admin.from("rettighedshavere").update({ user_id: userId }).eq("id", holderId).is("user_id", null)
        if (linkError) throw new Error(linkError.message)
        const { error: deleteDuplicateError } = await admin.from("rettighedshavere").delete().eq("id", currentProfile.id)
        if (deleteDuplicateError) throw new Error(deleteDuplicateError.message)
        return
    }

    if (!target.user_id) {
        const { error: linkError } = await admin.from("rettighedshavere").update({ user_id: userId }).eq("id", holderId).is("user_id", null)
        if (linkError) throw new Error(linkError.message)
    }
}

export async function POST(req: NextRequest) {
    try {
        // Kun admins må kalde denne route — tjek user_org_roles, ikke user_metadata
        const supabase = await createServerClient()
        const caller = await assertAdminRole(supabase, USER_ADMIN_ROLES)
        if (!caller) return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 })

        const body = await req.json()
        const correlationId = crypto.randomUUID()
        const auditContext: AuditContext = {
            actorUserId: caller.userId,
            actorOrgId: caller.orgId,
            actorRole: caller.role,
            source: "admin",
            correlationId,
        }
        const admin = getAdmin(auditContext)

        if (body.action === "preview_invite") {
            const rhId = typeof body.rhId === "string" ? body.rhId : ""
            if (!rhId) return NextResponse.json({ error: "rhId er påkrævet" }, { status: 400 })
            const orgId = caller.orgId ?? (caller.role === "superadmin" ? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5" : null)
            if (!orgId) return NextResponse.json({ error: "Din bruger er ikke knyttet til en organisation" }, { status: 403 })
            const holder = await getRightsHolderInOrg(admin, rhId, orgId)
            if (!holder) return NextResponse.json({ error: "Rettighedshaveren tilhører ikke din organisation" }, { status: 403 })
            const [{ data: org }, { data: affiliation }, allWorks] = await Promise.all([
                admin.from("organisations").select("name,branding,member_work_invite_subject,member_work_invite_text,non_member_work_invite_subject,non_member_work_invite_text").eq("id", orgId).single(),
                admin.from("org_affiliations").select("is_member").eq("org_id", orgId).eq("rights_holder_id", rhId).maybeSingle(),
                invitationWorkList(admin, orgId, rhId, typeof body.workId === "string" ? body.workId : null),
            ])
            const works = allWorks.slice(0, 10)
            const brand = resolveBranding(org as never)
            const isMember = affiliation?.is_member === true
            const subjectTemplate = isMember
                ? org?.member_work_invite_subject ?? MEMBER_WORK_INVITE_SUBJECT
                : org?.non_member_work_invite_subject ?? NON_MEMBER_WORK_INVITE_SUBJECT
            const bodyTemplate = isMember
                ? org?.member_work_invite_text ?? MEMBER_WORK_INVITE_TEXT
                : org?.non_member_work_invite_text ?? NON_MEMBER_WORK_INVITE_TEXT
            const worksText = works.length
                ? `${works.map(work => `• ${work.title}${work.year ? ` (${work.year})` : ""} · ${work.sources.join(" · ")}`).join("\n")}${allWorks.length > works.length ? `\n• ${allWorks.length - works.length} øvrige titler kan ses i portalen` : ""}`
                : "Vi har endnu ikke en sikker værksliste. Du kan gennemgå og tilføje dine værker i portalen."
            const values = { name: holder.full_name ?? "", organisation: org?.name ?? brand.long_name, worksText, primaryWork: works[0]?.title ?? "et værk" }
            return NextResponse.json({
                ok: true,
                name: holder.full_name,
                email: holder.email,
                membership: isMember ? "member" : "non_member",
                subject: renderInvitationTemplate(subjectTemplate, values),
                bodyText: renderInvitationTemplate(bodyTemplate, values),
                works,
            })
        }

        // ── Invite / reminder: opret eller gensend link ──────────
        if (body.action === "invite" || body.action === "reminder" || body.action === "beta_invite") {
            const { rhId, role: inviteRole, title } = body
            if (!rhId) return NextResponse.json({ error: "rhId er påkrævet" }, { status: 400 })

            const isStaff = rhId === "__staff__"
            if (isStaff && !["superadmin", "admin", "org-admin"].includes(caller.role)) {
                return NextResponse.json({ error: "Kun administratorer kan invitere medarbejdere" }, { status: 403 })
            }
            if (isStaff && inviteRole === "superadmin" && caller.role !== "superadmin") {
                return NextResponse.json({ error: "Kun superadmin kan invitere en superadmin" }, { status: 403 })
            }
            // Superadmin uden org-tilknytning hører til DFKS.
            const orgId = caller.orgId ?? (caller.role === "superadmin" ? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5" : null)
            if (!orgId) return NextResponse.json({ error: "Din bruger er ikke knyttet til en organisation" }, { status: 403 })

            const holder = isStaff ? null : await getRightsHolderInOrg(admin, rhId, orgId)
            if (!isStaff && !holder) {
                return NextResponse.json({ error: "Rettighedshaveren tilhører ikke din organisation" }, { status: 403 })
            }

            const email = isStaff ? String(body.email ?? "") : holder?.email
            const name = isStaff ? String(body.name ?? "") : holder?.full_name
            const phone = isStaff ? String(body.phone ?? "") : holder?.phone
            if (!email) return NextResponse.json({ error: "Der mangler email på brugeren" }, { status: 400 })
            if (!isStaff && !name?.trim()) return NextResponse.json({ error: "Der mangler navn på rettighedshaveren. Tilføj navnet før invitationen sendes." }, { status: 400 })

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
            const siteUrl = requireConfiguredSiteUrl()

            // Tjek max_users-grænse for den aktuelle org
            const [{ count: userCount }, { data: org }] = await Promise.all([
                admin.from("user_org_roles").select("*", { count: "exact", head: true }).eq("org_id", orgId),
                admin.from("organisations").select("max_users, name, from_email, branding, invite_email_text, invite_reminder_text, beta_invite_subject, beta_invite_text, beta_default_duration_days, member_work_invite_subject, member_work_invite_text, non_member_work_invite_subject, non_member_work_invite_text").eq("id", orgId).single(),
            ])
            const isBetaInvitation = !isStaff && body.action === "beta_invite"
            const betaStartDate = todayInCopenhagen()
            const requestedEndDate = typeof body.betaEndDate === "string" ? body.betaEndDate : ""
            const betaDurationDays = Math.min(365, Math.max(1, Number((org as { beta_default_duration_days?: number | null } | null)?.beta_default_duration_days ?? 10)))
            const fallbackEnd = new Date(`${betaStartDate}T12:00:00Z`)
            fallbackEnd.setUTCDate(fallbackEnd.getUTCDate() + betaDurationDays)
            const effectiveBetaEndDate = requestedEndDate || fallbackEnd.toISOString().slice(0, 10)
            if (isBetaInvitation) validateBetaPeriod(betaStartDate, effectiveBetaEndDate)
            const existingAuthUser = await findAuthUserByEmail(admin, email)
            if (org && isNewUserLimitReached({ existingUserId: existingAuthUser?.id, currentUsers: userCount ?? 0, maxUsers: org.max_users })) {
                return NextResponse.json({ error: `Brugerlimit nået (max ${org.max_users})` }, { status: 403 })
            }
            if (!isStaff && existingAuthUser) {
                await linkExistingAuthUserToHolder(admin, existingAuthUser.id, rhId)
            }

            // Nye brugere får et invitationslink. Eksisterende Auth-brugere får
            // et recovery-link, så invitationen hverken opretter en dublet eller fejler.
            const linkRequest = existingAuthUser
                ? {
                    type: "recovery" as const,
                    email,
                }
                : {
                    type: "invite" as const,
                    email,
                    options: {
                        data: {
                            full_name: name || email,
                            role: userRole,
                            profile_mode: isStaff ? "staff" : "rights_holder",
                            ...(phone ? { phone } : {}),
                            ...(title ? { title } : {}),
                        },
                    },
                }
            const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink(linkRequest)
            if (linkErr) throw new Error(linkErr.message)
            if (!linkData.properties?.hashed_token) throw new Error("Invitationslink kunne ikke genereres")

            const newUserId = existingAuthUser?.id ?? linkData.user.id
            const rolesToAssign = requestedRoles as string[]

            // Tildel staff-roller i user_org_roles
            if (rolesToAssign.length > 0 && rhId === "__staff__") {
                const { error: roleError } = await admin.from("user_org_roles").upsert(
                    rolesToAssign.map((r: string) => ({ user_id: newUserId, org_id: orgId, role: r })),
                    { onConflict: "user_id,org_id,role", ignoreDuplicates: true },
                )
                if (roleError) throw new Error(roleError.message)
            }

            // Link user_id på rettighedshaver. invite_sent_at sættes kun hvis mailen faktisk sendes.
            if (rhId && rhId !== "__staff__") {
                await linkExistingAuthUserToHolder(admin, newUserId, rhId)
                // Medlemmet tilknyttes automatisk den inviterende admins organisation,
                // så portalens org-opslag (user_org_roles) virker fra første login.
                const { error: memberRoleError } = await admin.from("user_org_roles").upsert(
                    [{ user_id: newUserId, org_id: orgId, role: "member" }],
                    { onConflict: "user_id,org_id,role", ignoreDuplicates: true },
                )
                if (memberRoleError) console.error("[admin/user] Medlemmets organisationstilknytning kunne ikke oprettes:", memberRoleError.message)
            }

            // Gmail-afsenderen er serverstyret; organisationen styrer navn og Reply-To.
            const orgForMail = org as { name?: string | null; from_email?: string | null; branding?: Record<string, unknown> | null } | null
            const brand = resolveBranding(orgForMail as never)
            const { data: affiliation } = !isStaff
                ? await admin.from("org_affiliations").select("is_member,beta_tester_since").eq("org_id", orgId).eq("rights_holder_id", rhId).maybeSingle()
                : { data: null }
            const allWorks = !isStaff && !isBetaInvitation ? await invitationWorkList(admin, orgId, rhId, typeof body.workId === "string" ? body.workId : null) : []
            const works = allWorks.slice(0, 10)
            const worksText = works.length
                ? `${works.map(work => `• ${work.title}${work.year ? ` (${work.year})` : ""} · ${work.sources.join(" · ")}`).join("\n")}${allWorks.length > works.length ? `\n• ${allWorks.length - works.length} øvrige titler kan ses i portalen` : ""}`
                : "Vi har endnu ikke en sikker værksliste. Du kan gennemgå og tilføje dine værker i portalen."
            const isWorkInvitation = !isStaff && body.includeWorks !== false && body.action !== "reminder" && !isBetaInvitation
            const isMember = affiliation?.is_member === true
            const workSubjectTemplate = isMember
                ? ((org as { member_work_invite_subject?: string | null } | null)?.member_work_invite_subject ?? MEMBER_WORK_INVITE_SUBJECT)
                : ((org as { non_member_work_invite_subject?: string | null } | null)?.non_member_work_invite_subject ?? NON_MEMBER_WORK_INVITE_SUBJECT)
            const workBodyTemplate = isMember
                ? ((org as { member_work_invite_text?: string | null } | null)?.member_work_invite_text ?? MEMBER_WORK_INVITE_TEXT)
                : ((org as { non_member_work_invite_text?: string | null } | null)?.non_member_work_invite_text ?? NON_MEMBER_WORK_INVITE_TEXT)
            const accessType = invitationAccessType(existingAuthUser?.id)
            const inviteUrl = buildAccountAccessUrl(
                siteUrl,
                linkData.properties.hashed_token,
                accessType,
            )
            const templateValues = { name: name || "", organisation: org?.name ?? brand.long_name, worksText, primaryWork: works[0]?.title ?? "et værk", invitationLink: inviteUrl }
            const mail = await sendEmail({
                to: email,
                fromName: resolveEmailSenderName(orgForMail as never),
                replyTo: resolveReplyToEmail(orgForMail as never),
                subject: isBetaInvitation
                    ? renderBetaInviteTemplate((org as { beta_invite_subject?: string | null } | null)?.beta_invite_subject ?? DEFAULT_BETA_INVITE_SUBJECT, { name: name || "", organisation: org?.name ?? brand.long_name, startDate: betaStartDate, endDate: effectiveBetaEndDate, invitationLink: inviteUrl, primaryWork: templateValues.primaryWork, worksText: templateValues.worksText })
                    : isWorkInvitation
                    ? renderInvitationTemplate(workSubjectTemplate, templateValues)
                    : body.action === "reminder"
                    ? `2. invitation til ${brand.long_name}s portal`
                    : `Invitation til ${brand.long_name}s portal`,
                html: inviteEmailHtml({
                    recipientName: name || "",
                    inviteUrl,
                    orgName: brand.long_name,
                    primaryColor: brand.primary_color,
                    bodyText: isBetaInvitation
                        ? renderBetaInviteTemplate((org as { beta_invite_text?: string | null } | null)?.beta_invite_text ?? DEFAULT_BETA_INVITE_TEXT, { name: name || "", organisation: org?.name ?? brand.long_name, startDate: betaStartDate, endDate: effectiveBetaEndDate, invitationLink: inviteUrl, primaryWork: templateValues.primaryWork, worksText: templateValues.worksText })
                        : isWorkInvitation
                        ? renderInvitationTemplate(workBodyTemplate, templateValues)
                        : body.action === "reminder"
                        ? renderInvitationTemplate(((org as { invite_reminder_text?: string | null } | null)?.invite_reminder_text ?? ""), templateValues) || null
                        : renderInvitationTemplate(((org as { invite_email_text?: string | null } | null)?.invite_email_text ?? ""), templateValues) || null,
                    bodyIncludesGreeting: isWorkInvitation || isBetaInvitation,
                    variant: body.action === "reminder" ? "reminder" : "invite",
                    accessType,
                }),
            })

            const inviteSentAt = inviteSentAtAfterMail(mail.ok, new Date().toISOString())
            if (isBetaInvitation) {
                const { error: betaError } = await admin.rpc("set_beta_tester_status", {
                    p_org_id: orgId, p_rights_holder_id: rhId, p_actor_user_id: caller.userId, p_actor_role: caller.role,
                    p_enabled: true, p_period_start: betaStartDate, p_period_end: effectiveBetaEndDate,
                    p_email_delivered: mail.ok, p_link_type: accessType,
                })
                if (betaError) throw new Error(betaError.message)
            }
            if (inviteSentAt && rhId && rhId !== "__staff__") {
                const { error: sentAtError } = await admin
                    .from("rettighedshavere")
                    .update({ invite_sent_at: inviteSentAt })
                    .eq("id", rhId)
                if (sentAtError) console.error("[admin/user] Invitationsmailen blev sendt, men invite_sent_at kunne ikke opdateres.")
            }

            if (!isBetaInvitation) await recordAuditEvent({
                context: auditContext,
                action: "invite",
                entityType: isStaff ? "auth_users" : "rettighedshavere",
                entityId: isStaff ? newUserId : String(rhId),
                entityLabel: isBetaInvitation ? "Betatester" : name || (isStaff ? "Medarbejder" : "Rettighedshaver"),
                targetMemberUuid: isStaff ? null : String(rhId),
                orgIds: [orgId],
                purposeCode: isBetaInvitation ? "beta_program_administration" : undefined,
                legalBasis: isBetaInvitation ? "GDPR Art. 6(1)(f), Art. 9(2)(d)" : undefined,
                dataCategories: isBetaInvitation ? ["identity_data", "contact_data", "union_membership_data"] : undefined,
                systemComponent: isBetaInvitation ? "admin.user.beta-invite" : undefined,
                metadata: {
                    reminder: body.action === "reminder",
                    invitationType: isBetaInvitation ? "beta" : "standard",
                    linkType: accessType,
                    emailDelivered: mail.ok,
                },
            })

            return NextResponse.json({
                ok: true,
                user_id: newUserId,
                invite_url: inviteUrl,
                link_type: accessType,
                email_sent: mail.ok,
                email_error: mail.ok ? undefined : mail.error,
                works,
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
            })
            if (linkErr) throw new Error(linkErr.message)
            if (!linkData.properties?.hashed_token) throw new Error("Nulstillingslink kunne ikke genereres")

            const resetUrl = buildAccountAccessUrl(
                requireConfiguredSiteUrl(),
                linkData.properties.hashed_token,
                "recovery"
            )

            await recordAuditEvent({
                context: auditContext,
                action: "reset_link",
                entityType: body.rhId ? "rettighedshavere" : "auth_users",
                entityId: String(body.rhId ?? body.userId ?? linkData.user.id),
                entityLabel: "Nulstillingslink",
                orgIds: [caller.orgId],
            })

            return NextResponse.json({
                ok: true,
                reset_url: resetUrl,
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

        return NextResponse.json({ error: "Ukendt action" }, { status: 400 })

    } catch (err: unknown) {
        console.error("[admin/user]", err)
        console.error("[admin-user] request failed", err instanceof Error ? err.name : "unknown")
        return NextResponse.json({ error: "Brugeren kunne ikke opdateres." }, { status: 500 })
    }
}
