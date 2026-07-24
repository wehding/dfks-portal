import { NextRequest, NextResponse } from "next/server"
import { requireSessionApi } from "@/lib/api-auth"

export async function GET(req: NextRequest) {
    const auth = await requireSessionApi()
    if (!auth.ok) return auth.response
    const cvr = req.nextUrl.searchParams.get("cvr")?.trim()
    if (!cvr || !/^\d{8}$/.test(cvr)) {
        return NextResponse.json({ error: "Ugyldigt CVR-nummer" }, { status: 400 })
    }

    const apiKey = process.env.CVR_DEV_API_KEY
    if (!apiKey) {
        return NextResponse.json({ error: "CVR-opslag er ikke konfigureret. CVR_DEV_API_KEY mangler." }, { status: 503 })
    }

    try {
        const res = await fetch(`https://api.cvr.dev/api/cvr/virksomhed?cvr_nummer=${cvr}`, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
            signal: AbortSignal.timeout(10000),
        })

        if (!res.ok) {
            const error = res.status === 401
                ? "CVR-API-nøglen er ugyldig"
                : res.status === 402
                    ? "CVR-abonnementet er ikke aktivt"
                    : res.status === 429
                        ? "CVR-registerets forespørgselsgrænse er nået. Prøv igen senere."
                        : "CVR-register svarede ikke"
            return NextResponse.json({ error }, { status: res.status === 429 ? 429 : 502 })
        }

        const data = await res.json()
        const hit = Array.isArray(data) ? data[0] : null
        if (!hit) {
            return NextResponse.json({ error: "CVR-nummer ikke fundet" }, { status: 404 })
        }

        const metadata = hit.virksomhedMetadata ?? {}
        const navn = metadata.nyesteNavn?.navn ?? null
        const addressParts = [
            metadata.nyesteBeliggenhedsadresse?.vejnavn,
            metadata.nyesteBeliggenhedsadresse?.husnummerFra,
            metadata.nyesteBeliggenhedsadresse?.bogstavFra,
            metadata.nyesteBeliggenhedsadresse?.postnummer,
            metadata.nyesteBeliggenhedsadresse?.postdistrikt,
        ].filter(Boolean)
        const address = addressParts.length ? addressParts.join(" ").replace(/\s+/g, " ").trim() : null
        const status = metadata.sammensatStatus ?? hit.virksomhedsstatus?.[0]?.status ?? null
        const phone = [...(Array.isArray(hit.telefonNummer) ? hit.telefonNummer : [])]
            .reverse()
            .find(entry => !entry?.hemmelig && typeof entry?.kontaktoplysning === "string")
            ?.kontaktoplysning ?? null

        return NextResponse.json({
            navn,
            legalName: navn,
            registrationNumber: cvr,
            address,
            contactPhone: phone,
            status,
            companyType: metadata.nyesteVirksomhedsform?.kortBeskrivelse ?? null,
        })
    } catch {
        return NextResponse.json({ error: "Fejl ved CVR-opslag" }, { status: 500 })
    }
}
