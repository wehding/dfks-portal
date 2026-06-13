import { NextRequest, NextResponse } from "next/server"

// GET /api/dfi/search?q=<query>
// Server-side proxy til DFI's filmkatalog API.
// Returnerer { results: { id, name }[] }
// Resultater caches i 24 timer — DFI-data ændrer sig sjældent.

export const revalidate = 86400 // 24 timer (Next.js route cache)

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams.get("q")?.trim()
    if (!q || q.length < 2) return NextResponse.json({ results: [] })

    const username = process.env.DFI_API_USERNAME
    const password = process.env.DFI_API_PASSWORD
    if (!username || !password) {
        // Returnér tom liste uden fejl — DFI er sekundær kilde
        return NextResponse.json({ results: [] })
    }

    const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64")

    try {
        const res = await fetch(
            `https://data.dfi.dk/v1/company?Name=${encodeURIComponent(q)}`,
            {
                headers: {
                    Authorization: authHeader,
                    Accept: "application/json",
                    "Accept-Language": "da-DK",
                },
                signal: AbortSignal.timeout(8000),
                next: { revalidate: 86400 },
            }
        )
        if (!res.ok) return NextResponse.json({ results: [] })
        const data = await res.json()
        const results = (data.CompanyList ?? []).slice(0, 8).map((c: any) => ({
            id: String(c.Id ?? c.id ?? ""),
            name: (c.Name ?? c.CompanyName ?? "") as string,
        }))
        return NextResponse.json({ results })
    } catch {
        return NextResponse.json({ results: [] })
    }
}
