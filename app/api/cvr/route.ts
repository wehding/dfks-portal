import { NextRequest, NextResponse } from "next/server"
import { requireSessionApi } from "@/lib/api-auth"

export async function GET(req: NextRequest) {
    const auth = await requireSessionApi()
    if (!auth.ok) return auth.response
    const cvr = req.nextUrl.searchParams.get("cvr")?.trim()
    if (!cvr || !/^\d{8}$/.test(cvr)) {
        return NextResponse.json({ error: "Ugyldigt CVR-nummer" }, { status: 400 })
    }

    try {
        const res = await fetch("https://api.cvr.dev/api/elastic/cvr/virksomhed/_search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: { term: { cvrNummer: parseInt(cvr) } } }),
        })

        if (!res.ok) {
            return NextResponse.json({ error: "CVR-register svarede ikke" }, { status: 502 })
        }

        const data = await res.json()
        const hit = data?.hits?.hits?.[0]?._source
        if (!hit) {
            return NextResponse.json({ error: "CVR-nummer ikke fundet" }, { status: 404 })
        }

        const navn = hit.virksomhedMetadata?.nyesteNavn?.navn ?? null

        return NextResponse.json({ navn })
    } catch {
        return NextResponse.json({ error: "Fejl ved CVR-opslag" }, { status: 500 })
    }
}
