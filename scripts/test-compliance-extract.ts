/**
 * scripts/test-compliance-extract.ts
 *
 * Testcases for trin 2 (compliance-udtræk).
 * Verificerer at compliance-udtræk giver korrekt output for kendte kontrakttyper.
 *
 * Kør: npx tsx scripts/test-compliance-extract.ts
 *
 * Kræver: ANTHROPIC_API_KEY i miljøet
 */

import { COMPLIANCE_EXTRACT_PROMPT } from "../lib/compliance-extract-prompt"
import type { ComplianceExtract } from "../lib/compliance-types"

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
    console.error("ANTHROPIC_API_KEY mangler")
    process.exit(1)
}

// ── Hjælpefunktion ────────────────────────────────────────────

async function udtraekCompliance(
    kontraktTekst: string,
    kontraktfakta: string
): Promise<ComplianceExtract> {
    const system = COMPLIANCE_EXTRACT_PROMPT + `\n\n${kontraktfakta}`
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey!,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 3000,
            system,
            messages: [{ role: "user", content: `Udtræk compliance-data:\n\n${kontraktTekst}` }],
        }),
    })
    const data = await response.json()
    const raw = data.content?.find((b: any) => b.type === "text")?.text ?? "{}"
    const first = raw.indexOf("{"); const last = raw.lastIndexOf("}")
    return JSON.parse(raw.slice(first, last + 1)) as ComplianceExtract
}

// ── Assertion-hjælper ─────────────────────────────────────────

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`  ✗ FEJL: ${message}`)
        process.exitCode = 1
    } else {
        console.log(`  ✓ ${message}`)
    }
}

// ── Testcases ─────────────────────────────────────────────────

const KONTRAKTFAKTA_STANDARD = `
KONTRAKTFAKTA:
Kontrakttype:        a-loen
Overenskomstdækket:  JA
Overenskomst:        de4-fiktion
Medlemmets navn:     Mette Hansen
Aftalt løn:          17500 kr/uge
Løntype:             ugeloeen
Valuta:              DKK
Producent:           Zentropa ApS
Produktionstype:     spillefilm
Kontraktsprog:       da

AKTUELLE SATSER:
Normalløn: 17500 kr/uge
Pension: 9.5 %
Feriepenge: 12.5 %
BETA-fond: 0.1 %
Helligdagsbetaling: 1.95 %`

async function testCase1_StandardALoenMedPension() {
    console.log("\nTEST 1: A-løn overenskomst med pension — forventer LAV risiko")
    const kontrakt = `
KONTRAKT FOR FILMKLIPPER
Parterne: Zentropa ApS (Producent) og Mette Hansen (Medarbejder)
Produktion: Nattens Lys (spillefilm)
Periode: 1. august 2026 – 30. november 2026

§ 1 Løn
Grundløn: 17.500 kr./uge inkl. feriepenge.
Producenten indbetaler herudover et pensionsbidrag på 9,5% af grundlønnen
til en af parterne godkendt pensionsordning.

§ 2 Kreditering
Medarbejderen krediteres som "Klipper: Mette Hansen" i filmens rulletekster.

§ 3 Rettigheder
Ophavsmanden forbeholder sig retten til vederlag fra Copydan og andre
kollektive forvaltningsorganisationer for enhver sekundær udnyttelse af værket.
Streaming- og VOD-rettigheder administreres via Create Denmark-rammeaftalen.

§ 4 Opsigelse
Aftalen kan opsiges skriftligt af begge parter med 3 måneders varsel.

§ 5 TDM/AI
Retten til at udnytte indholdet med henblik på tekst- og datamining,
jf. ophavsretslovens § 11b, kræver Filmklipperens samtykke.
`
    const result = await udtraekCompliance(kontrakt, KONTRAKTFAKTA_STANDARD)

    assert(result.risk_level === "LAV", `risk_level er LAV (fik: ${result.risk_level})`)
    assert(!result.should_escalate, "should_escalate er false")
    assert(!result.non_covered_pedagogical, "non_covered_pedagogical er false")
    assert(result.overenskomst_navn === "de4-fiktion", `overenskomst_navn er de4-fiktion (fik: ${result.overenskomst_navn})`)

    const pensionClause = result.required_clauses.find(c => c.clause_id === "pension")
    assert(!pensionClause || !pensionClause.requires_gul, "pension er ikke flagget som manglende (eller requires_gul=false)")

    const copydanClause = result.required_clauses.find(c => c.clause_id === "copydan")
    assert(!copydanClause || !copydanClause.requires_gul, "copydan er ikke flagget som manglende")

    return result
}

async function testCase2_ManglendePensionOgCopydan() {
    console.log("\nTEST 2: A-løn uden pension og Copydan — forventer HØJ risiko")
    const kontrakt = `
FREELANCE-KONTRAKT
Parterne: FilmHuset ApS og Anders Christensen
Produktion: Storbyen (spillefilm)
Periode: 15. september 2026 – 15. januar 2027
Kontrakttype: Ansættelse (A-løn)

§ 1 Honorar
Medarbejderen modtager kr. 17.500 pr. uge som samlet honorar.

§ 2 Arbejdsopgaver
Klipning og post-produktion af spillefilm.

§ 3 Kreditering
Kreditering som klipper i rulletekster.

§ 4 Tavshedspligt
Medarbejderen må ikke videregive oplysninger om produktionen til tredjepart.
`
    const KONTRAKTFAKTA_INGEN_OVERENSKOMST = KONTRAKTFAKTA_STANDARD
        .replace("Overenskomstdækket:  JA", "Overenskomstdækket:  NEJ")
        .replace("Overenskomst:        de4-fiktion", "Overenskomst:        ingen")

    const result = await udtraekCompliance(kontrakt, KONTRAKTFAKTA_INGEN_OVERENSKOMST)

    assert(result.risk_level === "HØJ" || result.risk_level === "MELLEM",
        `risk_level er HØJ eller MELLEM ved manglende pension/Copydan (fik: ${result.risk_level})`)

    const pensionClause = result.required_clauses.find(c => c.clause_id === "pension")
    assert(!!pensionClause, "pension clause er identificeret som manglende")
    assert(pensionClause?.requires_gul === true, "pension requires_gul er true")
    assert(!!pensionClause?.exact_text_da, "pension har exact_text_da (ikke tom)")
    assert(!pensionClause?.exact_text_da?.includes("[X]"), "pension exact_text_da har ingen pladsholdere")

    const copydanClause = result.required_clauses.find(c => c.clause_id === "copydan")
    assert(!!copydanClause, "copydan clause er identificeret som manglende")
    assert(copydanClause?.requires_gul === true, "copydan requires_gul er true")

    const promoveringClause = result.required_clauses.find(c => c.clause_id === "promovering")
    assert(!!promoveringClause, "promovering clause er identificeret (tavshedspligt uden undtagelse)")

    assert(result.non_covered_pedagogical === true, "non_covered_pedagogical er true")

    return result
}

async function testCase3_HybridKontrakt() {
    console.log("\nTEST 3: Hybrid A-løn/faktura — forventer HØJ risiko og hybrid-flag")
    const kontrakt = `
ANSÆTTELSESKONTRAKT
Parterne: Momentum Film ApS og Lars Jensen (Medarbejder)
Produktion: Nyt projekt (TV-serie)
Periode: 1. juli 2026 – 31. december 2026

§ 1 Løn
Grundløn: 17.500 kr./uge.
Pension: Medarbejderen er selv ansvarlig for pension.

§ 2 Arbejde
Medarbejderen udfører klipningsopgaver.

§ 3 Opsigelse
Samarbejdet kan opsiges med 14 dages varsel.

§ 11 Fakturering
Leverandøren fremsender faktura for udført arbejde til Kunden.
Betalingsbetingelser: 30 dage netto.
`
    const KONTRAKTFAKTA_HYBRID = KONTRAKTFAKTA_STANDARD
        .replace("Kontrakttype:        a-loen", "Kontrakttype:        hybrid")

    const result = await udtraekCompliance(kontrakt, KONTRAKTFAKTA_HYBRID)

    assert(result.risk_level === "HØJ", `risk_level er HØJ ved hybrid (fik: ${result.risk_level})`)
    assert(result.should_escalate === true, "should_escalate er true ved hybrid")

    const hybridIssue = result.flagged_issues.find(i => i.issue_id === "hybrid_kontrakt")
    assert(!!hybridIssue, "hybrid_kontrakt issue er identificeret")
    assert(hybridIssue?.severity === "HØJ", `hybrid severity er HØJ (fik: ${hybridIssue?.severity})`)
    assert(hybridIssue?.requires_gul === true, "hybrid requires_gul er true")
    assert(!!hybridIssue?.internal_note, "hybrid har internal_note (til jurist)")

    return result
}

// ── Kør alle tests ────────────────────────────────────────────

async function main() {
    console.log("=== Compliance-udtræk testcases ===")
    console.log("Bemærk: Disse tests kalder Anthropic API og bruger tokens.\n")

    try {
        const r1 = await testCase1_StandardALoenMedPension()
        console.log("  Rådata:", JSON.stringify({ risk_level: r1.risk_level, clauses: r1.required_clauses.length }))

        const r2 = await testCase2_ManglendePensionOgCopydan()
        console.log("  Rådata:", JSON.stringify({
            risk_level: r2.risk_level,
            clauses: r2.required_clauses.map(c => c.clause_id),
            non_covered: r2.non_covered_pedagogical,
        }))

        const r3 = await testCase3_HybridKontrakt()
        console.log("  Rådata:", JSON.stringify({
            risk_level: r3.risk_level,
            issues: r3.flagged_issues.map(i => i.issue_id),
        }))

        console.log("\n=== Resultat ===")
        if (process.exitCode === 1) {
            console.log("❌ En eller flere tests fejlede")
        } else {
            console.log("✅ Alle tests bestod")
        }
    } catch (e) {
        console.error("Uventet fejl:", e)
        process.exit(1)
    }
}

main()
