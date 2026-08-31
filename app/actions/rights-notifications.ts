"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { revalidatePath } from "next/cache"
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit"

const ADMIN_ORG_ROLES = ["superadmin", "admin", "org-admin"] as const

// ── Typer ────────────────────────────────────────────────────────────────────

export type NotificationChannel = "email" | "portal" | "sms"
export type NotificationStatus = "pending" | "sent" | "failed" | "cancelled"

export type NotificationEventType =
    | "allocation_created"
    | "allocation_withheld"
    | "claim_deadline_approaching"
    | "claim_deadline_passed"
    | "settlement_approved"
    | "payout_completed"
    | "search_publication_published"
    | "manual"

export type RightsNotification = {
    id: string
    org_id: string
    rights_holder_id: string | null
    event_type: NotificationEventType
    subject_type: string | null     // "run", "settlement", "claim" osv.
    subject_id: string | null
    channel: NotificationChannel
    status: NotificationStatus
    scheduled_at: string
    sent_at: string | null
    failed_at: string | null
    failed_reason: string | null
    body_preview: string | null
    created_at: string
    // Joins
    rights_holder_name?: string
    member_number?: string | null
}

export type AdminTask = {
    id: string
    org_id: string
    task_type: string
    subject_type: string | null
    subject_id: string | null
    priority: "low" | "normal" | "high" | "urgent"
    status: "open" | "in_progress" | "resolved" | "dismissed"
    description: string | null
    created_at: string
    resolved_at: string | null
    resolved_by: string | null
    // Joins
    rights_holder_name?: string | null
}

// ── Notifikationer: hent ─────────────────────────────────────────────────────

export async function getRightsNotifications(opts?: {
    status?: NotificationStatus
    event_type?: NotificationEventType
    rights_holder_id?: string
    limit?: number
}): Promise<{
    success: boolean
    notifications: RightsNotification[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        let q = db
            .from("rights_notifications")
            .select(`*, rettighedshavere ( full_name, member_number )`)
            .eq("org_id", caller.orgId)
            .order("scheduled_at", { ascending: false })
            .limit(opts?.limit ?? 200)

        if (opts?.status) q = q.eq("status", opts.status)
        if (opts?.event_type) q = q.eq("event_type", opts.event_type)
        if (opts?.rights_holder_id) q = q.eq("rights_holder_id", opts.rights_holder_id)

        const { data, error } = await q
        if (error) throw error

        const notifications: RightsNotification[] = (data ?? []).map((r) => ({
            ...r,
            rights_holder_name: r.rettighedshavere?.full_name,
            member_number: r.rettighedshavere?.member_number,
        }))

        await recordSensitiveFlow({
            actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
            action: "read", component: "admin.rights_notifications", entityType: "rights_notification",
            targetMemberUuids: [...new Set(notifications.map(item => item.rights_holder_id).filter((id): id is string => Boolean(id)))],
            purposeCode: "rights_administration", legalBasis: "gdpr_art_6_1_f",
            dataCategories: ["rights_data", "contact_data"], counts: { results: notifications.length },
        })

        return { success: true, notifications }
    } catch (err) {
        console.error("[rights-notifications] getRightsNotifications fejlede:", err)
        return { success: false, notifications: [], error: String(err) }
    }
}

// ── Notifikationer: opret manuelt ────────────────────────────────────────────

export async function createManualNotification(payload: {
    rights_holder_id: string
    channel: NotificationChannel
    body_preview: string
    subject_type?: string | null
    subject_id?: string | null
    scheduled_at?: string
}): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { error } = await db
            .from("rights_notifications")
            .insert({
                org_id: caller.orgId,
                rights_holder_id: payload.rights_holder_id,
                event_type: "manual",
                subject_type: payload.subject_type ?? null,
                subject_id: payload.subject_id ?? null,
                channel: payload.channel,
                status: "pending",
                scheduled_at: payload.scheduled_at ?? new Date().toISOString(),
                body_preview: payload.body_preview,
            })

        if (error) throw error
        revalidatePath("/admin/rettighedsmidler/notifikationer")
        return { success: true }
    } catch (err) {
        console.error("[rights-notifications] createManualNotification fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Notifikationer: masseafsendelse for settlement ────────────────────────────
// Opretter én notifikation pr. rettighedshaver med betalbart beløb.

export async function scheduleSettlementNotifications(
    settlement_id: string,
    channel: NotificationChannel
): Promise<{ success: boolean; count: number; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        // Hent settlement og poster
        const { data: settlement, error: sErr } = await db
            .from("settlements")
            .select("label, currency")
            .eq("id", settlement_id)
            .eq("org_id", caller.orgId)
            .single()
        if (sErr) throw sErr

        const { data: items, error: iErr } = await db
            .from("settlement_items")
            .select("rights_holder_id, payable_amount, below_threshold")
            .eq("settlement_id", settlement_id)
            .eq("org_id", caller.orgId)
            .eq("below_threshold", false)
        if (iErr) throw iErr

        // Summér pr. rettighedshaver
        const byHolder = new Map<string, number>()
        for (const item of items ?? []) {
            const prev = byHolder.get(item.rights_holder_id) ?? 0
            byHolder.set(item.rights_holder_id, prev + Number(item.payable_amount))
        }

        if (byHolder.size === 0) {
            return { success: true, count: 0 }
        }

        const rows = Array.from(byHolder.entries()).map(([rhId, amount]) => ({
            org_id: caller.orgId,
            rights_holder_id: rhId,
            event_type: "payout_completed" as NotificationEventType,
            subject_type: "settlement",
            subject_id: settlement_id,
            channel,
            status: "pending",
            scheduled_at: new Date().toISOString(),
            body_preview: `${settlement.label}: ${(amount / 100).toLocaleString("da-DK", { style: "currency", currency: settlement.currency ?? "DKK", minimumFractionDigits: 2 })}`,
        }))

        const { error } = await db
            .from("rights_notifications")
            .insert(rows)

        // Ignorér idempotency-duplikater
        if (error && !error.message.includes("unique")) throw error

        revalidatePath("/admin/rettighedsmidler/notifikationer")
        return { success: true, count: rows.length }
    } catch (err) {
        console.error("[rights-notifications] scheduleSettlementNotifications fejlede:", err)
        return { success: false, count: 0, error: String(err) }
    }
}

// ── Notifikationer: markér sendt / annullér ───────────────────────────────────

export async function updateNotificationStatus(
    id: string,
    status: "sent" | "cancelled"
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const patch: Record<string, unknown> = { status }
        if (status === "sent") patch.sent_at = new Date().toISOString()

        const { error } = await db
            .from("rights_notifications")
            .update(patch)
            .eq("id", id)
            .eq("org_id", caller.orgId)

        if (error) throw error
        revalidatePath("/admin/rettighedsmidler/notifikationer")
        return { success: true }
    } catch (err) {
        console.error("[rights-notifications] updateNotificationStatus fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Admin-opgavekø: hent fra view ────────────────────────────────────────────

export async function getAdminTasks(status?: "open" | "in_progress" | "resolved" | "dismissed"): Promise<{
    success: boolean
    tasks: AdminTask[]
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        let q = db
            .from("rights_notifications_admin_tasks")
            .select("*")
            .eq("org_id", caller.orgId)
            .order("created_at", { ascending: false })

        if (status) q = q.eq("status", status)

        const { data, error } = await q
        if (error) throw error

        return { success: true, tasks: (data ?? []) as AdminTask[] }
    } catch (err) {
        console.error("[rights-notifications] getAdminTasks fejlede:", err)
        return { success: false, tasks: [], error: String(err) }
    }
}

// ── Admin-opgavekø: opdatér status ───────────────────────────────────────────

export async function updateAdminTaskStatus(
    id: string,
    status: "in_progress" | "resolved" | "dismissed"
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const patch: Record<string, unknown> = { status }
        if (status === "resolved") {
            patch.resolved_at = new Date().toISOString()
            patch.resolved_by = caller.userId
        }

        const { error } = await db
            .from("rights_notifications_admin_tasks")
            .update(patch)
            .eq("id", id)
            .eq("org_id", caller.orgId)

        if (error) throw error
        revalidatePath("/admin/rettighedsmidler/notifikationer")
        return { success: true }
    } catch (err) {
        console.error("[rights-notifications] updateAdminTaskStatus fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Statistik: hent notifikationsoverblik ────────────────────────────────────

export async function getNotificationStats(): Promise<{
    success: boolean
    pending: number
    sent: number
    failed: number
    open_tasks: number
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const [nRes, tRes] = await Promise.all([
            db.from("rights_notifications")
                .select("status")
                .eq("org_id", caller.orgId),
            db.from("rights_notifications_admin_tasks")
                .select("status")
                .eq("org_id", caller.orgId)
                .in("status", ["open", "in_progress"]),
        ])

        const notifs = nRes.data ?? []
        return {
            success: true,
            pending: notifs.filter((n) => n.status === "pending").length,
            sent: notifs.filter((n) => n.status === "sent").length,
            failed: notifs.filter((n) => n.status === "failed").length,
            open_tasks: tRes.data?.length ?? 0,
        }
    } catch (err) {
        console.error("[rights-notifications] getNotificationStats fejlede:", err)
        return { success: false, pending: 0, sent: 0, failed: 0, open_tasks: 0, error: String(err) }
    }
}
