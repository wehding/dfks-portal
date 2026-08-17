import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getEmbedding } from "@/lib/embedding-provider"
import { extractPdfText } from "@/lib/pdf-parse"
import { requireStaffModuleApi } from "@/lib/api-auth"
import { recordAuditEvent } from "@/lib/audit-log-server"
import { callAi } from "@/lib/ai-client"
import { getAiRuntimeConfig } from "@/lib/ai-runtime"
import { maskPersonalData } from "@/lib/mask-text"

function sb() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

// ── Chunk hele dokumentet med overlap ────────────────────────

function chunkDokument(tekst: string, opts: { størrelse: number; overlap: number; prefix: string }): string[] {
    const ord = tekst.split(/\s+/).filter(Boolean)
    const chunks: string[] = []
    let i = 0
    while (i < ord.length) {
        const chunk = ord.slice(i, i + opts.størrelse).join(" ")
        if (chunk.trim()) chunks.push(opts.prefix + chunk)
        i += opts.størrelse - opts.overlap
    }
    return chunks
}

const sourcePart = (value: unknown) => String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9æøå._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)

// ── POST /api/admin/overenskomst — analysér PDF med Claude ───

export async function POST(req: NextRequest) {
    try {
        const auth = await requireStaffModuleApi("contract_reviews", "write")
        if (!auth.ok) return auth.response
        const { pdfBase64, overenskomst, gyldigFra } = await req.json()
        if (!pdfBase64 || !overenskomst || !gyldigFra) {
            return NextResponse.json({ error: "pdfBase64, overenskomst og gyldigFra er påkrævet" }, { status: 400 })
        }
        if (typeof pdfBase64 !== "string" || pdfBase64.length > 35_000_000) {
            return NextResponse.json({ error: "Dokumentet må højst fylde 25 MB." }, { status: 413 })
        }

        const pdfBuffer = Buffer.from(pdfBase64, "base64")
        if (pdfBuffer.byteLength > 25 * 1024 * 1024) {
            return NextResponse.json({ error: "Dokumentet må højst fylde 25 MB." }, { status: 413 })
        }
        const pdfTekst = await extractPdfText(pdfBuffer)
        if (!pdfTekst.trim()) {
            return NextResponse.json({ error: "Dokumentet indeholder ingen læsbar tekst." }, { status: 422 })
        }

        // Hent eksisterende kategorinavne fra DB — bruges som vejledning til AI'en
        let tidligereKategorier: string[] = []
        try {
            const { data: katRows } = await sb()
                .from("knowledge_chunks")
                .select("kategori")
                .not("kategori", "is", null)
                .neq("kategori", "fuldt-dokument")
            tidligereKategorier = [...new Set((katRows ?? []).map(r => r.kategori as string))].sort()
        } catch { /* ingen kategorier tilgængelige */ }

        const kategorikontekst = tidligereKategorier.length > 0
            ? `\n\nAllerede brugte kategorinavne på tværs af indekserede overenskomster: ${tidligereKategorier.map(k => `"${k}"`).join(", ")}. Brug et af disse navne hvis afsnittet reelt svarer til en allerede brugt kategori; ellers foreslå et nyt præcist dansk navn.`
            : ""

        const runtime = await getAiRuntimeConfig("contract_advice")
        const rawText = await callAi({
            provider: runtime.provider,
            model: runtime.model,
            maxTokens: 4000,
            responseJson: true,
            promptCaching: runtime.promptCachingEnabled,
            system: `Du er ekspert i danske overenskomster (film, TV, medie og lignende brancher).

Analyser det uploadede dokument og identificer de reelt betydningsfulde, indholdsmæssigt afgrænsede afsnit. Du bestemmer selv hvilke afsnit der er relevante — begræns dig ikke til en fast liste. Fokuser på afsnit med konkrete rettigheder, pligter, satser eller frister. Udelad rent administrative afsnit som "ikrafttræden", "underskrifter" og lignende, medmindre de indeholder noget indholdsmæssigt væsentligt.

Typiske typer af indhold der ofte er relevante: løn/honorar, pension, arbejdstid/overarbejde, ferie/orlov/barsel, ophavsrettigheder/rettigheder, opsigelse/varsler, fonde og bidragspuljer, tvistløsning — men dokumentet kan indeholde andet, og du skal finde hvad der faktisk er der.

For hvert afsnit:
- Angiv afsnittets overskrift præcis som den står i dokumentet
- Angiv de første 60 tegn af afsnittet (start_marker) — bruges til at finde teksten i dokumentet
- Giv afsnittet en kort, præcis dansk kategori-betegnelse (fx "pension", "barsel", "arbejdstid", "ophavsret", "opsigelse")
- Angiv din tillid: høj hvis afsnittet er eksplicit og tydelig, lav hvis uklart eller implicit
- Angiv eventuelt en sats hvis der er en konkret procentsats eller beløb${kategorikontekst}

VIGTIGT: Inkluder IKKE den fulde tekst i JSON-svaret — kun titel, start_marker, kategori, tillid og sats.

Returner KUN valid JSON uden markdown:
{
  "sektioner": [
    {
      "titel": "Afsnittets overskrift fra dokumentet",
      "start_marker": "de første 60 tegn af afsnittet",
      "kategori": "pension",
      "tillid": "høj",
      "sats": "9 %"
    }
  ]
}`,
            userMessage: `Analysér denne ${String(overenskomst).slice(0, 120)}-overenskomst gyldig fra ${String(gyldigFra).slice(0, 20)} og identificer alle indholdsmæssigt relevante afsnit.\n\n${maskPersonalData(pdfTekst).slice(0, 180_000)}`,
        })
        const firstBrace = rawText.indexOf("{")
        const lastBrace = rawText.lastIndexOf("}")
        if (firstBrace === -1 || lastBrace === -1) {
            return NextResponse.json({ error: "AI-modellen returnerede et ugyldigt svar." }, { status: 502 })
        }
        // Fjern kontroltegn der kan ødelægge JSON (null-bytes, form feeds m.m.)
        const cleanText = rawText.slice(firstBrace, lastBrace + 1).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
        const parsed = JSON.parse(cleanText)

        // Brug start_marker til at finde den fulde sektions-tekst i pdfTekst
        // Normaliser til sammenligning: fjern overskydende mellemrum og linjeskift
        const normPdf = pdfTekst.replace(/\s+/g, " ").trim()
        type RawSektion = { titel: string; start_marker?: string; kategori: string; tillid?: string; sats?: string; tekst?: string }
        const sektionerMedTekst = (parsed.sektioner as RawSektion[] ?? []).map((s, idx, arr) => {
            if (s.tekst) return s  // Allerede udfyldt (fremtidssikring)
            const marker = s.start_marker ?? s.titel
            const normMarker = marker.replace(/\s+/g, " ").trim()
            const startIdx = normPdf.indexOf(normMarker)
            if (startIdx === -1) {
                // Marker ikke fundet — brug titel som tekst
                return { ...s, tekst: s.titel }
            }
            // Find slutningen: næste sektions start_marker eller titel, eller 4000 tegn
            let endIdx = normPdf.length
            for (let j = idx + 1; j < arr.length; j++) {
                const nextMarker = (arr[j].start_marker ?? arr[j].titel).replace(/\s+/g, " ").trim()
                const found = normPdf.indexOf(nextMarker, startIdx + normMarker.length)
                if (found !== -1) { endIdx = found; break }
            }
            const tekst = normPdf.slice(startIdx, Math.min(endIdx, startIdx + 6000)).trim()
            return { ...s, tekst }
        })

        return NextResponse.json({ sektioner: sektionerMedTekst, pdfTekst })
    } catch (e: unknown) {
        console.error("[overenskomst] analysis failed", e instanceof Error ? e.name : "unknown")
        return NextResponse.json({ error: "Dokumentet kunne ikke analyseres." }, { status: 500 })
    }
}

// ── PUT /api/admin/overenskomst — indeksér godkendte sektioner ─

export async function PUT(req: NextRequest) {
    try {
        const auth = await requireStaffModuleApi("contract_reviews", "write")
        if (!auth.ok) return auth.response
        const { sektioner, overenskomst, gyldigFra, pdfTekst, filnavn } = await req.json()
        if (!sektioner || !overenskomst || !gyldigFra) {
            return NextResponse.json({ error: "sektioner, overenskomst og gyldigFra er påkrævet" }, { status: 400 })
        }

        const supabase = sb()

        // Slå agreement_id op via overenskomst-kode (agreement.code = overenskomst)
        const { data: agreementRow } = await supabase
            .from("agreements")
            .select("id")
            .eq("code", overenskomst)
            .maybeSingle()
        const agreement_id: string | null = agreementRow?.id ?? null

        // Deaktivér gamle chunks for denne overenskomst (via agreement_id hvis tilgængeligt, ellers overenskomst-streng)
        if (agreement_id) {
            await supabase.from("knowledge_chunks").update({ aktiv: false }).eq("org_id", auth.orgId).eq("agreement_id", agreement_id)
        } else {
            await supabase.from("knowledge_chunks").update({ aktiv: false }).eq("org_id", auth.orgId).eq("overenskomst", overenskomst)
        }

        let indekseret = 0
        const fejl: string[] = []

        // LAG 1: Kategoriserede sektioner
        for (const sektion of sektioner) {
            try {
                const kilde_id = `${auth.orgId}:${sourcePart(overenskomst)}-${sourcePart(sektion.kategori)}-${gyldigFra}`
                const tekstTilEmbedding = `${sektion.titel}: ${sektion.tekst}`
                const embedding = await getEmbedding(tekstTilEmbedding, true)

                await supabase.from("knowledge_chunks").upsert({
                    org_id: auth.orgId,
                    kilde_id,
                    kilde_type: "overenskomst",
                    kilde_titel: `${overenskomst} — ${sektion.titel}`,
                    tekst: sektion.tekst,
                    metadata: { sats: sektion.sats ?? null, overenskomst, gyldig_fra: gyldigFra },
                    embedding,
                    overenskomst: overenskomst.toLowerCase(),
                    agreement_id,
                    kategori: sektion.kategori,
                    gyldig_fra: gyldigFra,
                    aktiv: true,
                    sidst_opdateret: new Date().toISOString(),
                }, { onConflict: "kilde_id" })

                indekseret++
                await new Promise(r => setTimeout(r, 100))
            } catch (e: unknown) {
                console.error("[overenskomst] section indexing failed", e instanceof Error ? e.name : "unknown")
                fejl.push(`${sourcePart(sektion.kategori) || "sektion"}: kunne ikke indekseres`)
            }
        }

        // LAG 2: Hele dokumentet i overlappende chunks
        let fuldeChunks = 0
        if (pdfTekst?.trim()) {
            const chunks = chunkDokument(pdfTekst, {
                størrelse: 500,
                overlap: 50,
                prefix: `${overenskomst} overenskomst ${gyldigFra}: `,
            })

            for (let i = 0; i < chunks.length; i++) {
                try {
                    const kilde_id = `${auth.orgId}:${sourcePart(overenskomst)}-fuldt-${gyldigFra}-${i}`
                    const embedding = await getEmbedding(chunks[i], true)

                    await supabase.from("knowledge_chunks").upsert({
                        org_id: auth.orgId,
                        kilde_id,
                        kilde_type: "overenskomst",
                        kilde_titel: `${overenskomst} — fuldt dokument (${i + 1}/${chunks.length})`,
                        tekst: chunks[i],
                        metadata: { overenskomst, gyldig_fra: gyldigFra, chunk_nr: i },
                        embedding,
                        overenskomst: overenskomst.toLowerCase(),
                        agreement_id,
                        kategori: "fuldt-dokument",
                        gyldig_fra: gyldigFra,
                        aktiv: true,
                        sidst_opdateret: new Date().toISOString(),
                    }, { onConflict: "kilde_id" })

                    fuldeChunks++
                    await new Promise(r => setTimeout(r, 100))
                } catch (e: unknown) {
                    console.error("[overenskomst] chunk indexing failed", e instanceof Error ? e.name : "unknown")
                    fejl.push(`chunk ${i}: kunne ikke indekseres`)
                }
            }
        }

        // Gem upload-tracking
        await supabase.from("overenskomst_uploads").insert({
            org_id: auth.orgId,
            navn: filnavn ?? overenskomst,
            overenskomst,
            gyldig_fra: gyldigFra,
            original_filnavn: filnavn ?? null,
            status: "indekseret",
        })

        return NextResponse.json({
            ok: true,
            kategoriserede: indekseret,
            fuldeChunks,
            total: indekseret + fuldeChunks,
            fejl,
        })
    } catch (e: unknown) {
        console.error("[overenskomst] indexing failed", e instanceof Error ? e.name : "unknown")
        return NextResponse.json({ error: "Overenskomsten kunne ikke gemmes." }, { status: 500 })
    }
}

// ── PATCH /api/admin/overenskomst — arkivér/genaktivér ───────

export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json()
        if (body.agreementId) {
            const auth = await requireStaffModuleApi("contract_reviews", "write")
            if (!auth.ok) return auth.response
            const status = body.status
            if (!['draft', 'approved', 'archived'].includes(status)) {
                return NextResponse.json({ error: "Ugyldig status" }, { status: 400 })
            }
            const supabase = sb()
            const { data: before, error: beforeError } = await supabase
                .from("agreements")
                .select("id,title,status,org_id")
                .eq("id", body.agreementId)
                .maybeSingle()
            if (beforeError || !before) return NextResponse.json({ error: "Overenskomsten blev ikke fundet" }, { status: 404 })
            if ((before.org_id === null && !auth.global) || (before.org_id !== null && before.org_id !== auth.orgId && !auth.global)) {
                return NextResponse.json({ error: "Overenskomsten blev ikke fundet" }, { status: 404 })
            }
            const approval = status === "approved" ? { approved_by: auth.userId, approved_at: new Date().toISOString() } : { approved_by: null, approved_at: null }
            let agreementUpdate = supabase.from("agreements").update({ status, ...approval, updated_at: new Date().toISOString() }).eq("id", body.agreementId)
            if (!auth.global) agreementUpdate = agreementUpdate.eq("org_id", auth.orgId)
            const { error } = await agreementUpdate
            if (error) {
                console.error("[overenskomst] agreement update failed", error.code)
                return NextResponse.json({ error: "Overenskomsten kunne ikke opdateres." }, { status: 500 })
            }
            await supabase.from("agreement_pension_rules").update({ status, ...approval, updated_at: new Date().toISOString() }).eq("agreement_id", body.agreementId)
            try {
                await recordAuditEvent({
                    context: { actorUserId: auth.userId, actorOrgId: auth.orgId, actorRole: auth.role, source: "admin" },
                    action: "update",
                    entityType: "agreement",
                    entityId: body.agreementId,
                    entityLabel: before.title,
                    changes: [{ field: "status", old: before.status, new: status }],
                })
            } catch (auditError) {
                console.error("[overenskomst] Status blev gemt, men auditlog fejlede", auditError)
            }
            return NextResponse.json({ ok: true })
        }
        const auth = await requireStaffModuleApi("contract_reviews", "write")
        if (!auth.ok) return auth.response
        const { overenskomst, gyldigFra, aktiv } = body
        if (!overenskomst || !gyldigFra) {
            return NextResponse.json({ error: "overenskomst og gyldigFra er påkrævet" }, { status: 400 })
        }
        const supabase = sb()
        const { data: agr } = await supabase.from("agreements").select("id").eq("code", overenskomst).maybeSingle()
        const agreement_id = agr?.id ?? null

        let q = supabase.from("knowledge_chunks").update({ aktiv }).eq("org_id", auth.orgId).eq("gyldig_fra", gyldigFra)
        q = agreement_id ? q.eq("agreement_id", agreement_id) : q.eq("overenskomst", overenskomst)

        const { error } = await q
        if (error) {
            console.error("[overenskomst] version update failed", error.code)
            return NextResponse.json({ error: "Overenskomstversionen kunne ikke opdateres." }, { status: 500 })
        }
        return NextResponse.json({ ok: true })
    } catch (e: unknown) {
        console.error("[overenskomst] patch failed", e instanceof Error ? e.name : "unknown")
        return NextResponse.json({ error: "Overenskomsten kunne ikke opdateres." }, { status: 500 })
    }
}

// ── DELETE /api/admin/overenskomst — slet version ────────────

export async function DELETE(req: NextRequest) {
    try {
        const auth = await requireStaffModuleApi("contract_reviews", "write")
        if (!auth.ok) return auth.response
        const { overenskomst, gyldigFra } = await req.json()
        if (!overenskomst || !gyldigFra) {
            return NextResponse.json({ error: "overenskomst og gyldigFra er påkrævet" }, { status: 400 })
        }
        const supabase = sb()
        const { data: agr } = await supabase.from("agreements").select("id").eq("code", overenskomst).maybeSingle()
        const agreement_id = agr?.id ?? null

        const chunksQuery = agreement_id
            ? supabase.from("knowledge_chunks").delete().eq("agreement_id", agreement_id).eq("gyldig_fra", gyldigFra)
            : supabase.from("knowledge_chunks").delete().eq("overenskomst", overenskomst).eq("gyldig_fra", gyldigFra)

        const [chunksRes, uploadsRes] = await Promise.all([
            chunksQuery,
            supabase.from("overenskomst_uploads")
                .delete()
                .eq("org_id", auth.orgId)
                .eq("overenskomst", overenskomst)
                .eq("gyldig_fra", gyldigFra),
        ])

        if (chunksRes.error || uploadsRes.error) {
            console.error("[overenskomst] delete failed", { chunks: chunksRes.error?.code, uploads: uploadsRes.error?.code })
            return NextResponse.json({ error: "Overenskomstversionen kunne ikke slettes." }, { status: 500 })
        }
        return NextResponse.json({ ok: true })
    } catch (e: unknown) {
        console.error("[overenskomst] delete failed", e instanceof Error ? e.name : "unknown")
        return NextResponse.json({ error: "Overenskomstversionen kunne ikke slettes." }, { status: 500 })
    }
}

// ── GET /api/admin/overenskomst — hent alle versioner ────────

export async function GET() {
    const auth = await requireStaffModuleApi("contract_reviews", "read")
    if (!auth.ok) return auth.response
    const supabase = sb()

    // Hent alle versioner (aktive + arkiverede) — inkl. agreement_id for korrekt gruppering
    let chunksQuery = supabase
        .from("knowledge_chunks")
        .select("overenskomst, agreement_id, kategori, kilde_id, aktiv, gyldig_fra")
        .not("overenskomst", "is", null)
        .neq("kategori", "fuldt-dokument")
        .order("gyldig_fra", { ascending: false })
    let agreementsQuery = supabase
        .from("agreements")
        .select("id,code,title,parties,production_types,profession_roles,employment_forms,content_url,source_url,status,valid_from,valid_to,notes,agreement_pension_rules(id,employment_form,employer_percent,employee_percent,basis,scheme_kind,valid_from,valid_to,section_reference,source_note,status),agreement_wage_rules(id,profession_role,wage_group,employment_form,rate_kind,amount,currency,unit,pension_included,valid_from,valid_to,source_title,source_url,source_section,source_checked_at,source_note,status)")
        .not("code", "is", null)
        .order("title")
    if (!auth.global) {
        chunksQuery = chunksQuery.or(`org_id.is.null,org_id.eq.${auth.orgId}`)
        agreementsQuery = agreementsQuery.or(`org_id.is.null,org_id.eq.${auth.orgId}`)
    }
    const [{ data: chunks }, { data: agreementRegistry, error: registryError }] = await Promise.all([chunksQuery, agreementsQuery])

    // Byg id → code-map fra agreements så vi kan nøgle versioner på agreement.code
    const agreementCodeById = new Map<string, string>((agreementRegistry ?? []).map(a => [a.id, a.code]))

    const BILAG_KATEGORIER = ["lønskema", "lønskema-satser", "standardkontrakt-aloen", "standardkontrakt-leverandoer", "bilag"]

    // Gruppér per agreement.code (foretrukket) eller overenskomst-streng (legacy) + gyldig_fra
    type Version = { kategorier: string[]; bilag: string[]; antal: number; aktiv: boolean; gyldig_fra: string }
    const versioner: Record<string, Version[]> = {}

    for (const c of chunks ?? []) {
        if (!c.gyldig_fra) continue
        // Brug agreement.code hvis chunk er koblet, ellers falder tilbage til overenskomst-strengen
        const nøgle = (c.agreement_id && agreementCodeById.get(c.agreement_id)) ?? c.overenskomst
        if (!nøgle) continue
        if (!versioner[nøgle]) versioner[nøgle] = []
        let ver = versioner[nøgle].find(v => v.gyldig_fra === c.gyldig_fra)
        if (!ver) {
            ver = { kategorier: [], bilag: [], antal: 0, aktiv: !!c.aktiv, gyldig_fra: c.gyldig_fra }
            versioner[nøgle].push(ver)
        }
        ver.antal++
        if (c.kategori) {
            if (BILAG_KATEGORIER.includes(c.kategori)) {
                if (!ver.bilag.includes(c.kategori)) ver.bilag.push(c.kategori)
            } else {
                if (!ver.kategorier.includes(c.kategori)) ver.kategorier.push(c.kategori)
            }
        }
    }

    // Saml alle unikke kategorinavne (til autocomplete i UI)
    const alleKategorier = [...new Set(
        (chunks ?? [])
            .map(c => c.kategori)
            .filter((k): k is string => !!k && k !== "fuldt-dokument" && !BILAG_KATEGORIER.includes(k))
    )].sort()

    if (registryError) console.error("[overenskomst] registry read failed", registryError.code)
    return NextResponse.json({ versioner, agreementRegistry: registryError ? [] : agreementRegistry ?? [], registryError: registryError ? "Registeret kunne ikke hentes." : null, kategorier: alleKategorier })
}
