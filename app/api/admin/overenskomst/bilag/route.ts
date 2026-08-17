/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getEmbedding } from "@/lib/embedding-provider"
import { extractPdfText } from "@/lib/pdf-parse"
import { requireStaffModuleApi } from "@/lib/api-auth"
import { extractWordText } from "@/lib/word-text"

function sb() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

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

// ── POST — udtræk lønskema-satser med Claude ─────────────────

async function udtraekLønskema(pdfBase64: string, overenskomst: string, gyldigFra: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY mangler")

    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
            model: "claude-opus-4-5",
            max_tokens: 2000,
            system: `Du er ekspert i danske filmoverenskomster og lønskemaer.
Udtræk ALLE satser fra lønskemaet og returner KUN valid JSON:
{
  "normalløn_uge": number eller null,
  "normalløn_dag": number eller null,
  "pension_procent": number eller null,
  "helligdag_procent": number eller null,
  "beta_procent": number eller null,
  "ferie_procent": number eller null,
  "overtid_procent": number eller null,
  "satser": [
    { "betegnelse": "string", "beloeb": number, "enhed": "kr/uge|kr/dag|kr/time|%" }
  ],
  "noter": "eventuelle noter om satserne"
}`,
            messages: [{
                role: "user",
                content: [
                    { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
                    { type: "text", text: `Udtræk alle lønsatser fra dette ${overenskomst}-lønskema gyldig fra ${gyldigFra}.` },
                ],
            }],
        }),
    })
    if (!res.ok) throw new Error(`Claude fejl: ${res.status}`)
    const data = await res.json()
    const raw = data.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") ?? ""
    const first = raw.indexOf("{"); const last = raw.lastIndexOf("}")
    if (first === -1) return null
    return JSON.parse(raw.slice(first, last + 1))
}

// ── POST /api/admin/overenskomst/bilag — indeksér bilag ───────

export async function POST(req: NextRequest) {
    try {
        const auth = await requireStaffModuleApi("contract_reviews", "write")
        if (!auth.ok) return auth.response
        const { pdfBase64, pdfTekst, overenskomst, gyldigFra, bilagType, filnavn } = await req.json()
        if (!pdfTekst || !overenskomst || !gyldigFra || !bilagType) {
            return NextResponse.json({ error: "pdfTekst, overenskomst, gyldigFra og bilagType er påkrævet" }, { status: 400 })
        }
        if ((typeof pdfBase64 === "string" && pdfBase64.length > 35_000_000) || String(pdfTekst).length > 500_000) {
            return NextResponse.json({ error: "Bilaget er for stort." }, { status: 413 })
        }

        const supabase = sb()
        let indekseret = 0
        let lønskemaSatser = null

        // Udtræk tekst server-side baseret på filtype
        let faktiskPdfTekst = pdfTekst
        const fn = filnavn?.toLowerCase() ?? ""
        const erWord = fn.endsWith(".docx") || fn.endsWith(".doc")
        if (pdfBase64 && (!faktiskPdfTekst || faktiskPdfTekst.length < 100)) {
            try {
                const buf = Buffer.from(pdfBase64, "base64")
                if (erWord) {
                    faktiskPdfTekst = await extractWordText(buf, filnavn)
                } else {
                    faktiskPdfTekst = await extractPdfText(buf)
                }
            } catch (e) {
                console.warn("[bilag] Tekst-udtræk fejlede:", e)
            }
        }

        // Lønskema: udtræk strukturerede satser med Claude (kun PDF — DOCX kan ikke sendes som document-blok)
        if (bilagType === "lønskema" && pdfBase64 && !erWord) {
            try {
                lønskemaSatser = await udtraekLønskema(pdfBase64, overenskomst, gyldigFra)
            } catch (e) {
                console.warn("[bilag] Lønskema-udtræk fejlede:", e)
            }
        }

        // Chunk dokumentet
        const prefix = `${overenskomst} ${bilagType} ${gyldigFra}: `
        const chunks = chunkDokument(faktiskPdfTekst, { størrelse: 400, overlap: 40, prefix })

        for (let i = 0; i < chunks.length; i++) {
            const kilde_id = `${auth.orgId}:${sourcePart(overenskomst)}-${sourcePart(bilagType)}-${gyldigFra}-${i}`
            const embedding = await getEmbedding(chunks[i], true)

            await supabase.from("knowledge_chunks").upsert({
                org_id: auth.orgId,
                kilde_id,
                kilde_type: "overenskomst-bilag",
                kilde_titel: `${overenskomst} — ${BILAG_LABELS[bilagType] ?? bilagType} (${i + 1}/${chunks.length})`,
                tekst: chunks[i],
                metadata: {
                    overenskomst,
                    gyldig_fra: gyldigFra,
                    bilag_type: bilagType,
                    filnavn,
                    ...(lønskemaSatser && i === 0 ? { satser: lønskemaSatser } : {}),
                },
                embedding,
                overenskomst: overenskomst.toLowerCase(),
                kategori: bilagType,
                gyldig_fra: gyldigFra,
                aktiv: true,
                sidst_opdateret: new Date().toISOString(),
            }, { onConflict: "kilde_id" })

            indekseret++
            await new Promise(r => setTimeout(r, 100))
        }

        // Hvis lønskema: gem også som ét samlet chunk med alle satser
        if (lønskemaSatser) {
            const satsChunk = `${overenskomst} lønskema satser ${gyldigFra}: ${JSON.stringify(lønskemaSatser)}`
            const embedding = await getEmbedding(satsChunk, true)
            await supabase.from("knowledge_chunks").upsert({
                org_id: auth.orgId,
                kilde_id: `${auth.orgId}:${sourcePart(overenskomst)}-loenskema-satser-${gyldigFra}`,
                kilde_type: "overenskomst-bilag",
                kilde_titel: `${overenskomst} — Lønskema satser`,
                tekst: satsChunk,
                metadata: { overenskomst, gyldig_fra: gyldigFra, bilag_type: "lønskema", satser: lønskemaSatser },
                embedding,
                overenskomst: overenskomst.toLowerCase(),
                kategori: "lønskema-satser",
                gyldig_fra: gyldigFra,
                aktiv: true,
                sidst_opdateret: new Date().toISOString(),
            }, { onConflict: "kilde_id" })
            indekseret++
        }

        return NextResponse.json({ ok: true, indekseret, lønskemaSatser })
    } catch (e: unknown) {
        console.error("[overenskomst-bilag] indexing failed", e instanceof Error ? e.name : "unknown")
        return NextResponse.json({ error: "Bilaget kunne ikke gemmes." }, { status: 500 })
    }
}

const BILAG_LABELS: Record<string, string> = {
    "lønskema": "Lønskema",
    "standardkontrakt-aloen": "Standardkontrakt (A-løn)",
    "standardkontrakt-leverandoer": "Standardkontrakt (leverandør)",
    "bilag": "Bilag",
}

// ── GET — hent bilag for en overenskomst ──────────────────────

export async function GET(req: NextRequest) {
    const auth = await requireStaffModuleApi("contract_reviews", "read")
    if (!auth.ok) return auth.response
    const { searchParams } = new URL(req.url)
    const overenskomst = searchParams.get("overenskomst")
    const gyldigFra = searchParams.get("gyldigFra")
    if (!overenskomst || !gyldigFra) return NextResponse.json({ bilag: [] })

    const supabase = sb()
    const { data, error } = await supabase
        .from("knowledge_chunks")
        .select("kategori, kilde_id, metadata, aktiv")
        .or(`org_id.is.null,org_id.eq.${auth.orgId}`)
        .eq("overenskomst", overenskomst)
        .eq("gyldig_fra", gyldigFra)
        .in("kategori", ["lønskema", "lønskema-satser", "standardkontrakt-aloen", "standardkontrakt-leverandoer", "bilag"])
        .order("kilde_id")
    if (error) {
        console.error("[overenskomst-bilag] read failed", error.code)
        return NextResponse.json({ error: "Bilagene kunne ikke hentes." }, { status: 500 })
    }

    // Gruppér per bilag-type
    const bilag: Record<string, { type: string; antal: number; satser?: any }> = {}
    for (const c of data ?? []) {
        const type = c.kategori!
        if (!bilag[type]) bilag[type] = { type, antal: 0 }
        bilag[type].antal++
        if (type === "lønskema-satser" && (c.metadata as any)?.satser) {
            bilag[type].satser = (c.metadata as any).satser
        }
    }

    return NextResponse.json({ bilag: Object.values(bilag) })
}
