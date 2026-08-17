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
        const runtime = await getAiRuntimeConfig("contract_advice")
        const rawText = await callAi({
            provider: runtime.provider,
            model: runtime.model,
            maxTokens: 4000,
            responseJson: true,
            promptCaching: runtime.promptCachingEnabled,
            system: `Du er ekspert i danske filmoverenskomster.
Analyser det uploadede dokument og find disse specifikke sektioner:
- Helligdagsbetaling (sats i % eller kr)
- BETA-fond (bidragssats)
- Copydan-forbehold (tekst om rettigheder)
- Streaming-forbehold / SVOD (tekst om streamingrettigheder og Create Denmark)
- Royalty (sats og beregningsgrundlag)
- Pension (bidragssats)
- Opsigelse (varsler for begge parter)

For hver sektion: udtræk den præcise tekst fra dokumentet og angiv din tillid (høj/lav).
Høj tillid: sektionen er eksplicit og tydelig. Lav tillid: sektionen er uklar, mangler eller er implicit.

Returner KUN valid JSON uden markdown:
{
  "sektioner": [
    {
      "titel": "Helligdagsbetaling",
      "tekst": "præcis tekst fra dokumentet",
      "kategori": "helligdagsbetaling",
      "tillid": "høj",
      "sats": "1%"
    }
  ]
}

Kategorier: helligdagsbetaling, beta-fond, copydan-forbehold, streaming-forbehold, royalty, pension, opsigelse, andet`,
            userMessage: `Analysér denne ${String(overenskomst).slice(0, 120)}-overenskomst gyldig fra ${String(gyldigFra).slice(0, 20)} og find alle relevante sektioner.\n\n${maskPersonalData(pdfTekst).slice(0, 180_000)}`,
        })
        const firstBrace = rawText.indexOf("{")
        const lastBrace = rawText.lastIndexOf("}")
        if (firstBrace === -1 || lastBrace === -1) {
            return NextResponse.json({ error: "AI-modellen returnerede et ugyldigt svar." }, { status: 502 })
        }
        const parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1))
        // Returner sektioner + fuld tekst til klienten
        return NextResponse.json({ ...parsed, pdfTekst })
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

        // Deaktivér gamle chunks for denne overenskomst
        await supabase.from("knowledge_chunks").update({ aktiv: false }).eq("org_id", auth.orgId).eq("overenskomst", overenskomst)

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
        const { error } = await supabase
            .from("knowledge_chunks")
            .update({ aktiv })
            .eq("org_id", auth.orgId)
            .eq("overenskomst", overenskomst)
            .eq("gyldig_fra", gyldigFra)
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

        const [chunksRes, uploadsRes] = await Promise.all([
            supabase.from("knowledge_chunks")
                .delete()
                .eq("org_id", auth.orgId)
                .eq("overenskomst", overenskomst)
                .eq("gyldig_fra", gyldigFra),
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

    // Hent alle versioner (aktive + arkiverede)
    let chunksQuery = supabase
        .from("knowledge_chunks")
        .select("overenskomst, kategori, kilde_id, aktiv, gyldig_fra")
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

    const BILAG_KATEGORIER = ["lønskema", "lønskema-satser", "standardkontrakt-aloen", "standardkontrakt-leverandoer", "bilag"]

    // Gruppér per overenskomst + gyldig_fra (en version = én kombination)
    type Version = { kategorier: string[]; bilag: string[]; antal: number; aktiv: boolean; gyldig_fra: string }
    const versioner: Record<string, Version[]> = {}

    for (const c of chunks ?? []) {
        if (!c.overenskomst || !c.gyldig_fra) continue
        if (!versioner[c.overenskomst]) versioner[c.overenskomst] = []
        let ver = versioner[c.overenskomst].find(v => v.gyldig_fra === c.gyldig_fra)
        if (!ver) {
            ver = { kategorier: [], bilag: [], antal: 0, aktiv: !!c.aktiv, gyldig_fra: c.gyldig_fra }
            versioner[c.overenskomst].push(ver)
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

    if (registryError) console.error("[overenskomst] registry read failed", registryError.code)
    return NextResponse.json({ versioner, agreementRegistry: registryError ? [] : agreementRegistry ?? [], registryError: registryError ? "Registeret kunne ikke hentes." : null })
}
