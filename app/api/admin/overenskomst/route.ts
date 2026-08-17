/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
import { errorMessage } from "@/lib/error-message";
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getEmbedding } from "@/lib/embedding-provider"
import { extractPdfText } from "@/lib/pdf-parse"
import { requireAdminApi } from "@/lib/api-auth"
import { recordAuditEvent } from "@/lib/audit-log-server"

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

// ── POST /api/admin/overenskomst — analysér PDF med Claude ───

export async function POST(req: NextRequest) {
    try {
        const auth = await requireAdminApi()
        if (!auth.ok) return auth.response
        const { pdfBase64, overenskomst, gyldigFra } = await req.json()
        if (!pdfBase64 || !overenskomst || !gyldigFra) {
            return NextResponse.json({ error: "pdfBase64, overenskomst og gyldigFra er påkrævet" }, { status: 400 })
        }

        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY mangler" }, { status: 500 })

        // Hent eksisterende kategorinavne fra DB — bruges som vejledning til AI'en
        const supabaseForKategorier = sb()
        let tidligereKategorier: string[] = []
        try {
            const { data: katRows } = await supabaseForKategorier
                .from("knowledge_chunks")
                .select("kategori")
                .not("kategori", "is", null)
                .neq("kategori", "fuldt-dokument")
            tidligereKategorier = [...new Set((katRows ?? []).map(r => r.kategori as string))].sort()
        } catch { /* ingen kategorier tilgængelige */ }

        const kategorikontekst = tidligereKategorier.length > 0
            ? `\n\nAllerede brugte kategorinavne på tværs af indekserede overenskomster: ${tidligereKategorier.map(k => `"${k}"`).join(", ")}. Brug et af disse navne hvis afsnittet reelt svarer til en allerede brugt kategori; ellers foreslå et nyt præcist dansk navn.`
            : ""

        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
                model: "claude-opus-4-5",
                max_tokens: 4000,
                system: `Du er ekspert i danske overenskomster (film, TV, medie og lignende brancher).

Analyser det uploadede dokument og identificer de reelt betydningsfulde, indholdsmæssigt afgrænsede afsnit. Du bestemmer selv hvilke afsnit der er relevante — begræns dig ikke til en fast liste. Fokuser på afsnit med konkrete rettigheder, pligter, satser eller frister. Udelad rent administrative afsnit som "ikrafttræden", "underskrifter" og lignende, medmindre de indeholder noget indholdsmæssigt væsentligt.

Typiske typer af indhold der ofte er relevante: løn/honorar, pension, arbejdstid/overarbejde, ferie/orlov/barsel, ophavsrettigheder/rettigheder, opsigelse/varsler, fonde og bidragspuljer, tvistløsning — men dokumentet kan indeholde andet, og du skal finde hvad der faktisk er der.

For hvert afsnit:
- Udtræk den præcise tekst fra dokumentet
- Giv afsnittet en kort, præcis dansk kategori-betegnelse der beskriver hvad det handler om (fx "pension", "barsel", "arbejdstid", "ophavsret", "opsigelse")
- Angiv din tillid: høj hvis afsnittet er eksplicit og tydelig, lav hvis uklart eller implicit
- Angiv eventuelt en sats hvis der er en konkret procentsats eller beløb${kategorikontekst}

Returner KUN valid JSON uden markdown:
{
  "sektioner": [
    {
      "titel": "Afsnittets overskrift fra dokumentet",
      "tekst": "præcis tekst fra dokumentet",
      "kategori": "pension",
      "tillid": "høj",
      "sats": "9 %"
    }
  ]
}`,
                messages: [{
                    role: "user",
                    content: [
                        {
                            type: "document",
                            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
                        },
                        { type: "text", text: `Analysér denne overenskomst (${overenskomst}, gyldig fra ${gyldigFra}) og identificer alle indholdsmæssigt relevante afsnit.` },
                    ],
                }],
            }),
        })

        if (!response.ok) {
            const err = await response.text()
            return NextResponse.json({ error: `Claude fejl: ${err}` }, { status: 500 })
        }

        // Udtræk fuld PDF-tekst parallelt med Claude-svaret
        let pdfTekst = ""
        try {
            const buf = Buffer.from(pdfBase64, "base64")
            pdfTekst = await extractPdfText(buf)
        } catch { /* ingen fuldt-dokument chunking */ }

        const data = await response.json()
        const rawText = data.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") ?? ""
        const firstBrace = rawText.indexOf("{")
        const lastBrace = rawText.lastIndexOf("}")
        if (firstBrace === -1 || lastBrace === -1) {
            return NextResponse.json({ error: "Ugyldigt svar fra Claude" }, { status: 500 })
        }
        const parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1))
        // Returner sektioner + fuld tekst til klienten
        return NextResponse.json({ ...parsed, pdfTekst })
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
    }
}

// ── PUT /api/admin/overenskomst — indeksér godkendte sektioner ─

export async function PUT(req: NextRequest) {
    try {
        const auth = await requireAdminApi()
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
            await supabase.from("knowledge_chunks").update({ aktiv: false }).eq("agreement_id", agreement_id)
        } else {
            await supabase.from("knowledge_chunks").update({ aktiv: false }).eq("overenskomst", overenskomst)
        }

        let indekseret = 0
        const fejl: string[] = []

        // LAG 1: Kategoriserede sektioner
        for (const sektion of sektioner) {
            try {
                const kilde_id = `${overenskomst.toLowerCase()}-${sektion.kategori}-${gyldigFra}`
                const tekstTilEmbedding = `${sektion.titel}: ${sektion.tekst}`
                const embedding = await getEmbedding(tekstTilEmbedding, true)

                await supabase.from("knowledge_chunks").upsert({
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
                fejl.push(`${sektion.kategori}: ${errorMessage(e)}`)
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
                    const kilde_id = `${overenskomst.toLowerCase()}-fuldt-${gyldigFra}-${i}`
                    const embedding = await getEmbedding(chunks[i], true)

                    await supabase.from("knowledge_chunks").upsert({
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
                    fejl.push(`chunk ${i}: ${errorMessage(e)}`)
                }
            }
        }

        // Gem upload-tracking
        await supabase.from("overenskomst_uploads").insert({
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
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
    }
}

// ── PATCH /api/admin/overenskomst — arkivér/genaktivér ───────

export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json()
        if (body.agreementId) {
            const auth = await requireAdminApi(["superadmin", "jurist"])
            if (!auth.ok) return auth.response
            const status = body.status
            if (!['draft', 'approved', 'archived'].includes(status)) {
                return NextResponse.json({ error: "Ugyldig status" }, { status: 400 })
            }
            const supabase = sb()
            const { data: before, error: beforeError } = await supabase
                .from("agreements")
                .select("id,title,status")
                .eq("id", body.agreementId)
                .maybeSingle()
            if (beforeError || !before) return NextResponse.json({ error: "Overenskomsten blev ikke fundet" }, { status: 404 })
            const approval = status === "approved" ? { approved_by: auth.userId, approved_at: new Date().toISOString() } : { approved_by: null, approved_at: null }
            const { error } = await supabase.from("agreements").update({ status, ...approval, updated_at: new Date().toISOString() }).eq("id", body.agreementId)
            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
        const auth = await requireAdminApi()
        if (!auth.ok) return auth.response
        const { overenskomst, gyldigFra, aktiv } = body
        if (!overenskomst || !gyldigFra) {
            return NextResponse.json({ error: "overenskomst og gyldigFra er påkrævet" }, { status: 400 })
        }
        const supabase = sb()
        const { error } = await supabase
            .from("knowledge_chunks")
            .update({ aktiv })
            .eq("overenskomst", overenskomst)
            .eq("gyldig_fra", gyldigFra)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true })
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
    }
}

// ── DELETE /api/admin/overenskomst — slet version ────────────

export async function DELETE(req: NextRequest) {
    try {
        const auth = await requireAdminApi()
        if (!auth.ok) return auth.response
        const { overenskomst, gyldigFra } = await req.json()
        if (!overenskomst || !gyldigFra) {
            return NextResponse.json({ error: "overenskomst og gyldigFra er påkrævet" }, { status: 400 })
        }
        const supabase = sb()

        const [chunksRes, uploadsRes] = await Promise.all([
            supabase.from("knowledge_chunks")
                .delete()
                .eq("overenskomst", overenskomst)
                .eq("gyldig_fra", gyldigFra),
            supabase.from("overenskomst_uploads")
                .delete()
                .eq("overenskomst", overenskomst)
                .eq("gyldig_fra", gyldigFra),
        ])

        if (chunksRes.error) return NextResponse.json({ error: chunksRes.error.message }, { status: 500 })
        if (uploadsRes.error) return NextResponse.json({ error: uploadsRes.error.message }, { status: 500 })
        return NextResponse.json({ ok: true })
    } catch (e: unknown) {
        return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
    }
}

// ── GET /api/admin/overenskomst — hent alle versioner ────────

export async function GET() {
    const auth = await requireAdminApi()
    if (!auth.ok) return auth.response
    const supabase = sb()

    // Hent alle versioner (aktive + arkiverede) — inkl. agreement_id for korrekt gruppering
    const [{ data: chunks }, { data: agreementRegistry, error: registryError }] = await Promise.all([
      supabase
        .from("knowledge_chunks")
        .select("overenskomst, agreement_id, kategori, kilde_id, aktiv, gyldig_fra")
        .not("overenskomst", "is", null)
        .neq("kategori", "fuldt-dokument")
        .order("gyldig_fra", { ascending: false }),
      supabase
        .from("agreements")
        .select("id,code,title,parties,production_types,profession_roles,employment_forms,content_url,source_url,status,valid_from,valid_to,notes,agreement_pension_rules(id,employment_form,employer_percent,employee_percent,basis,scheme_kind,valid_from,valid_to,section_reference,source_note,status),agreement_wage_rules(id,profession_role,wage_group,employment_form,rate_kind,amount,currency,unit,pension_included,valid_from,valid_to,source_title,source_url,source_section,source_checked_at,source_note,status)")
        .not("code", "is", null)
        .order("title"),
    ])

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

    return NextResponse.json({ versioner, agreementRegistry: registryError ? [] : agreementRegistry ?? [], registryError: registryError?.message ?? null, kategorier: alleKategorier })
}
