import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdminApi } from "@/lib/api-auth"
import { ADMIN_ROLES } from "@/lib/admin-roles"
import { callAi } from "@/lib/ai-client"
import { getAiRuntimeConfig } from "@/lib/ai-runtime"
import { extractPdfText } from "@/lib/pdf-parse"
import { extractWordText } from "@/lib/word-text"
import { maskPersonalData } from "@/lib/mask-text"
import { jsonrepair } from "jsonrepair"
import { SATSER_UDTRAEK_SYSTEM_PROMPT } from "@/lib/satser-udtraek-prompt"

function sb() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

// ── POST /api/admin/overenskomst/satser-udtraek ───────────────
// Udtræk strukturerede satskandidater fra et dokument med AI.
// Input: enten nyt filupload (pdfBase64 + filnavn) ELLER reference
//        til allerede indekseret bilag (bilagOverenskomst + bilagGyldigFra + bilagType).
// Output: kandidatliste uden at oprette noget i databasen.

export async function POST(req: NextRequest) {
    try {
        const auth = await requireAdminApi(ADMIN_ROLES)
        if (!auth.ok) return auth.response

        const body = await req.json()
        const { agreementId, pdfBase64, filnavn, bilagOverenskomst, bilagGyldigFra, bilagType, kildeTitel, kildeUrl } = body as {
            agreementId?: string
            pdfBase64?: string
            filnavn?: string
            bilagOverenskomst?: string
            bilagGyldigFra?: string
            bilagType?: string
            kildeTitel?: string
            kildeUrl?: string
        }

        if (!agreementId) {
            return NextResponse.json({ error: "agreementId er påkrævet" }, { status: 400 })
        }

        const supabase = sb()

        // Hent overenskomstens code + title til AI-kontekst
        const { data: agrRow } = await supabase
            .from("agreements")
            .select("code,title")
            .eq("id", agreementId)
            .maybeSingle()

        const agreementTitle = agrRow?.title ?? "ukendt overenskomst"
        const agreementCode = agrRow?.code ?? ""

        let kildetekst = ""
        let kildenavn = kildeTitel ?? ""

        if (pdfBase64) {
            // Ny fil-upload: udtræk tekst server-side
            if (typeof pdfBase64 !== "string" || pdfBase64.length > 35_000_000) {
                return NextResponse.json({ error: "Filen er for stor (maks. 25 MB)." }, { status: 413 })
            }
            const buf = Buffer.from(pdfBase64, "base64")
            if (buf.byteLength > 25 * 1024 * 1024) {
                return NextResponse.json({ error: "Filen er for stor (maks. 25 MB)." }, { status: 413 })
            }
            const fn = (filnavn ?? "").toLowerCase()
            try {
                kildetekst = fn.endsWith(".docx") || fn.endsWith(".doc")
                    ? await extractWordText(buf, filnavn ?? "")
                    : await extractPdfText(buf)
            } catch {
                return NextResponse.json({ error: "Filen kunne ikke læses. Understøtter PDF, DOCX og DOC." }, { status: 422 })
            }
            if (!kildetekst.trim()) {
                return NextResponse.json({ error: "Dokumentet indeholder ingen læsbar tekst." }, { status: 422 })
            }
            if (!kildenavn) kildenavn = filnavn ?? "Uploadet dokument"
        } else if (bilagOverenskomst && bilagGyldigFra && bilagType) {
            // Reference til allerede indekseret bilag: hent chunks fra knowledge_chunks
            const { data: agr } = await supabase.from("agreements").select("id").eq("code", bilagOverenskomst).maybeSingle()
            const agr_id = agr?.id ?? null

            let chunksQuery = supabase
                .from("knowledge_chunks")
                .select("tekst, kilde_titel")
                .eq("gyldig_fra", bilagGyldigFra)
                .eq("kilde_type", "overenskomst-bilag")
                .in("kategori", bilagType === "lønskema" ? ["lønskema", "lønskema-satser"] : [bilagType])
                .or(`org_id.is.null,org_id.eq.${auth.orgId}`)
                .order("kilde_id")

            chunksQuery = agr_id
                ? chunksQuery.eq("agreement_id", agr_id)
                : chunksQuery.eq("overenskomst", bilagOverenskomst)

            const { data: chunks } = await chunksQuery
            kildetekst = (chunks ?? []).map(c => c.tekst).join("\n\n")
            if (!kildetekst.trim()) {
                return NextResponse.json({ error: "Ingen tekst fundet for det valgte bilag." }, { status: 404 })
            }
            if (!kildenavn) kildenavn = (chunks ?? [])[0]?.kilde_titel?.split(" — ")[0] ?? bilagType
        } else {
            return NextResponse.json({ error: "Enten pdfBase64 eller bilagOverenskomst+bilagGyldigFra+bilagType er påkrævet" }, { status: 400 })
        }

        const runtime = await getAiRuntimeConfig("contract_advice")
        const rawText = await callAi({
            provider: runtime.provider,
            model: runtime.model,
            maxTokens: 16000,
            responseJson: true,
            system: SATSER_UDTRAEK_SYSTEM_PROMPT,
            userMessage: `Udtræk alle satser fra dette lønskema/bilag for overenskomsten "${agreementTitle}" (${agreementCode}).

Kilde: ${kildenavn}

Dokumenttekst:
${maskPersonalData(kildetekst).slice(0, 150_000)}`,
        })

        const first = rawText.indexOf("{")
        const last = rawText.lastIndexOf("}")
        if (first === -1 || last === -1) {
            return NextResponse.json({ error: "AI-modellen returnerede et ugyldigt svar." }, { status: 502 })
        }
        const clean = rawText.slice(first, last + 1).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")

        let parsed: { kandidater?: unknown[] }
        try {
            parsed = JSON.parse(clean)
        } catch {
            try {
                parsed = JSON.parse(jsonrepair(clean))
            } catch {
                return NextResponse.json({ error: "AI-modellen returnerede et ugyldigt svar." }, { status: 502 })
            }
        }

        return NextResponse.json({
            kandidater: parsed.kandidater ?? [],
            kildeTitel: kildenavn,
            kildeUrl: kildeUrl ?? null,
        })
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error("[satser-udtraek] fejl:", msg)
        return NextResponse.json({ error: `Satser kunne ikke udtrækkes: ${msg}` }, { status: 500 })
    }
}

// ── GET — hent eksisterende lønskema-bilag for en overenskomst ──
// Bruges til at populere dropdown i UI (vælg eksisterende bilag)

export async function GET(req: NextRequest) {
    const auth = await requireAdminApi(ADMIN_ROLES)
    if (!auth.ok) return auth.response

    const { searchParams } = new URL(req.url)
    const agreementId = searchParams.get("agreementId")
    if (!agreementId) return NextResponse.json({ bilag: [] })

    const supabase = sb()

    const { data: agr } = await supabase
        .from("agreements")
        .select("id,code")
        .eq("id", agreementId)
        .maybeSingle()

    if (!agr?.code) return NextResponse.json({ bilag: [] })

    // Find alle overenskomst-strings koblet til dette agreement
    const { data: chunksAlias } = await supabase
        .from("knowledge_chunks")
        .select("overenskomst")
        .eq("agreement_id", agr.id)
        .not("overenskomst", "is", null)
    const strings = [...new Set((chunksAlias ?? []).map(r => r.overenskomst as string))]

    let q = supabase
        .from("knowledge_chunks")
        .select("kategori, gyldig_fra, kilde_titel")
        .eq("kilde_type", "overenskomst-bilag")
        .in("kategori", ["lønskema", "lønskema-satser"])
        .or(`org_id.is.null,org_id.eq.${auth.orgId}`)
        .order("gyldig_fra", { ascending: false })

    q = strings.length > 0
        ? q.or(`agreement_id.eq.${agr.id},overenskomst.in.(${strings.join(",")})`)
        : q.eq("agreement_id", agr.id)

    const { data } = await q

    // Dedupliker til unikt (gyldig_fra, kategori-gruppe)
    const seen = new Set<string>()
    const bilag: { overenskomst: string; gyldigFra: string; bilagType: string; label: string }[] = []
    for (const c of data ?? []) {
        const key = `${agr.code}-${c.gyldig_fra}-lønskema`
        if (seen.has(key)) continue
        seen.add(key)
        bilag.push({ overenskomst: agr.code, gyldigFra: c.gyldig_fra, bilagType: "lønskema", label: `Lønskema — gyldig fra ${c.gyldig_fra}` })
    }

    return NextResponse.json({ bilag })
}
