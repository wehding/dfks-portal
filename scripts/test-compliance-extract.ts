/**
 * scripts/test-compliance-extract.ts
 *
 * Testcases for trin 2 (compliance-udtræk).
 * Verificerer output for kendte kontrakttyper isoleret fra sprogkvaliteten.
 *
 * Kør: npx tsx scripts/test-compliance-extract.ts
 * Kræver: ANTHROPIC_API_KEY i miljøet
 */

import { COMPLIANCE_EXTRACT_PROMPT } from "../lib/compliance-extract-prompt"
import type { ComplianceExtract, CompliancePoint } from "../lib/compliance-types"

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) { console.error("ANTHROPIC_API_KEY mangler"); process.exit(1) }

// ── Hjælpefunktioner ──────────────────────────────────────────

async function udtraekCompliance(
    kontraktTekst: string,
    kontraktfakta: string
): Promise<ComplianceExtract> {
    const system = COMPLIANCE_EXTRACT_PROMPT + `\n\n${kontraktfakta}`
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey!, "anthropic-version": "2023-06-01" },
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

function assert(condition: boolean, message: string) {
    if (!condition) { console.error(`  ✗ FEJL: ${message}`); process.exitCode = 1 }
    else { console.log(`  ✓ ${message}`) }
}

function findPoint(result: ComplianceExtract, id: string): CompliancePoint | undefined {
    return result.points.find(p => p.point_id === id)
}

// ── Fælles kontraktfakta ──────────────────────────────────────

const FAKTA_OVERENSKOMST = `
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

const FAKTA_IKKE_OVERENSKOMST = FAKTA_OVERENSKOMST
    .replace("Overenskomstdækket:  JA", "Overenskomstdækket:  NEJ")
    .replace("Overenskomst:        de4-fiktion", "Overenskomst:        ingen")

const FAKTA_HYBRID = FAKTA_OVERENSKOMST
    .replace("Kontrakttype:        a-loen", "Kontrakttype:        hybrid")

// ── TEST 1: Komplet kontrakt ──────────────────────────────────

async function test1_KomplettKontraktLavRisiko() {
    console.log("\nTEST 1: Komplet kontrakt — forventer LAV risiko, ingen manglende klausuler")
    const kontrakt = `
KONTRAKT FOR FILMKLIPPER
Parterne: Zentropa ApS og Mette Hansen
Periode: 1. august – 30. november 2026

§ 1 Løn: 17.500 kr./uge.
Pension: Producenten indbetaler 9,5% af grundlønnen til en godkendt pensionsordning.

§ 2 Kreditering: "Klipper: Mette Hansen" i rulletekster.

§ 3 Rettigheder: Ophavsmanden forbeholder sig retten til vederlag fra Copydan og
andre kollektive forvaltningsorganisationer. Streaming-rettigheder administreres
via Create Denmark-rammeaftalen.

§ 4 Opsigelse: Begge parter kan opsige med 3 måneders varsel.

§ 5 TDM: Retten til tekst- og datamining kræver Filmklipperens samtykke.

§ 6 Promovering: Klipperen kan bruge framegrabs og trailer til egenpromotion.
`
    const result = await udtraekCompliance(kontrakt, FAKTA_OVERENSKOMST)

    assert(result.risk_level === "LAV", `risk_level LAV (fik: ${result.risk_level})`)
    assert(!result.should_escalate, "should_escalate false")
    assert(!result.non_covered_pedagogical, "non_covered_pedagogical false")

    const pension = findPoint(result, "pension")
    assert(!pension || !pension.requires_producer_text, "pension ikke flagget som manglende")

    const copydan = findPoint(result, "copydan")
    assert(!copydan || !copydan.requires_producer_text, "copydan ikke flagget som manglende")

    return result
}

// ── TEST 2: Manglende pension, Copydan, TDM ───────────────────

async function test2_ManglendePensionOgCopydan() {
    console.log("\nTEST 2: Manglende pension + Copydan — forventer HØJ risiko")
    const kontrakt = `
FREELANCE-KONTRAKT
Parterne: FilmHuset ApS og Anders Christensen
Periode: 15. september – 15. januar 2027
Kontrakttype: Ansættelse (A-løn)

§ 1 Honorar: 17.500 kr./uge som samlet honorar.

§ 2 Kreditering: Kreditering som klipper i rulletekster.

§ 3 Tavshedspligt: Medarbejderen må ikke videregive oplysninger om produktionen.
`
    const result = await udtraekCompliance(kontrakt, FAKTA_IKKE_OVERENSKOMST)

    assert(result.risk_level === "HØJ" || result.risk_level === "MELLEM",
        `risk_level HØJ/MELLEM (fik: ${result.risk_level})`)
    assert(result.non_covered_pedagogical === true, "non_covered_pedagogical true")

    const pension = findPoint(result, "pension")
    assert(!!pension, "pension point identificeret")
    assert(pension?.requires_producer_text === true, "pension requires_producer_text true")
    assert(!!pension?.proposed_text_da, "pension har proposed_text_da")
    assert(!pension?.proposed_text_da?.includes("[X]"), "ingen pladsholdere i proposed_text_da")
    assert(!!pension?.argument_basis, "pension har argument_basis (intern begrundelse)")

    const copydan = findPoint(result, "copydan")
    assert(!!copydan, "copydan point identificeret")
    assert(copydan?.requires_producer_text === true, "copydan requires_producer_text true")

    const promovering = findPoint(result, "promovering")
    assert(!!promovering, "promovering identificeret (tavshedspligt uden undtagelse)")

    // Kritisk: kreditering skal have requires_producer_text: false
    const kreditering = findPoint(result, "kreditering")
    if (kreditering) {
        assert(kreditering.requires_producer_text === false, "kreditering requires_producer_text false (kun til членmet)")
    }

    return result
}

// ── TEST 3: Hybrid kontrakt ───────────────────────────────────

async function test3_HybridKontrakt() {
    console.log("\nTEST 3: Hybrid A-løn/faktura — forventer HØJ, argument_basis aldrig tom")
    const kontrakt = `
ANSÆTTELSESKONTRAKT
Parterne: Momentum Film ApS og Lars Jensen (Medarbejder)
Periode: 1. juli – 31. december 2026

§ 1 Løn: 17.500 kr./uge.
§ 3 Opsigelse: 14 dages varsel.
§ 11 Fakturering: Leverandøren fremsender faktura til Kunden. Betalingsbetingelser: 30 dage netto.
`
    const result = await udtraekCompliance(kontrakt, FAKTA_HYBRID)

    assert(result.risk_level === "HØJ", `risk_level HØJ (fik: ${result.risk_level})`)
    assert(result.should_escalate === true, "should_escalate true")

    const hybrid = findPoint(result, "hybrid_kontrakt")
    assert(!!hybrid, "hybrid_kontrakt point identificeret")
    assert(hybrid?.severity === "HØJ", `hybrid severity HØJ (fik: ${hybrid?.severity})`)
    assert(hybrid?.requires_producer_text === true, "hybrid requires_producer_text true")
    assert(!!hybrid?.argument_basis && hybrid.argument_basis.length > 20, "hybrid argument_basis er udfyldt")
    assert(!!hybrid?.member_only_note, "hybrid member_only_note sat (rådgivning til членmet)")

    // Kritisk: argument_basis må ikke indeholde "severity:" som rå tekst
    result.points.forEach(p => {
        assert(!p.argument_basis.includes("severity:"), `${p.point_id}: argument_basis lækker ikke 'severity:' som rå tekst`)
    })

    return result
}

// ── Kør alle tests ────────────────────────────────────────────

async function main() {
    console.log("=== Compliance-udtræk testcases (v2 — points-skema) ===")
    console.log("Kalder Anthropic API med claude-haiku — bruger tokens.\n")

    try {
        const r1 = await test1_KomplettKontraktLavRisiko()
        console.log("  Points:", r1.points.map(p => `${p.point_id}(gul:${p.requires_producer_text})`).join(", "))

        const r2 = await test2_ManglendePensionOgCopydan()
        console.log("  Points:", r2.points.map(p => `${p.point_id}(gul:${p.requires_producer_text})`).join(", "))
        const p2 = findPoint(r2, "pension")
        console.log("  Pension proposed_text:", p2?.proposed_text_da?.slice(0, 80) + "...")

        const r3 = await test3_HybridKontrakt()
        console.log("  Points:", r3.points.map(p => `${p.point_id}(gul:${p.requires_producer_text})`).join(", "))

        console.log("\n=== Resultat ===")
        console.log(process.exitCode === 1 ? "❌ En eller flere tests fejlede" : "✅ Alle tests bestod")
    } catch (e) {
        console.error("Uventet fejl:", e)
        process.exit(1)
    }
}

main()
