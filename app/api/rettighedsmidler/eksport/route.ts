import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { assertAdminRole } from "@/lib/supabase/assert-admin"
import { exportSettlement, redownloadExport, type ExportSystem } from "@/app/actions/rights-export"

const ADMIN_ORG_ROLES = ["superadmin", "admin", "org-admin"] as const

// GET /api/rettighedsmidler/eksport?settlement_id=...&system=datalon&lønart=1920
// GET /api/rettighedsmidler/eksport?batch_id=...   (re-download)
export async function GET(req: NextRequest) {
    try {
        const supabase = await createClient()
        const caller = await assertAdminRole(supabase, ADMIN_ORG_ROLES)
        if (!caller) {
            return NextResponse.json({ error: "Ingen adgang" }, { status: 403 })
        }

        const { searchParams } = req.nextUrl
        const settlementId = searchParams.get("settlement_id")
        const batchId = searchParams.get("batch_id")
        const system = (searchParams.get("system") ?? "datalon") as ExportSystem
        const lønart = searchParams.get("lønart") ?? "1920"

        let csv: string
        let filename: string
        let rowCount: number

        if (batchId) {
            // Re-download eksisterende batch
            const result = await redownloadExport(batchId)
            if (!result.success || !result.csv) {
                return NextResponse.json({ error: result.error ?? "Eksport fejlede" }, { status: 500 })
            }
            csv = result.csv
            rowCount = result.row_count ?? 0
            filename = `reeksport_${batchId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv`
        } else if (settlementId) {
            // Ny eksport + log batch
            const result = await exportSettlement(settlementId, system, lønart)
            if (!result.success || !result.csv) {
                return NextResponse.json({ error: result.error ?? "Eksport fejlede" }, { status: 500 })
            }
            csv = result.csv
            rowCount = result.row_count ?? 0
            filename = `${system}_eksport_${new Date().toISOString().slice(0, 10)}.csv`
        } else {
            return NextResponse.json({ error: "settlement_id eller batch_id kræves" }, { status: 400 })
        }

        // BOM for korrekt tegnkodning i Excel (æøå)
        const bom = "﻿"
        const body = bom + csv

        return new NextResponse(body, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "X-Row-Count": String(rowCount),
            },
        })
    } catch (err) {
        console.error("[eksport-route] Uventet fejl:", err)
        return NextResponse.json({ error: "Intern fejl" }, { status: 500 })
    }
}
