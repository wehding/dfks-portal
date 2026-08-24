"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { revalidatePath } from "next/cache"
import type { PayrollExportBatch } from "@/app/actions/rights-settlements"

const ADMIN_ORG_ROLES = ["superadmin", "admin", "org-admin"] as const

// DataLøn CSV-kolonner (standard lønart 1920 = rettigheder/royalty)
// Format: PersonnummerID;Lønart;Beløb;Periode;Tekst
// Beløb i kroner (ikke øre), 2 decimaler, komma som decimaltegn

export type ExportSystem = "datalon" | "zenegy" | "csv"

export type ExportRow = {
    rights_holder_id: string
    rights_holder_name: string
    member_number: string | null
    payroll_recipient_id: string | null    // ekstern ID i lønsystem
    payable_amount_minor: number           // øre
    currency: string
    period_label: string
    fund_name: string
}

export type ExportResult = {
    success: boolean
    batch_id?: string
    row_count?: number
    csv?: string                           // returneres kun ved preview
    skipped_count?: number                 // rettighedshavere uden løn-ID
    error?: string
}

// ── Generér CSV-indhold ───────────────────────────────────────────────────────

function buildDataLonCsv(rows: ExportRow[], lønart: string): string {
    const header = "PersonnummerID;Lønart;Beløb;Periode;Tekst"
    const lines = rows
        .filter(r => r.payroll_recipient_id)
        .map(r => {
            const beløb = (r.payable_amount_minor / 100)
                .toFixed(2)
                .replace(".", ",")
            const tekst = `${r.fund_name} rettigheder`
            return [
                r.payroll_recipient_id,
                lønart,
                beløb,
                r.period_label,
                tekst,
            ].join(";")
        })

    return [header, ...lines].join("\r\n")
}

function buildGenericCsv(rows: ExportRow[]): string {
    const header = [
        "Rettighedshaver",
        "Medlemsnr",
        "DataLøn-ID",
        "Beløb (kr.)",
        "Valuta",
        "Periode",
        "Fond",
    ].join(";")

    const lines = rows.map(r => {
        const beløb = (r.payable_amount_minor / 100)
            .toFixed(2)
            .replace(".", ",")
        return [
            r.rights_holder_name,
            r.member_number ?? "",
            r.payroll_recipient_id ?? "(mangler)",
            beløb,
            r.currency,
            r.period_label,
            r.fund_name,
        ].join(";")
    })

    return [header, ...lines].join("\r\n")
}

// ── Hent eksportdata for én settlement ──────────────────────────────────────

async function fetchExportRows(
    settlement_id: string,
    org_id: string,
    system: ExportSystem,
    db: ReturnType<typeof createServiceClient>
): Promise<{ rows: ExportRow[]; skipped: number }> {
    // Hent settlement-items der er betalbare
    const { data: items, error } = await db
        .from("settlement_items")
        .select(`
            rights_holder_id,
            payable_amount,
            currency,
            below_threshold,
            rettighedshavere ( full_name, member_number ),
            settlements ( label, rights_funds ( name ) )
        `)
        .eq("settlement_id", settlement_id)
        .eq("org_id", org_id)
        .eq("below_threshold", false)

    if (error) throw error

    // Hent lønsystem-referencer
    const holderIds = [...new Set((items ?? []).map((i: any) => i.rights_holder_id))]
    const { data: refs } = await db
        .from("payroll_recipient_references")
        .select("rights_holder_id, recipient_id")
        .eq("org_id", org_id)
        .eq("system", system === "csv" ? "datalon" : system)
        .eq("active", true)
        .in("rights_holder_id", holderIds)

    const refMap = new Map<string, string>(
        (refs ?? []).map((r: any) => [r.rights_holder_id, r.recipient_id])
    )

    // Summér pr. rettighedshaver (kan have flere poster pr. run)
    const byHolder = new Map<string, ExportRow>()
    for (const item of (items ?? []) as any[]) {
        const existing = byHolder.get(item.rights_holder_id)
        const amount = Number(item.payable_amount)
        const settlement = Array.isArray(item.settlements) ? item.settlements[0] : item.settlements
        const fund = Array.isArray(settlement?.rights_funds) ? settlement.rights_funds[0] : settlement?.rights_funds
        const rh = Array.isArray(item.rettighedshavere) ? item.rettighedshavere[0] : item.rettighedshavere

        if (existing) {
            existing.payable_amount_minor += amount
        } else {
            byHolder.set(item.rights_holder_id, {
                rights_holder_id: item.rights_holder_id,
                rights_holder_name: rh?.full_name ?? "Ukendt",
                member_number: rh?.member_number ?? null,
                payroll_recipient_id: refMap.get(item.rights_holder_id) ?? null,
                payable_amount_minor: amount,
                currency: item.currency ?? "DKK",
                period_label: settlement?.label ?? "",
                fund_name: fund?.name ?? "Fond",
            })
        }
    }

    const rows = Array.from(byHolder.values())
    const skipped = rows.filter(r => !r.payroll_recipient_id).length
    return { rows, skipped }
}

// ── Preview: returnér CSV-indhold uden at gemme batch ────────────────────────

export async function previewExport(
    settlement_id: string,
    system: ExportSystem,
    lønart: string = "1920"
): Promise<ExportResult> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { rows, skipped } = await fetchExportRows(settlement_id, caller.orgId, system, db)
        const csv = system === "datalon"
            ? buildDataLonCsv(rows, lønart)
            : buildGenericCsv(rows)

        return {
            success: true,
            row_count: rows.filter(r => r.payroll_recipient_id).length,
            csv,
            skipped_count: skipped,
        }
    } catch (err) {
        console.error("[rights-export] previewExport fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Eksportér og log batch ────────────────────────────────────────────────────

export async function exportSettlement(
    settlement_id: string,
    system: ExportSystem,
    lønart: string = "1920"
): Promise<ExportResult> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        // Validér at settlement tilhører org og er i rette status
        const { data: settlement, error: sErr } = await db
            .from("settlements")
            .select("id, status, label")
            .eq("id", settlement_id)
            .eq("org_id", caller.orgId)
            .single()
        if (sErr || !settlement) throw new Error("Afregning ikke fundet")
        if (!["approved", "paid_out"].includes(settlement.status)) {
            throw new Error("Afregning skal være godkendt inden eksport")
        }

        const { rows, skipped } = await fetchExportRows(settlement_id, caller.orgId, system, db)
        const exportableRows = rows.filter(r => r.payroll_recipient_id)

        const csv = system === "datalon"
            ? buildDataLonCsv(rows, lønart)
            : buildGenericCsv(rows)

        // Log batch
        const filename = `${system}_${settlement.label.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`
        const { data: batch, error: bErr } = await db
            .from("payroll_export_batches")
            .insert({
                org_id: caller.orgId,
                settlement_id,
                export_system: system,
                exported_at: new Date().toISOString(),
                exported_by: caller.userId,
                row_count: exportableRows.length,
                file_reference: filename,
                status: "exported",
            })
            .select("id")
            .single()

        if (bErr) throw bErr

        // Opret payouts for betalbare poster
        if (exportableRows.length > 0) {
            const payouts = exportableRows.map(r => ({
                org_id: caller.orgId,
                settlement_id,
                rights_holder_id: r.rights_holder_id,
                gross_amount: r.payable_amount_minor,
                net_amount: r.payable_amount_minor,
                currency: r.currency,
                status: "pending",
                payroll_batch_id: batch.id,
            }))

            // ON CONFLICT DO NOTHING — idempotent
            await db.from("payouts").upsert(payouts, {
                onConflict: "settlement_id,rights_holder_id",
                ignoreDuplicates: true,
            })
        }

        revalidatePath("/admin/rettighedsmidler/afregning")
        return {
            success: true,
            batch_id: batch.id,
            row_count: exportableRows.length,
            csv,
            skipped_count: skipped,
        }
    } catch (err) {
        console.error("[rights-export] exportSettlement fejlede:", err)
        return { success: false, error: String(err) }
    }
}

// ── Hent eksporthistorik ──────────────────────────────────────────────────────

export async function getExportBatches(settlement_id?: string): Promise<{
    success: boolean
    batches: Array<PayrollExportBatch & { settlement_label?: string }>
    error?: string
}> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        let q = db
            .from("payroll_export_batches")
            .select(`*, settlements ( label )`)
            .eq("org_id", caller.orgId)
            .order("exported_at", { ascending: false })

        if (settlement_id) q = q.eq("settlement_id", settlement_id)

        const { data, error } = await q
        if (error) throw error

        const batches = (data ?? []).map((b: any) => ({
            ...b,
            settlement_label: Array.isArray(b.settlements) ? b.settlements[0]?.label : b.settlements?.label,
        }))

        return { success: true, batches }
    } catch (err) {
        console.error("[rights-export] getExportBatches fejlede:", err)
        return { success: false, batches: [], error: String(err) }
    }
}

// Re-eksportér eksisterende batch som ny fil (ingen ny DB-post)
export async function redownloadExport(
    batch_id: string
): Promise<ExportResult> {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) throw new Error("Ingen adgang")
        const db = createServiceClient()

        const { data: batch, error } = await db
            .from("payroll_export_batches")
            .select("settlement_id, export_system")
            .eq("id", batch_id)
            .eq("org_id", caller.orgId)
            .single()

        if (error || !batch) throw new Error("Batch ikke fundet")

        const { rows } = await fetchExportRows(batch.settlement_id, caller.orgId, batch.export_system as ExportSystem, db)
        const csv = batch.export_system === "datalon"
            ? buildDataLonCsv(rows, "1920")
            : buildGenericCsv(rows)

        return { success: true, csv, row_count: rows.filter(r => r.payroll_recipient_id).length }
    } catch (err) {
        console.error("[rights-export] redownloadExport fejlede:", err)
        return { success: false, error: String(err) }
    }
}

