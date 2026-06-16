/**
 * lib/analyse.ts
 *
 * Tre-trins AI-kontraktgennemgang:
 *   Trin 1 — Klassifikation (kontrakttype, overenskomst, sprog, lønform)
 *   Trin 2 — Compliance-udtræk (struktureret JSON, ingen prosa)
 *   Trin 3 — Mailgenerering (naturlig prosa fra stemme-eksempler)
 *
 * Adskillelse:
 *   Trin 2 afgør HVAD der juridisk mangler og markerer requires_gul.
 *   Trin 3 afgør HVORDAN det skrives — tone styres af {{VOICE_EXAMPLES}}.
 */

import mammoth from "mammoth"
import { extractPdfText } from "@/lib/pdf-parse"
import { callAi } from "@/lib/ai-client"
import { AI_CONFIG_DEFAULTS } from "@/lib/ai-providers"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { hentKontekst } from "@/lib/retrieval"
import { tjekNavn } from "@/lib/rettighedshaver-tjek"
import { FEW_SHOT_EXAMPLES, TONE_REGLER } from "@/lib/few-shot-examples"
import { COMPLIANCE_EXTRACT_PROMPT } from "@/lib/compliance-extract-prompt"
import { MAIL_GENERATION_PROMPT } from "@/lib/mail-generation-prompt"
import { VOICE_EXAMPLES_DEFAULT } from "@/lib/voice-examples"
import type { ComplianceExtract, CompliancePoint } from "@/lib/compliance-types"

// ── Sensitiv data-maskning ────────────────────────────────────

export function maskSensitiveData(text: string): string {
    text = text.replace(/\b(\d{6})-?(\d{4})\b/g, (match, p1) => {
        const day = parseInt(p1.slice(0, 2))
        const month = parseInt(p1.slice(2, 4))
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return `${p1}-****`
        return match
    })
    text = text.replace(/\b(\d{4})[\s-](\d{6,10})\b/g, (match, reg) => {
        const regNum = parseInt(reg)
        if (regNum >= 1000 && regNum <= 9999) return `${reg} ****`
        return match
    })
    text = text.replace(/\bDK\d{2}[\s]?(\d{4}[\s]?){3}\d{2}\b/gi, "DK** **** **** **** **")
    text = text.replace(/\b([2-9]\d{7})\b/g, (match) => `${match.slice(0, 2)}** ****`)
    text = text.replace(
        /\b(\p{L}+(?:vej|gade|alle|plads|stræde|vænge|have|park|toft|sti|bro)\s+)(\d+[A-Za-z]?(?:,\s*\d+\.?\s*(?:tv|th|mf)?)?)/giu,
        (match, street) => `${street}[NR. MASKERET]`
    )
    return text
}

async function extractDocxText(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
}

// ── Fælles Anthropic API-kald ─────────────────────────────────

async function callAnthropic(params: {
    apiKey: string
    model: string
    system: string
    messageContent: any[]
    maxTokens?: number
    logTag?: string
}): Promise<string> {
    const { apiKey, model, system, messageContent, maxTokens = 8000, logTag = "analyse" } = params
    const ALLOWED = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"]
    const safeModel = ALLOWED.includes(model) ? model : AI_CONFIG_DEFAULTS.kontrakt.model

    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: safeModel,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content: messageContent }],
        }),
    })

    if (!response.ok) {
        const err = await response.text()
        console.error(`[${logTag}] Anthropic error:`, err)
        throw new Error(`Claude API fejl ${response.status}`)
    }

    const data = await response.json()
    return data.content?.find((b: { type: string; text?: string }) => b.type === "text")?.text ?? ""
}

const GUL_SPAN = `style="background-color:#fef08a"`

/**
 * Lægger <span style="background-color:#fef08a"> programmatisk omkring
 * proposed_text_da i den genererede mailtekst.
 *
 * Span-tagget preserverer gul baggrund når teksten kopieres ind i
 * Gmail compose via ClipboardItem (text/html). Mere robust end at
 * bede modellen indsætte markup selv.
 *
 * Logger advarsel hvis proposed_text ikke findes (no-paraphrase brudt).
 */
export function applyGulTokens(mailText: string, points: CompliancePoint[]): string {
    let result = mailText
    for (const point of points) {
        if (!point.requires_producer_text) continue
        const rawText = point.proposed_text_da?.trim()
        if (!rawText) continue

        const wrap = (inner: string) =>
            `<span ${GUL_SPAN}>${inner}</span>`

        // Forsøg 1: med anførselstegn (foretrukket — model bør cite ordret)
        const withQuotes = `"${rawText}"`
        let idx = result.indexOf(withQuotes)
        if (idx !== -1) {
            result = result.slice(0, idx) + wrap(withQuotes) + result.slice(idx + withQuotes.length)
            continue
        }

        // Forsøg 2: uden anførselstegn
        idx = result.indexOf(rawText)
        if (idx !== -1) {
            result = result.slice(0, idx) + wrap(rawText) + result.slice(idx + rawText.length)
            continue
        }

        console.warn(`[gul] proposed_text for '${point.point_id}' ikke fundet — no-paraphrase muligvis brudt`)
    }
    return result
}

function parseJson(raw: string, logTag: string): any {
    const clean = raw
        .replace(/^\s*```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim()

    try {
        return JSON.parse(clean)
    } catch {
        const first = clean.indexOf("{")
        const last = clean.lastIndexOf("}")
        if (first !== -1 && last !== -1) {
            try { return JSON.parse(clean.slice(first, last + 1)) } catch { /* falder igennem */ }
        }
        console.error(`[${logTag}] JSON parse failed, raw length:`, raw.length)
        throw new Error("AI returnerede ugyldigt JSON-svar — prøv igen")
    }
}

// ── Klassifikationstype ───────────────────────────────────────

export type Klassifikation = {
    kontrakttype: "a-loen" | "leverandoer" | "hybrid"
    er_overenskomst: boolean
    overenskomst_navn: string | null
    membres_fornavn: string
    membres_efternavn: string
    aftalt_loen: number | null
    loen_enhed: "kr/uge" | "kr/dag" | null
    producent_navn: string
    kontraktsprog: "da" | "en" | "other"
    loen_type: "ugeloeen" | "dagsloen" | "fast_total" | "ukendt"
    loen_valuta: "DKK" | "USD" | "EUR" | "GBP" | "other"
    produktionstype: "spillefilm" | "tvserie" | "dokumentar" | "kortfilm" | "ukendt"
}

// ── Trin 1: Klassificér ───────────────────────────────────────

async function klassificerKontrakt(
    kontraktTekst: string,
    apiKey: string,
    model: string
): Promise<Klassifikation> {
    const defaultKlassifikation: Klassifikation = {
        kontrakttype: "hybrid", er_overenskomst: false, overenskomst_navn: null,
        membres_fornavn: "", membres_efternavn: "", aftalt_loen: null, loen_enhed: null,
        producent_navn: "", kontraktsprog: "da", loen_type: "ukendt",
        loen_valuta: "DKK", produktionstype: "ukendt",
    }

    try {
        const raw = await callAnthropic({
            apiKey, model,
            system: `Du klassificerer danske filmkontrakter.
Returnér KUN valid JSON — ingen tekst før eller efter.
Brug null hvis et felt ikke kan bestemmes.`,
            messageContent: [{
                role: "user",
                content: `Klassificér denne kontrakt:\n\n${kontraktTekst.slice(0, 4000)}

Returnér JSON med disse felter:
{
  "kontrakttype": "a-loen" ELLER "leverandoer" ELLER "hybrid",
  "er_overenskomst": true/false,
  "overenskomst_navn": "de4-fiktion" ELLER "faf-dok" ELLER null,
  "membres_fornavn": "fornavn",
  "membres_efternavn": "efternavn",
  "aftalt_loen": tal eller null,
  "loen_enhed": "kr/uge" ELLER "kr/dag" eller null,
  "producent_navn": "navn",
  "kontraktsprog": "da" ELLER "en" ELLER "other",
  "loen_type": "ugeloeen" ELLER "dagsloen" ELLER "fast_total" ELLER "ukendt",
  "loen_valuta": "DKK" ELLER "USD" ELLER "EUR" ELLER "GBP" ELLER "other",
  "produktionstype": "spillefilm" ELLER "tvserie" ELLER "dokumentar" ELLER "kortfilm" ELLER "ukendt"
}`,
            }],
            maxTokens: 500,
            logTag: "klassifikation",
        })
        const p = parseJson(raw, "klassifikation")
        return {
            kontrakttype: p.kontrakttype ?? "hybrid",
            er_overenskomst: p.er_overenskomst ?? false,
            overenskomst_navn: p.overenskomst_navn ?? null,
            membres_fornavn: p.membres_fornavn ?? "",
            membres_efternavn: p.membres_efternavn ?? "",
            aftalt_loen: typeof p.aftalt_loen === "number" ? p.aftalt_loen : null,
            loen_enhed: p.loen_enhed ?? null,
            producent_navn: p.producent_navn ?? "",
            kontraktsprog: p.kontraktsprog ?? "da",
            loen_type: p.loen_type ?? "ukendt",
            loen_valuta: p.loen_valuta ?? "DKK",
            produktionstype: p.produktionstype ?? "ukendt",
        }
    } catch (e) {
        console.warn("[klassifikation] fejlede, bruger default:", e)
        return defaultKlassifikation
    }
}

// ── Byg faktablok fra klassifikation + satser ────────────────

function byggKontraktfakta(
    klassifikation: Klassifikation,
    satser: Array<{ beskrivelse: string; vaerdi: number | string; enhed: string }>
): string {
    const hent = (søgeord: string) =>
        satser.find(s => s.beskrivelse?.toLowerCase().includes(søgeord.toLowerCase()))

    const normallon  = hent("normalløn") ?? hent("normallon")
    const pension    = hent("pension")
    const beta       = hent("beta")
    const helligdag  = hent("helligdag")
    const feriepenge = hent("feriepenge")

    const satsLinje = (label: string, s: typeof normallon) =>
        s ? `${label}: ${s.vaerdi} ${s.enhed}` : `${label}: [ikke tilgængelig]`

    const loenInfo = klassifikation.aftalt_loen
        ? `${klassifikation.aftalt_loen} ${klassifikation.loen_enhed ?? "kr/uge"}`
        : "[ikke fundet]"

    return `KONTRAKTFAKTA:
Kontrakttype:        ${klassifikation.kontrakttype}
Overenskomstdækket:  ${klassifikation.er_overenskomst ? "JA" : "NEJ"}
Overenskomst:        ${klassifikation.overenskomst_navn ?? "ingen"}
Medlemmets navn:     ${klassifikation.membres_fornavn} ${klassifikation.membres_efternavn}
Aftalt løn:          ${loenInfo}
Løntype:             ${klassifikation.loen_type}
Valuta:              ${klassifikation.loen_valuta}
Producent:           ${klassifikation.producent_navn || "[ikke fundet]"}
Produktionstype:     ${klassifikation.produktionstype}
Kontraktsprog:       ${klassifikation.kontraktsprog}

AKTUELLE SATSER:
${satsLinje("Normalløn", normallon)}
${satsLinje("Pension", pension)}
${satsLinje("Feriepenge", feriepenge)}
${satsLinje("BETA-fond", beta)}
${satsLinje("Helligdagsbetaling", helligdag)}`
}

// ── Input/output typer ────────────────────────────────────────

export type AnalyseInput = {
    fileBuffer: Buffer
    fileName: string
    memberName?: string | null
    contractType?: string | null
    productionType?: string | null
    distributionChannels?: string[]
    producerName?: string | null
    producerOverenskomst?: string | null
    focusAreas?: string[]
    notes?: string | null
    orgId?: string | null
    memberId?: string | null
    memberEmail?: string | null
    existingReviewId?: string | null
    provider?: string
    model?: string
    voiceExamples?: string
}

export type AnalyseOutput = {
    result: any
    contractText: string
    klassifikation: Klassifikation | null
    compliance_extract: ComplianceExtract | null
    risk_level: "LAV" | "MELLEM" | "HØJ" | null
    should_escalate: boolean
}

// ── Kerneanalyse-funktion (tre trin) ─────────────────────────

export async function analyserKontrakt(input: AnalyseInput): Promise<AnalyseOutput> {
    const {
        fileBuffer, fileName, memberName, contractType, productionType,
        distributionChannels = [], producerName, producerOverenskomst,
        focusAreas = [], notes, orgId, provider = AI_CONFIG_DEFAULTS.kontrakt.provider,
        model = AI_CONFIG_DEFAULTS.kontrakt.model,
        voiceExamples = "",
    } = input

    const filename = fileName.toLowerCase()

    // ── Udtræk tekst ──────────────────────────────────────────
    let contractText = ""
    let returnText = ""

    if (filename.endsWith(".docx") || filename.endsWith(".doc")) {
        contractText = await extractDocxText(fileBuffer)
        if (!contractText.trim()) throw new Error("Ingen tekst fundet i DOCX-filen.")
        returnText = contractText.slice(0, 60000)
    } else if (filename.endsWith(".txt")) {
        contractText = fileBuffer.toString("utf-8")
        returnText = contractText.slice(0, 60000)
    } else if (filename.endsWith(".pdf")) {
        try { contractText = await extractPdfText(fileBuffer) } catch { /* base64 fallback */ }
        returnText = contractText.slice(0, 60000)
    } else {
        throw new Error("Ikke-understøttet filformat. Brug PDF, DOCX eller TXT.")
    }

    if (filename.endsWith(".pdf") && provider !== "anthropic") {
        throw new Error("PDF-analyse kræver Anthropic som AI-udbyder.")
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY er ikke konfigureret")

    // ── Kontekstblok ──────────────────────────────────────────
    const overenskomstStatus =
        producerOverenskomst === "true"  ? "Ja (registreret i DFKS-database)" :
        producerOverenskomst === "false" ? "Nej (registreret i DFKS-database)" :
        "Ukendt"

    const contextBlock = [
        contractType  && `KONTRAKTTYPE: ${contractType}`,
        productionType && `PRODUKTIONSTYPE: ${productionType}`,
        `DISTRIBUTIONSKANALER: ${distributionChannels.length ? distributionChannels.join(", ") : "ukendt"}`,
        producerName  && `PRODUCER: ${producerName}`,
        `PRODUCER OVERENSKOMSTBUNDET: ${overenskomstStatus}`,
        focusAreas.length && `FOKUSOMRÅDER: ${focusAreas.join(", ")}`,
        notes && `SÆRLIGE BEMÆRKNINGER: ${notes}`,
    ].filter(Boolean).join("\n")

    // ── DB-data ───────────────────────────────────────────────
    const supabase = await createClient()
    const { data: refDocs } = await supabase
        .from("reference_docs")
        .select("doc_subtype, file_name, title, content_text, owner")
        .eq("archived", false)
        .not("content_text", "is", null)

    // ── Trin 1: Klassifikation ────────────────────────────────
    let klassifikation: Klassifikation | null = null
    if (provider === "anthropic") {
        try {
            const tekstTilKlassifikation = contractText || (filename.endsWith(".pdf") ? "[PDF]" : "")
            klassifikation = await klassificerKontrakt(tekstTilKlassifikation, apiKey, model)
            console.log("[analyse] Klassifikation:", JSON.stringify({
                loen_type: klassifikation.loen_type, kontrakttype: klassifikation.kontrakttype,
                er_overenskomst: klassifikation.er_overenskomst,
            }))
        } catch (e) {
            console.warn("[analyse] Klassifikation fejlede:", e)
        }
    }

    // ── DB-satser ─────────────────────────────────────────────
    let dbSatser: Array<{ beskrivelse: string; vaerdi: number; enhed: string }> = []
    try {
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )
        const overenskomstNavn = klassifikation?.overenskomst_navn ?? "de4-fiktion"
        const normaliserNavn = (n: string) => {
            if (n === "de4" || n === "de4-fiktion") return "de4-fiktion"
            if (n === "faf-dokumentar" || n === "faf-dok") return "dokumentar"
            return n
        }
        const { data: satser } = await admin
            .from("overenskomst_satser").select()
            .eq("overenskomst", normaliserNavn(overenskomstNavn))
            .is("gyldig_til", null).order("kategori")
        dbSatser = satser ?? []
    } catch (e) {
        console.warn("[analyse] Sats-hentning fejlede:", e)
    }

    // ── Altid-noteringer ──────────────────────────────────────
    let altidNoteringer: Array<{ title: string; body: string }> = []
    try {
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
        const { data } = await admin.from("legal_notes").select("title, body")
            .eq("priority", "altid").eq("active", true)
        altidNoteringer = data ?? []
    } catch (e) {
        console.warn("[analyse] Altid-noteringer fejlede:", e)
    }

    // ── Godkendte eksempler ───────────────────────────────────
    let godkendteEksempler: any[] = []
    if (klassifikation) {
        try {
            const admin = createAdminClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!
            )
            const { data } = await admin.from("case_learnings")
                .select("kontrakttype, er_overenskomst, ai_analyse, feedbackmail, noter")
                .eq("kilde_type", "godkendt_eksempel")
                .eq("kontrakttype", klassifikation.kontrakttype)
                .eq("er_overenskomst", klassifikation.er_overenskomst)
                .order("created_at", { ascending: false }).limit(2)
            godkendteEksempler = data ?? []
        } catch (e) {
            console.warn("[analyse] Eksempel-hentning fejlede:", e)
        }
    }

    // ── RAG-kontekst ──────────────────────────────────────────
    let ragTekst = ""
    const ragInput = contractText.slice(0, 8000)
    if (ragInput.trim()) {
        try {
            const resolvedOrgId = orgId ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5"
            const kontekst = await hentKontekst(ragInput, resolvedOrgId)
            const dele: string[] = []
            if (kontekst.kategorier.length > 0)
                dele.push("OVERENSKOMST-SATSER:\n" + kontekst.kategorier.map(c =>
                    `${c.kilde_titel}: ${c.tekst}`).join("\n\n"))
            if (kontekst.overenskomstSemantisk.length > 0)
                dele.push("OVERENSKOMST-KONTEKST:\n" + kontekst.overenskomstSemantisk.map(c => c.tekst).join("\n\n"))
            if (kontekst.videnbase.length > 0)
                dele.push("LOVGRUNDLAG:\n" + kontekst.videnbase.map(r => `${r.kilde_titel}:\n${r.tekst}`).join("\n\n"))
            if (kontekst.mønstre.length > 0)
                dele.push("LÆRTE REGLER:\n" + kontekst.mønstre.map(r => `${r.titel}:\n${r.regel}`).join("\n\n"))
            ragTekst = dele.join("\n\n")
        } catch (e) {
            console.warn("[analyse] hentKontekst fejlede:", e)
        }
    }

    // ── Byg fælles kontekst til trin 2 og 3 ─────────────────
    const faktaBlok = klassifikation
        ? byggKontraktfakta(klassifikation, dbSatser)
        : dbSatser.length > 0
            ? "AKTUELLE SATSER:\n" + dbSatser.map(s => `${s.beskrivelse}: ${s.vaerdi} ${s.enhed}`).join("\n")
            : ""

    const notationBlok = altidNoteringer.length > 0
        ? "DFKS AKTIVE NOTERINGER:\n" + altidNoteringer.map(n => `${n.title}: ${n.body}`).join("\n\n")
        : ""

    const refDocBlok = refDocs?.length
        ? refDocs.filter(d => d.content_text).map(d =>
            `${d.doc_subtype ?? d.file_name ?? d.title}:\n${d.content_text}`
          ).join("\n\n")
        : ""

    const fællesKontekst = [faktaBlok, contextBlock, notationBlok, ragTekst, refDocBlok]
        .filter(Boolean).join("\n\n")

    // ── Trin 2: Compliance-udtræk ─────────────────────────────
    const maskedText = maskSensitiveData(contractText)
    const kontraktTilAnalyse = maskedText.slice(0, 45000)

    let complianceExtract: ComplianceExtract | null = null
    const complianceSystem = COMPLIANCE_EXTRACT_PROMPT + (fællesKontekst ? `\n\n${fællesKontekst}` : "")

    let messageContentForCompliance: any[]
    if (filename.endsWith(".pdf") && !contractText.trim()) {
        messageContentForCompliance = [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBuffer.toString("base64") } },
            { type: "text", text: `${memberName ? `Kontrakt for: ${memberName}\n\n` : ""}Udtræk compliance-data fra denne kontrakt. Returnér KUN JSON.` },
        ]
    } else {
        messageContentForCompliance = [{ type: "text", text: `${memberName ? `Kontrakt for: ${memberName}\n\n` : ""}Udtræk compliance-data fra denne kontrakt:\n\n${kontraktTilAnalyse}` }]
    }

    try {
        const rawCompliance = await callAnthropic({
            apiKey, model, system: complianceSystem,
            messageContent: messageContentForCompliance,
            maxTokens: 4000, logTag: "compliance",
        })
        complianceExtract = parseJson(rawCompliance, "compliance") as ComplianceExtract
        console.log("[analyse] Compliance:", JSON.stringify({
            risk_level: complianceExtract.risk_level,
            points: complianceExtract.points?.length,
            non_covered: complianceExtract.non_covered_pedagogical,
        }))
    } catch (e) {
        console.warn("[analyse] Compliance-udtræk fejlede, fortsætter uden:", e)
    }

    // ── Trin 3: Mailgenerering ────────────────────────────────
    // Stemme fra godkendte eksempler + voiceExamples
    const stemmeEksempler = [
        ...godkendteEksempler
            .filter(e => e.feedbackmail)
            .map(e => `EKSEMPEL (${e.kontrakttype}, overenskomst: ${e.er_overenskomst ? "ja" : "nej"}):\n${e.feedbackmail.slice(0, 1000)}`),
        voiceExamples,
    ].filter(Boolean).join("\n\n---\n\n")

    const mailSystem = MAIL_GENERATION_PROMPT
        .replace("{{VOICE_EXAMPLES}}", stemmeEksempler || FEW_SHOT_EXAMPLES + "\n\n" + TONE_REGLER)
        + (fællesKontekst ? `\n\n${fællesKontekst}` : "")

    const complianceJson = complianceExtract
        ? `COMPLIANCE-UDTRÆK (trin 2):\n${JSON.stringify(complianceExtract, null, 2)}`
        : ""

    let messageContentForMail: any[]
    if (filename.endsWith(".pdf") && !contractText.trim()) {
        messageContentForMail = [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBuffer.toString("base64") } },
            { type: "text", text: `${memberName ? `Kontrakt for: ${memberName}\n\n` : ""}${complianceJson}\n\nSkriv feedbackmailen baseret på compliance-udtræket. Returner KUN JSON.` },
        ]
    } else {
        messageContentForMail = [{
            type: "text",
            text: `${memberName ? `Kontrakt for: ${memberName}\n\n` : ""}${complianceJson}\n\nKONTRAKTTEKST (til reference):\n${kontraktTilAnalyse}\n\nSkriv feedbackmailen baseret på compliance-udtræket. Returner KUN JSON.`,
        }]
    }

    let raw: string
    if (provider === "anthropic") {
        raw = await callAnthropic({
            apiKey, model, system: mailSystem,
            messageContent: messageContentForMail,
            maxTokens: 16000, logTag: "mailgenerering",
        })
    } else {
        const textBlock = messageContentForMail.find((b: any) => b.type === "text")
        raw = await callAi({ provider, model, system: mailSystem, userMessage: textBlock?.text ?? "", maxTokens: 16000 })
    }

    let parsed: any
    try {
        parsed = parseJson(raw, "mailgenerering")
    } catch (e) {
        console.error("[analyse] Mailgenerering JSON parse failed:", e)
        throw new Error("AI returnerede ugyldigt svar — prøv igen")
    }

    // ── Navnetjek mod DFKS-register ──────────────────────────
    const rightsHolderName: string | null =
        (klassifikation?.membres_fornavn && klassifikation?.membres_efternavn)
            ? `${klassifikation.membres_fornavn} ${klassifikation.membres_efternavn}`.trim()
            : memberName ?? null

    if (rightsHolderName) {
        try {
            const navneTjek = await tjekNavn(rightsHolderName, contractText || undefined)
            if (navneTjek.feedbackpunkt && navneTjek.status !== "match") {
                parsed.feedbackpunkter = [...(parsed.feedbackpunkter ?? []), navneTjek.feedbackpunkt]
            }
        } catch (e) {
            console.warn("[analyse] Navnetjek fejlede:", e)
        }
    }

    // ── Risikovurdering (fra trin 2 hvis tilgængelig) ────────
    const VALID_RISK = ["LAV", "MELLEM", "HØJ"] as const
    type RiskLevel = typeof VALID_RISK[number]

    const riskSource = complianceExtract?.risk_level ?? parsed.risk_level ?? ""
    const rawRisk = String(riskSource).toUpperCase().trim()
    const riskLevel: RiskLevel | null = VALID_RISK.includes(rawRisk as RiskLevel)
        ? (rawRisk as RiskLevel)
        : parsed.samlet_vurdering === "kritisk" ? "HØJ"
        : parsed.samlet_vurdering === "forbehold" ? "MELLEM"
        : parsed.samlet_vurdering === "godkendt" ? "LAV"
        : null

    const shouldEscalate: boolean =
        complianceExtract?.should_escalate ??
        (typeof parsed.should_escalate === "boolean" ? parsed.should_escalate : riskLevel === "HØJ")

    // Overstyr parsed.risk_level med trin 2's værdi (mere pålidelig)
    if (complianceExtract?.risk_level) {
        parsed.risk_level = complianceExtract.risk_level
        parsed.should_escalate = shouldEscalate
    }

    // Programmatisk GUL-markering — koden lægger spans på, ikke modellen
    if (parsed.feedbackmail?.tekst && complianceExtract?.points?.length) {
        parsed.feedbackmail.tekst = applyGulTokens(
            parsed.feedbackmail.tekst,
            complianceExtract.points
        )
    }

    // Rens mailtekst for lækede interne felter
    if (parsed.feedbackmail?.tekst) {
        parsed.feedbackmail.tekst = parsed.feedbackmail.tekst
            .replace(/Overordnet vurdering\s*:.*?(JA|NEJ|LAV|MELLEM|HØJ)[^\n]*/gi, "")
            .replace(/Risikoniveau\s*:?\s*(LAV|MELLEM|HØJ)[^\n]*/gi, "")
            .replace(/Skal eskaleres\s*:?\s*(JA|NEJ)[^\n]*/gi, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
    }

    return {
        result: parsed,
        contractText: returnText,
        klassifikation,
        compliance_extract: complianceExtract,
        risk_level: riskLevel,
        should_escalate: shouldEscalate,
    }
}
