import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getEmbedding } from "@/lib/embedding-provider"
import { extractPdfText } from "@/lib/pdf-parse"
import { requireAdminApi } from "@/lib/api-auth"

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

        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
                model: "claude-opus-4-5",
                max_tokens: 4000,
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
                messages: [{
                    role: "user",
                    content: [
                        {
                            type: "document",
                            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
                        },
                        { type: "text", text: `Analysér denne ${overenskomst}-overenskomst gyldig fra ${gyldigFra} og find alle relevante sektioner.` },
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
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
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

        // Deaktivér gamle chunks for denne overenskomst
        await supabase.from("knowledge_chunks").update({ aktiv: false }).eq("overenskomst", overenskomst)

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
                    kategori: sektion.kategori,
                    gyldig_fra: gyldigFra,
                    aktiv: true,
                    sidst_opdateret: new Date().toISOString(),
                }, { onConflict: "kilde_id" })

                indekseret++
                await new Promise(r => setTimeout(r, 100))
            } catch (e: any) {
                fejl.push(`${sektion.kategori}: ${e.message}`)
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
                        kategori: "fuldt-dokument",
                        gyldig_fra: gyldigFra,
                        aktiv: true,
                        sidst_opdateret: new Date().toISOString(),
                    }, { onConflict: "kilde_id" })

                    fuldeChunks++
                    await new Promise(r => setTimeout(r, 100))
                } catch (e: any) {
                    fejl.push(`chunk ${i}: ${e.message}`)
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
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

// ── PATCH /api/admin/overenskomst — arkivér/genaktivér ───────

export async function PATCH(req: NextRequest) {
    try {
        const auth = await requireAdminApi()
        if (!auth.ok) return auth.response
        const { overenskomst, gyldigFra, aktiv } = await req.json()
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
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
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
        return NextResponse.json({ ok: true })
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

// ── GET /api/admin/overenskomst — hent alle versioner ────────

export async function GET() {
    const auth = await requireAdminApi()
    if (!auth.ok) return auth.response
    const supabase = sb()

    // Hent alle versioner (aktive + arkiverede)
    const { data: chunks } = await supabase
        .from("knowledge_chunks")
        .select("overenskomst, kategori, kilde_id, aktiv, gyldig_fra")
        .not("overenskomst", "is", null)
        .neq("kategori", "fuldt-dokument")
        .order("gyldig_fra", { ascending: false })

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

    return NextResponse.json({ versioner })
}
