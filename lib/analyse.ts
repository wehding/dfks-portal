/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy Supabase or external API payloads are normalized at this module boundary. */
/**
 * lib/analyse.ts
 *
 * Delt kernelogik til AI-kontraktgennemgang.
 * Bruges af /api/gennemgang og /api/admin/contracts/[id]/reanalyse
 * så internt fetch + FormData-kald undgås.
 */

import { extractPdfText } from "@/lib/pdf-parse"
import { extractWordText } from "@/lib/word-text"
import { callAiDetailed } from "@/lib/ai-client"
import { getAiRuntimeConfig } from "@/lib/ai-runtime"
import {
    resolveContractReviewProductionType,
    royaltyRequirementForContract,
    type ContractReviewProductionType,
} from "@/lib/contract-review-domain-rules"
import { createAiUsageRun, finishAiUsageRun, type AiUsageContext } from "@/lib/ai-usage"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { getSupabaseServiceKey } from "@/lib/env"
import { hentKontekst } from "@/lib/retrieval"
import { tjekNavn } from "@/lib/rettighedshaver-tjek"
import { FEW_SHOT_EXAMPLES, TONE_REGLER } from "@/lib/few-shot-examples"
import { MAIL_FORMAT_PROMPT } from "@/lib/mail-format-prompt"
import { findParentMember } from "@/lib/db/employers"
import { errorMessage, logInfo, logWarn } from "@/lib/server-log"
import { resolveAgreementByDate } from "@/lib/agreement-version-resolver"
import { getAgreementSatserForContext } from "@/lib/agreement-wage-server"

// ── Sensitiv data-maskning ────────────────────────────────────

export function maskSensitiveData(text: string): string {
    // CPR: DDMMYY-XXXX or DDMMYYXXXX
    text = text.replace(/\b(\d{6})-?(\d{4})\b/g, (match, p1) => {
        const day = parseInt(p1.slice(0, 2))
        const month = parseInt(p1.slice(2, 4))
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
            return `${p1}-****`
        }
        return match
    })
    // Dansk bankkonto
    text = text.replace(/\b(\d{4})[\s-](\d{6,10})\b/g, (match, reg) => {
        const regNum = parseInt(reg)
        if (regNum >= 1000 && regNum <= 9999) return `${reg} ****`
        return match
    })
    // IBAN
    text = text.replace(/\bDK\d{2}[\s]?(\d{4}[\s]?){3}\d{2}\b/gi, "DK** **** **** **** **")
    // Danske mobilnumre
    text = text.replace(/\b([2-9]\d{7})\b/g, (match) => `${match.slice(0, 2)}** ****`)
    // Private adresser
    text = text.replace(
        /\b(\p{L}+(?:vej|gade|alle|plads|stræde|vænge|have|park|toft|sti|bro)\s+)(\d+[A-Za-z]?(?:,\s*\d+\.?\s*(?:tv|th|mf)?)?)/giu,
        (match, street) => `${street}[NR. MASKERET]`
    )
    return text
}

// ── Klassifikationstype ───────────────────────────────────────

export type Klassifikation = {
    kontrakttype: "a-loen" | "leverandoer" | "hybrid"
    er_overenskomst: boolean
    overenskomst_navn: string | null
    kontraktdato: string | null
    membres_fornavn: string
    membres_efternavn: string
    aftalt_loen: number | null
    loen_enhed: "kr/uge" | "kr/dag" | null
    producent_navn: string
    kontraktsprog: "da" | "en" | "other"
    loen_type: "ugeloeen" | "dagsloen" | "fast_total" | "ukendt"
    loen_valuta: "DKK" | "USD" | "EUR" | "GBP" | "other"
    produktionstype: ContractReviewProductionType
}

// ── Trin 1: Klassificér kontrakten ────────────────────────────

async function klassificerKontrakt(
    kontraktTekst: string,
    provider: string,
    model: string,
    usageContext: AiUsageContext
): Promise<Klassifikation> {
    const system = `Du klassificerer danske filmkontrakter.
Returnér KUN valid JSON — ingen tekst før eller efter.
Brug null hvis et felt ikke kan bestemmes.`
    // Scan hele teksten for udviklingsindikator og injicér som ekstra kontekst
    const udviklingsMatch = kontraktTekst.match(
        /klipper\s*\(udvikling\)|film\s+editor\s*\(development\)|udviklingskontrakt|\budviklingsfase\b|\budvikling\b|optionsaftale|\bdevelopment\b|option\s+agreement/i
    )
    const udviklingsKontekst = udviklingsMatch
        ? `\n\nOBS: Kontrakten indeholder følgende udviklingsindikator: "${udviklingsMatch[0]}" — klassificér som udviklingskontrakt.\n`
        : ""

    const userMessage = `Klassificér denne kontrakt:${udviklingsKontekst}\n\n${kontraktTekst.slice(0, 4000)}

Returnér JSON med disse felter:
{
  "kontrakttype": "a-loen" ELLER "leverandoer" ELLER "hybrid",
  "er_overenskomst": true/false (er producenten sandsynligvis overenskomstdækket via Producentforeningen?),
  "overenskomst_navn": "de4-fiktion" ELLER "faf" ELLER "faf-dokumentar" ELLER "dj" ELLER "metal" ELLER null (BEMÆRK: både De4's og FAF's overenskomst hedder "Fiktionsoverenskomsten" — afgør ALDRIG kun ud fra ordet "fiktion". Læs hvilken organisation der konkret er navngivet som modpart til Producentforeningen i overenskomstens overskrift/indledning, fx "Overenskomst mellem Producentforeningen og FAF" → "faf", "...og De4" → "de4-fiktion"),
  "kontraktdato": "YYYY-MM-DD (kontraktens underskrifts- eller startdato) eller null",
  "membres_fornavn": "fornavn på klipperen/medarbejderen",
  "membres_efternavn": "efternavn",
  "aftalt_loen": tal (kun nummeret, fx 17500) eller null,
  "loen_enhed": "kr/uge" ELLER "kr/dag" eller null,
  "producent_navn": "navn på produktionsselskab",
  "kontraktsprog": "da" ELLER "en" ELLER "other",
  "loen_type": "ugeloeen" ELLER "dagsloen" ELLER "fast_total" (ved 'total fee', 'fixed fee', 'lump sum', 'flat fee', 'fast honorar', 'samlet honorar') ELLER "ukendt",
  "loen_valuta": "DKK" ELLER "USD" (ved $) ELLER "EUR" (ved €) ELLER "GBP" (ved £) ELLER "other",
  "produktionstype": "spillefilm" ELLER "tvserie" ELLER "dokumentar" ELLER "kortfilm" ELLER "ukendt" ELLER "udvikling_dokumentar" ELLER "udvikling_fiktion" ELLER "udvikling_underholdning"
}

VIGTIGT — udviklingskontrakter:
Brug "udvikling_dokumentar", "udvikling_fiktion" eller "udvikling_underholdning" hvis kontrakten er for en produktion der endnu ikke er sat i produktion. Tegn på udviklingskontrakt:
- Kreditering indeholder "(udvikling)" fx "Klipper (udvikling)" eller "Film Editor (development)"
- Ord som "udviklingskontrakt", "udviklingsforløb", "optionsaftale", "i udviklingsfasen", "development deal"
- Ingen angivet distributionsaftale eller premiere
- Titlen er beskrevet som "arbejdstitel" uden fastlagt produktionsformat

Domænereglen: dokumentar → "udvikling_dokumentar", fiktion/drama → "udvikling_fiktion", underholdning/reality → "udvikling_underholdning".
Serieformat: Et konkret produktionsomfang med nummererede episoder eller arbejde "på afsnit 1 og 4" betyder, at produktionstypen skal være "tvserie". Formuleringer som "klipper af 2 episoder (5+6)" og "Klipper på afsnit 1 og 4" er sikre seriesignaler. En nummereret titel eller en juridisk henvisning som "se afsnit 4" er ikke et seriesignal.
Brug "ukendt" KUN hvis produktionen klart er sat i produktion men typen ikke kan bestemmes.`

    const defaultKlassifikation: Klassifikation = {
        kontrakttype: "hybrid",
        er_overenskomst: false,
        overenskomst_navn: null,
        kontraktdato: null,
        membres_fornavn: "",
        membres_efternavn: "",
        aftalt_loen: null,
        loen_enhed: null,
        producent_navn: "",
        kontraktsprog: "da",
        loen_type: "ukendt",
        loen_valuta: "DKK",
        produktionstype: "ukendt",
    }

    let raw = "{}"
    try {
        raw = (await callAiDetailed({ provider, model, system, userMessage, maxTokens: 500, responseJson: true, usageContext })).text
    } catch {
        return defaultKlassifikation
    }
    const first = raw.indexOf("{")
    const last = raw.lastIndexOf("}")
    if (first === -1 || last === -1) {
        logWarn("analyse", "Klassifikation returnerede ingen JSON")
        return defaultKlassifikation
    }

    try {
        const p = JSON.parse(raw.slice(first, last + 1))
        return {
            kontrakttype: p.kontrakttype ?? "hybrid",
            er_overenskomst: p.er_overenskomst ?? false,
            overenskomst_navn: p.overenskomst_navn ?? null,
            kontraktdato: typeof p.kontraktdato === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.kontraktdato) ? p.kontraktdato : null,
            membres_fornavn: p.membres_fornavn ?? "",
            membres_efternavn: p.membres_efternavn ?? "",
            aftalt_loen: typeof p.aftalt_loen === "number" ? p.aftalt_loen : null,
            loen_enhed: p.loen_enhed ?? null,
            producent_navn: p.producent_navn ?? "",
            kontraktsprog: p.kontraktsprog ?? "da",
            loen_type: p.loen_type ?? "ukendt",
            loen_valuta: p.loen_valuta ?? "DKK",
            produktionstype: resolveContractReviewProductionType(p.produktionstype, kontraktTekst),
        }
    } catch {
        logWarn("analyse", "Klassifikation JSON parse fejl")
        return defaultKlassifikation
    }
}

// ── Byg absolutte regler fra klassifikation + DB-satser ──────

function byggAbsolutteRegler(
    klassifikation: Klassifikation,
    satser: Array<{ beskrivelse: string; vaerdi: number | string; enhed: string }>,
    distributionChannels: string[],
    overenskomst?: {
        /** Autoritativt svar fra DFKS-registeret/uploaden. Vinder over klassifikatorens gæt. */
        resolved: boolean | null
        /** Navn på ProF-medlem hvis producenten er et underselskab heraf. */
        parentMemberName: string | null
    }
): string {
    // Autoritativ rækkefølge: moderselskabs-binding → DFKS-flag → klassifikatorens gæt.
    const erOverenskomst: boolean = overenskomst?.parentMemberName
        ? true
        : (overenskomst?.resolved ?? klassifikation.er_overenskomst)

    const overenskomstFaktaLinje = overenskomst?.parentMemberName
        ? `JA — producenten er underselskab af ${overenskomst.parentMemberName} (ProF-medlem) og er bundet af overenskomsten på lige fod med moderselskabet`
        : erOverenskomst ? "JA" : "NEJ"

    const hent = (søgeord: string) =>
        satser.find(s => s.beskrivelse?.toLowerCase().includes(søgeord.toLowerCase()))

    // Alle normalløns-linjer listes eksplicit — undgår at én tilfældig funktion vælges
    const normallonLinjer = satser.filter(s => {
        const b = s.beskrivelse?.toLowerCase() ?? ""
        return b.startsWith("normalløn") || b.startsWith("normallon") || b.startsWith("minimum")
    })
    const pension    = hent("pension")
    const beta       = hent("beta")
    const helligdag  = hent("helligdag")
    const feriepenge = hent("feriepenge")

    const fornavn = klassifikation.membres_fornavn || "[fornavn ikke fundet i kontrakt]"
    const efternavn = klassifikation.membres_efternavn || ""

    const satsLinje = (label: string, s: { vaerdi: number | string; enhed: string; beskrivelse?: string } | undefined) => {
        if (!s) return `${label}: [ikke tilgængelig — verificér mod overenskomst]`
        // Behold en eventuel paragraf-/grundlagsnote fra beskrivelsen (fx pension).
        const note = s.beskrivelse?.match(/\((§[^)]+)\)/)?.[1]
        return `${label}: ${s.vaerdi} ${s.enhed}${note ? ` — ${note}` : ""}`
    }

    const loenInfo = klassifikation.aftalt_loen
        ? `${klassifikation.aftalt_loen} ${klassifikation.loen_enhed ?? "kr/uge"} (grundløns-/basislinjen — den SAMLEDE ugeløn kan være højere med personligt tillæg og faste tillæg; læs dem fra kontraktteksten)`
        : "[ikke fundet i kontrakt]"

    // A-løns-beregninger fejler ofte fordi modellen kun har fået ét løntal og
    // blander grundløn, samlet løn og ferieberettiget løn sammen. Gør grundlaget eksplicit.
    const loenGrundlagRegel = (erOverenskomst && klassifikation.kontrakttype === "a-loen")
        ? `LØNGRUNDLAG — HVILKET TAL REGNER DU AF:
- Ferieberettiget løn = grundløn + alle faste, tilbagevendende tillæg (personligt tillæg, fast tillæg for over-/forskudttid, genetillæg). Engangsbeløb, udlæg og rene omkostningsgodtgørelser tæller IKKE med.
- BETA-fond, helligdagsbetaling og feriepenge beregnes af FERIEBERETTIGET LØN — ikke af grundlønnen alene. Har kontrakten et personligt tillæg, SKAL det med i grundlaget.
- Pension beregnes af det grundlag der står i pensions-satslinjen ovenfor (fx "af normalløn"). Betaler kontrakten pension af et HØJERE grundlag end overenskomsten kræver (fx af grundløn når kun normalløn kræves), er det et PLUS for medlemmet — ikke en anmærkning.
- Oplys ALTID hvilket tal du regner af, og brug samme tal konsekvent i hele mailen.
- Kan du ikke fastslå de faste tillæg sikkert: skriv fx "mindst 85 kr./uge (beregnet af grundlønnen — bliver højere med tillæg)" frem for et falsk-præcist tal.`
        : ""

    const sprogRegel = klassifikation.kontraktsprog === "en"
        ? "🌐 ENGELSK KONTRAKT: Mailen til medlemmet skrives på DANSK som normalt. KUN de tekststykker der er indpakket i <mark style=\"background-color:#fef08a\"> og </mark> skrives på ENGELSK — både den menneskelige indledningssætning og kontraktteksten der foreslås. TIL DIG-sektionen skrives på dansk."
        : "✓ Dansk kontrakt — skriv alt på dansk."

    const loenTypeRegel = klassifikation.loen_type === "fast_total"
        ? `✓ FAST TOTALBELØB — følg disse regler:
Beløbet er ${klassifikation.aftalt_loen} ${klassifikation.loen_valuta} for hele perioden.

${klassifikation.loen_valuta !== "DKK"
    ? `Valuta er ${klassifikation.loen_valuta} — beregn ALT i ${klassifikation.loen_valuta}.
Omregn IKKE til DKK og brug INGEN brackets eller pladsholdere som [indsæt kurs].
Nævn til sidst at medlemmet selv skal omregne via nationalbanken.dk.`
    : "Valuta er DKK — beregn normalt."}

Hvis antal uger er tilgængeligt i kontrakten: del totalbeløbet op per uge og sammenlign med De4-normallønnen.
Hvis antal uger IKKE er tilgængeligt: oplys kun totalbeløbet og anbefal at få perioden præciseret.

🚫 ABSOLUT FORBUDT: Brug aldrig brackets, pladsholdere eller ufærdige beregninger.
Alle tal i analysen skal være konkrete udregnet tal — aldrig [beløb] eller [indsæt].`
        : klassifikation.loen_type === "ugeloeen"
        ? `✓ UGELØN — ${klassifikation.aftalt_loen} ${klassifikation.loen_valuta} per uge.`
        : "⚠ LØNTYPE UKLAR — undgå beregninger der forudsætter en specifik løntype."

    const kontrakttypeRegler =
        klassifikation.kontrakttype === "leverandoer"
            ? "🚫 LEVERANDØRKONTRAKT — ABSOLUT FORBUD: Beregn ALDRIG pension/ferie oveni honoraret. Ferie er inkluderet i honoraret. Producenten betaler ingen pension."
        : klassifikation.kontrakttype === "hybrid"
            ? `🚫 HYBRID KONTRAKT — KRITISK PROBLEM:
Dette er det mest alvorlige problem i kontrakten og skal nævnes FØRST og DIREKTE.
Brug IKKE formuleringer som "lidt i tvivl" eller "jeg er usikker".

Intern forklaring til medlemmet (ikke gul):
Kontrakten blander A-løns- og leverandørterminologi på en måde der er juridisk uholdbar.
Pkt. 1-10 bruger "Medarbejder" og "grundløn" (A-lønsord) mens pkt. 11 bruger
"Leverandøren", "Kunden" og "faktura" (leverandørord). Det skaber usikkerhed om
skat, pension, LG-dækning og rettigheder. ANBEFAL IKKE AT UNDERSKRIVE i nuværende form.

Snippet til producenten (gul):
"Kontrakten indeholder en juridisk inkonsistens der skal rettes inden underskrift.
Pkt. 1-10 er formuleret som en A-lønsansættelse, mens pkt. 11 bruger leverandør-
terminologi (Leverandøren, Kunden, faktura). De to kontraktformer kan ikke blandes.
Jeg anmoder om at kontrakten rettes til en ren A-lønskontrakt, hvor alle
formuleringer om Leverandøren og Kunden i pkt. 11 ændres til Medarbejderen
og Producenten."

🚫 ABSOLUT FORBUD: Lav INGEN lønberegning ved hybrid kontrakt.`
            : "✓ A-LØNSKONTRAKT — Beregn korrekt: feriepenge og pension betales OVENI lønnen. Brug udelukkende satser fra AKTUELLE SATSER nedenfor."

    const royaltyRegel = royaltyRequirementForContract({
        productionType: klassifikation.produktionstype,
        agreementCovered: erOverenskomst,
        agreementName: klassifikation.overenskomst_navn,
        distributionChannels,
    })

    const overenskomstRegler = erOverenskomst
        ? (overenskomst?.parentMemberName
            ? `✓ OVERENSKOMSTDÆKKET VIA MODERSELSKAB — producenten er underselskab af ${overenskomst.parentMemberName} (ProF-medlem). Behandl producenten som fuldt overenskomstdækket: overenskomst-referencer er tilladt som bindende hjemmel i snippets til producenten, og du må IKKE skrive at producenten ikke er medlem / at overenskomsten ikke gælder.`
            : "✓ OVERENSKOMSTDÆKKET — overenskomst-referencer er tilladt i snippets til producenten.")
        : "🚫 IKKE OVERENSKOMSTDÆKKET — Citer ALDRIG De4/FAF som bindende hjemmel for PRODUCENTENS forpligtelser i snippets til producenten; brug 'branchepraksis' i stedet. MEN: klausuler kontrakten selv har skrevet ind — ordret eller ved at henvise til/bygge på De4- eller FAF-standardformularen — er bindende. Anerkend dem som dækkede; flag dem ikke som manglende."

    const overenskomstNavn = klassifikation.overenskomst_navn ?? ""
    const overenskomstFormularRegel =
        overenskomstNavn === "de4-fiktion"
            ? "✓ DE4-FIKTION: De4-standardformularen dækker allerede eksplicit Copydan-forbehold og SVOD/streaming-aftale. Henviser kontrakten til De4-overenskomsten eller standardformularen, ER disse dækket — nævn dem som POSITIVE, ALDRIG som 'manglende Copydan' / 'manglende SVOD'. Royalty står IKKE i De4-standardformularen — vurder royalty separat."
        : ["faf", "faf-dokumentar"].includes(overenskomstNavn)
            ? "⚠ FAF: FAF-standardformularen mangler eksplicit Copydan, SVOD og royalty. Mangler kontrakten dem, skal alle tre skrives ind (eksplicit hvis producenten ikke er ProF-bundet; ellers med overenskomsten som hjemmel)."
        : ""

    return `
KONTRAKTFAKTA — VERIFICERET I TRIN 1. TILSIDESÆT IKKE DISSE:
Kontrakttype:        ${klassifikation.kontrakttype}
Overenskomstdækket:  ${overenskomstFaktaLinje}
Medlemmets navn:     ${fornavn} ${efternavn}
Aftalt løn:          ${loenInfo}
Producent:           ${klassifikation.producent_navn || "[ikke fundet]"}

AKTUELLE SATSER FRA DATABASE — BRUG KUN DISSE TAL, ALDRIG EGNE:
${normallonLinjer.length > 0
    ? normallonLinjer.map(s => `${s.beskrivelse}: ${s.vaerdi} ${s.enhed}`).join("\n")
      + `\n(Linjerne er IKKE matchet mod kontraktens funktion/løngruppe. Nævn kun en bestemt løngruppe i mailen hvis kontrakten selv angiver den, ELLER hvis der kun findes én linje for den relevante funktion ovenfor. Ellers: skriv "normalløn for [funktion]" uden gruppenummer.)`
    : "Normalløn: [ikke tilgængelig — verificér mod overenskomst]"}
${satsLinje("Pension", pension)}
${erOverenskomst && klassifikation.kontrakttype === "a-loen"
    ? satsLinje("BETA-fond", beta) + "\n" + satsLinje("Helligdagsbetaling", helligdag)
    : "BETA-fond og helligdagsbetaling: Ikke relevant — kun ved overenskomstdækket A-løn"}
${satsLinje("Feriepenge", feriepenge)}

ABSOLUTTE REGLER FOR DENNE ANALYSE:
${sprogRegel}
${loenTypeRegel}
${kontrakttypeRegler}
${overenskomstRegler}
${overenskomstFormularRegel}
${royaltyRegel}
${loenGrundlagRegel}
BEDRE END OVERENSKOMSTEN = POSITIVT: Er et vilkår bedre for medlemmet end overenskomstens minimum (løn over normalløn, pension af et højere grundlag, længere prolongationsvarsel, royalty over standard, tillæg over minimum), så fremstil det som POSITIVT (type "positiv"/"info", ✓) — aldrig som "advarsel"/"kritisk", et "OBS" eller et "kontrollér at ...". Kontrol-opfordringer kun ved en konkret uregelmæssighed, ikke rutinemæssigt.
Start feedbackmailen med: Kære ${fornavn},
`.trim()
}

// ── Base system prompt (juridisk viden + JSON-struktur) ───────

export const BASE_SYSTEM_PROMPT = `Du er juridisk rådgiver specialiseret i danske filmkontrakter og overenskomster, med særlig ekspertise i De4-overenskomsten (fiktion) og FAF-overenskomsten (dokumentar). Du assisterer DFKS's jurist med at gennemgå foreløbige kontrakter.

VIGTIGT — SATSER OG BELØB:
Alle procentsatser og lønninger SKAL hentes fra AKTUELLE SATSER-blokken øverst i denne prompt.
Brug ALDRIG hardcodede tal fra din træning — satser ændres ved overenskomstfornyelse.

Din opgave er at:
1. Identificere problematiske klausuler, mangler og afvigelser fra branchestandard
2. Fremhæve positive elementer der er i orden
3. Foreslå konkrete forbedringer og forhandlingspunkter
4. Udarbejde et udkast til en professionel feedback-mail til producenten

BEDRE END OVERENSKOMSTEN = POSITIVT:
Er et vilkår bedre for medlemmet end overenskomstens minimum (løn over normalløn,
pension beregnet af et højere grundlag end krævet, længere prolongationsvarsel,
royalty over standardsats, tillæg over minimum), SKAL feedbackpunktet have
type "positiv" eller "info" — aldrig "advarsel" eller "kritisk". Skriv ikke "OBS",
"vær opmærksom på" eller "kontrollér at ..." om et vilkår der allerede er bedre end
kravet. En kontrol-opfordring hører kun til ved en konkret uregelmæssighed.

Returner KUN gyldig JSON uden markdown-backticks:

{
  "overblik": {
    "titel": "string",
    "parter": ["string"],
    "periode": "string",
    "kontrakttype": "fiction|documentary|unknown",
    "overenskomst": "overenskomstens navn eller null for leverandørkontrakter",
    "erLeverandoerkontrakt": "boolean",
    "honorarUge": "number or null — KUN for leverandørkontrakter"
  },
  "feedbackpunkter": [
    {
      "id": "string (fp1, fp2...)",
      "type": "kritisk|advarsel|positiv|info",
      "titel": "string",
      "beskrivelse": "string (præcis juridisk forklaring, max 200 tegn)",
      "anbefaling": "string (konkret handlingsforslag, max 200 tegn)",
      "citat": "string (EKSAKT tekststreng fra kontrakten, max 200 tegn)",
      "paragraf": "string — peg på den klausul der FAKTISK regulerer forholdet, eller 'ikke reguleret i kontrakten' når punktet handler om en mangel. Hæng ALDRIG flere urelaterede punkter på den samme overenskomst-henvisningsklausul."
    }
  ],
  "feedbackmail": {
    "emne": "string",
    "tekst": "string (den komplette mailbody — gule producent-afsnit indpakkes i <mark style=\\"background-color:#fef08a\\"> og </mark>)"
  },
  "samlet_vurdering": "godkendt|forbehold|kritisk",
  "risk_level": "LAV|MELLEM|HØJ",
  "should_escalate": true,
  "prioriterede_forhandlingspunkter": ["string"],
  "prioriterede_mail_sektioner": ["number or null — svarende til nummereret afsnit i mailen"]
}

risk_level-logik:
- LAV: ingen kritiske punkter, ingen alvorlige overenskomstbrud. Følger standardformularen og betaler korrekt.
- MELLEM: et eller flere advarsels-punkter, men intet kritisk. En producent der IKKE er ProF-bundet hører som udgangspunkt HER — ikke i HØJ — når kontrakten ellers følger standard og betaler korrekt; det udløser kun anbefalinger om at skrive udækkede vilkår eksplicit ind.
- HØJ: mindst ét reelt kritisk punkt: hybrid kontrakt, INGEN pension nævnt, royalty under minimumsats, feriepenge ikke sikret, eller en klausul der reelt fratager medlemmet rettigheder.

Manglende ProF-medlemskab er IKKE i sig selv HØJ risiko.

should_escalate: sæt til true hvis risk_level er HØJ og sagen bør behandles af senior-jurist.

DANSK FILMBRANCHE — VIGTIG BAGGRUNDSVIDEN:

Create Denmark:
- Create Denmark er et godkendt forhandlingsfællesskab der forhandler streaming-rettigheder (SVOD/VOD)
- En kontrakt der henviser til Create Denmark er POSITIV — flagger ALDRIG dette som problematisk
- Kun hvis kontrakten eksplicit FRAVÆLGER Create Denmark skal det markeres kritisk

Copydan:
- Copydan administrerer kollektive vederlag for TV-visning mv.
- En Copydan-forbehold klausul er POSITIV branchestandard

DE4-OVERENSKOMSTEN ER ALTID INTERN MÅLESTOK:
Selv hvis en kontrakt reguleres af en anden overenskomst, vurdér om De4's vilkår er bedre.

KRITISK FORSKEL — FAF (2025-2027) vs. De4 (2022) for fiktion:
- De4-standardkontrakten INDEHOLDER allerede eksplicit Copydan-forbehold og SVOD/streaming-aftale.
  Henviser kontrakten til De4-overenskomsten eller bruger De4-standardformularen, ER Copydan og
  SVOD dækket — anerkend dem som POSITIVE, flag dem ALDRIG som "manglende".
- FAF-standardkontrakten mangler eksplicit Copydan, SVOD og royalty — disse skal tilføjes separat.
- Royalty står IKKE som fast tekst i De4-standardformularen — vurder royalty separat uanset formular.

PRODUCENTFORENINGENS MEDLEMSSKAB — HVAD DET AFGØR:
Overenskomstens vilkår gælder AUTOMATISK kun for ProF-medlemmer (se KONTRAKTFAKTA øverst).
MEN: en klausul som kontrakten selv skriver ind — ordret ELLER ved at henvise til / bygge på
De4- eller FAF-standardformularen — er kontraktuelt bindende uanset ProF-medlemskab.
Kontrollér derfor ALTID om klausulen FAKTISK står i kontrakten (direkte eller via
standardformular-henvisning) FØR du kalder den "manglende". Er producenten ikke ProF-bundet,
handler rådgivningen om at få de vilkår der IKKE allerede er dækket, skrevet eksplicit ind —
ikke om at gentage vilkår der allerede er der.
Kendte store selskaber (SF Film, Nordisk Film, DR, TV 2, Zentropa) behøver normalt ikke nævnes.

A-LØN vs. LEVERANDØRKONTRAKT — se KONTRAKTFAKTA øverst for denne kontrakts type.

AI-klausul og TDM:
- Eksplicit TDM-forbehold til ophavsmanden: POSITIVT (ophavsretslovens § 11b)
- TDM-ret til producenten uden aftale: KRITISK
- Ingen TDM-nævnelse: advarsel

Royalty:
- 1,5% af nettoindtægter er STANDARD for FAF dokumentar — flagger ALDRIG som lavt
- Anbefal ALDRIG højere sats — det er branchepolitisk følsomt
- Anbefal ALDRIG fjernelse af royalty-klausul

Tavshedspligt og selvpromovering:
- Acceptabel hvis kontrakten andetsteds giver ret til egenpromotion
- Flagger kun som problematisk hvis der INGEN promoveringsundtagelse er

Kontraktlæsning generelt:
- Læs altid kontrakten som helhed — klausuler vurderes i sammenhæng
- Undgå at flage samme forhold to gange

──────────────────────────────────────────────────────────────────────
STANDARD-NAVNGIVNING OG FORMULERINGER:
──────────────────────────────────────────────────────────────────────

OPSIGELSESKLAUSULER:
1. Asymmetrisk opsigelsesklausul (type: advarsel)
   Standardformulering: "Samarbejdet kan bringes til ophør af begge parter med et varsel på [X] dage, såfremt en af parterne væsentligt misligholder sine forpligtelser."

2. Manglende opsigelsesvarsel (type: kritisk)
   Standardformulering: "Aftalen kan opsiges skriftligt af begge parter med [X] dages varsel."

3. Manglende sygdomsbestemmelse — leverandørkontrakt (type: advarsel)
   Standardformulering: "I tilfælde af sygdom af mere end 2 ugers varighed kan aftalen opsiges af begge parter med 4 ugers skriftligt varsel."

RETTIGHEDSKLAUSULER:
4. Manglende Copydan-forbehold (type: kritisk)
   — udløs KUN hvis forbeholdet reelt ikke står nogen steder. Ved De4-standardformular / henvisning
     til De4-overenskomsten ER det dækket → i stedet et POSITIVT punkt, ikke en mangel.
5. Manglende streaming-/SVOD-forbehold (type: kritisk)
   — samme forbehold: dækket ved De4-standardformular / De4-henvisning → POSITIVT punkt.
     Udløs primært ved FAF-standardformular eller kontrakt uden standardformular.
6. Manglende promoveringsret (type: advarsel)
7. Manglende TDM/AI-klausul (type: advarsel)
8. Overenskomstinkorporering i leverandørkontrakt (type: advarsel)

SKADESLØSHOLDELSE:
9. Skadesløsholdelse ved skattemæssig omklassificering (type: advarsel)
   Standardformulering: "Leverandøren holder Producenten skadesløs, såfremt Producenten måtte blive afkrævet erstatning som direkte følge af at Leverandøren aktivt har vildledt Producenten om sin skattemæssige status."

FORSIKRING:
10. Forsikringspligt og selvrisiko (type: info) — informerende, ikke alarmistisk

BETALINGSKLAUSULER:
12. Manglende betalingsfrekvens (type: advarsel)
13. Månedlig betaling (type: info) — anbefal 14-dages acontocyklus

A-LØNSKONTRAKT:
14. BETA-fond og helligdagsbetaling (type: info)
    Hent satser UDELUKKENDE fra AKTUELLE SATSER øverst. Aldrig hardcodede tal.

PENSION MANGLER — BEREGNING SOM FORHANDLINGSARGUMENT (type: kritisk/advarsel):
    Gælder BÅDE leverandørkontrakter OG A-lønskontrakter uden overenskomstdækning.
    Inkludér beregning i feedbackpunktet: "Kontrakten nævner ikke pension. Det svarer til at du mister ca. [løn × pensionsprocent] kr./uge — over [X uger] er det ca. [total] kr."
    Brug pensionsprocent fra AKTUELLE SATSER.
    A-løn: pension = løn/uge × pensionsprocent
    Leverandør: grundløn = honorar/uge ÷ (1 + feriepengeprocent) → pension = grundløn × pensionsprocent

KREDITERING:
15. Kreditering — aftalte titel (type: info)
    ALTID inkluderet — klipperen skal vide præcist hvad der er aftalt.

GENERELLE REGLER:
- Brug ALTID standardtitlerne ovenfor — aldrig kontraktens egne afsnitstitler
- Max 12 feedbackpunkter
- Hold beskrivelse og anbefaling under 200 tegn

Finansiering og likviditet:
- Uafklaret distributionsaftale: info-punkt med fokus på likviditetsrisiko — kræv IKKE at den er på plads
- Anbefal altid 14-dages acontobetalinger ved manglende betalingsfrekvens

Klausuler der IKKE skal flagges:
- Forbud mod økonomiske dispositioner uden godkendelse
- Standard loyalitetsklausuler og konkurrenceforbud under ansættelsen
- Krav om at arbejde på producentens udstyr
- Manglende underskrifter — kontrakten er foreløbig

VIGTIGT: Kopiér EKSAKT tekststreng fra kontrakten i citat-feltet.
VIGTIGT: Returner KUN JSON — ingen tekst hverken før eller efter.
VIGTIGT: Brug ALDRIG "normalt indgår", "typisk ses" eller lignende uden konkret kildereference.
VIGTIGT: Brug ALDRIG "branchepraksis" uden at referere til konkret kilde.

──────────────────────────────────────────────────────────────────────
REFERENCEDOKUMENTER — BRUG AKTIVT VED KONTRAKTGENNEMGANG:
──────────────────────────────────────────────────────────────────────
`

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
    entityId?: string | null
    actorUserId?: string | null
    source?: "portal" | "admin" | "api" | "cron" | "import"
    // Provider og model bestemmes altid server-side fra ai_runtime_settings.
}

export type AnalyseOutput = {
    result: any
    contractText: string
    klassifikation: Klassifikation | null
    risk_level: "LAV" | "MELLEM" | "HØJ" | null
    should_escalate: boolean
}

// ── Kerneanalyse-funktion ─────────────────────────────────────

export async function analyserKontrakt(input: AnalyseInput): Promise<AnalyseOutput> {
    const {
        fileBuffer,
        fileName,
        memberName,
        contractType,
        productionType,
        distributionChannels = [],
        producerName,
        producerOverenskomst,
        focusAreas = [],
        notes,
        orgId,
        entityId,
        actorUserId,
        source,
    } = input

    const runtimeConfig = await getAiRuntimeConfig("contract_advice")
    const { provider, model } = runtimeConfig

    const filename = fileName.toLowerCase()

    // ── Udtræk tekst ──────────────────────────────────────────
    let contractText = ""
    let returnText = ""

    if (filename.endsWith(".docx") || filename.endsWith(".doc")) {
        contractText = await extractWordText(fileBuffer, fileName)
        if (!contractText.trim()) {
            throw new Error("Ingen tekst fundet i Word-filen.")
        }
        returnText = contractText.slice(0, 60000)
    } else if (filename.endsWith(".txt")) {
        contractText = fileBuffer.toString("utf-8")
        returnText = contractText.slice(0, 60000)
    } else if (filename.endsWith(".pdf")) {
        try { contractText = await extractPdfText(fileBuffer) } catch { contractText = "" }
        if (!contractText.trim()) {
            throw new Error("PDF'en indeholder ikke læsbar tekst, der kan maskeres før AI-analyse.")
        }
        returnText = contractText.slice(0, 60000)
    } else {
        throw new Error("Ikke-understøttet filformat. Brug PDF, DOC, DOCX eller TXT.")
    }

    const runId = await createAiUsageRun({ orgId, operationType: "contract_advice", entityType: "contract_review", entityId, actorUserId, source: source ?? "api" })

    // ── Hent reference docs (brug admin-klient — ingen cookie-kontekst nødvendig) ──
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseServiceKey()
    )
    const { data: refDocs } = await supabaseAdmin
        .from("reference_docs")
        .select("doc_subtype, file_name, title, content_text, owner")
        .eq("archived", false)
        .not("content_text", "is", null)

    // ── Trin 1: Klassificér med den valgte rådgivningsmodel ──
    let klassifikation: Klassifikation | null = null
    const tekstTilKlassifikation = contractText ? maskSensitiveData(contractText) : (filename.endsWith(".pdf") ? "[Scannet PDF]" : "")
    try {
        klassifikation = await klassificerKontrakt(tekstTilKlassifikation, provider, model, {
            runId, orgId, useCase: "contract_advice", stage: "classification",
        })
        logInfo("analyse", "Klassifikation gennemført", {
            kontrakttype: klassifikation.kontrakttype,
            overenskomst: klassifikation.er_overenskomst,
        })
    } catch (e) {
        logWarn("analyse", "Klassifikation fejlede, fortsætter uden", { error: errorMessage(e) })
    }

    // ── Hent DB-satser baseret på klassifikation (dato-bevidst) ──
    let dbSatser: Array<{ beskrivelse: string; vaerdi: number; enhed: string }> = []
    try {
        const overenskomstNavn = klassifikation?.overenskomst_navn ?? "de4-fiktion"
        const kontraktdato = klassifikation?.kontraktdato ?? null
        const versionResult = await resolveAgreementByDate(overenskomstNavn, kontraktdato)
        if (versionResult.found) {
            dbSatser = await getAgreementSatserForContext(versionResult.code)
        } else {
            logWarn("analyse", "Ingen overenskomstversion fundet til sats-hentning", {
                overenskomst: overenskomstNavn,
                kontraktdato,
                reason: versionResult.reason,
            })
        }
    } catch (e) {
        logWarn("analyse", "Sats-hentning fejlede", { error: errorMessage(e) })
    }

    // ── Hent godkendte eksempler ──────────────────────────────
    let godkendteEksempler: Array<{
        kontrakttype: string
        er_overenskomst: boolean
        ai_analyse: any
        feedbackmail: string | null
        noter: string | null
    }> = []
    if (klassifikation) {
        try {
            const admin = createAdminClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!
            )
            const { data: eksempler } = await admin
                .from("case_learnings")
                .select("kontrakttype, er_overenskomst, ai_analyse, feedbackmail, noter")
                .eq("kilde_type", "godkendt_eksempel")
                .eq("kontrakttype", klassifikation.kontrakttype)
                .eq("er_overenskomst", klassifikation.er_overenskomst)
                .order("created_at", { ascending: false })
                .limit(2)
            godkendteEksempler = eksempler ?? []
        } catch (e) {
            logWarn("analyse", "Eksempel-hentning fejlede", { error: errorMessage(e) })
        }
    }

    // ── Kontekstblok fra upload-parametre ────────────────────
    const overenskomstStatus =
        producerOverenskomst === "true"  ? "Ja (registreret i DFKS-database)" :
        producerOverenskomst === "false" ? "Nej (registreret i DFKS-database)" :
        "Ukendt"

    // Tjek om producenten er underselskab af et ProF-medlem.
    // Bruger admin-klienten — findParentMember rammer RLS-beskyttede tabeller
    // og browser-klienten har ingen session server-side.
    let parentMemberName: string | null = null
    if (producerName && producerOverenskomst !== "true") {
        try {
            parentMemberName = await findParentMember(producerName, supabaseAdmin)
        } catch (e) {
            logWarn("analyse", "Moderselskabs-opslag fejlede", { error: errorMessage(e) })
        }
    }

    // Hvis producenten er underselskab, behandles de som overenskomstbundne
    const effectiveOverenskomstStatus = parentMemberName
        ? `Ja — underselskab af ${parentMemberName} (ProF-medlem)`
        : overenskomstStatus

    // Autoritativ overenskomst-afgørelse — samme præcedens som byggAbsolutteRegler():
    // moderselskabs-binding → DFKS-flag fra uploaden → klassifikatorens gæt.
    const overenskomstResolvedFlag: boolean | null =
        producerOverenskomst === "true" ? true :
        producerOverenskomst === "false" ? false :
        null
    const erOverenskomstDaekket: boolean = parentMemberName != null
        ? true
        : (overenskomstResolvedFlag ?? klassifikation?.er_overenskomst === true)

    // ── Fravalg ved overenskomst-kontrakter ───────────────────
    // En notering markeret "Fravalgt ved overenskomst-kontrakter" i AI-
    // kontrolrummet skal ikke injiceres når kontrakten er en A-lønskontrakt
    // hvor overenskomsten reelt er bindende (ProF-bundet producent eller
    // underselskab heraf). Der gælder overenskomstens egne vilkår, og DFKS-
    // indsatser rettet mod leverandør-/ikke-overenskomstkontrakter må ikke
    // flyde ind over det område. Bemærk: at kontrakten blot HENVISER til en
    // overenskomst er ikke nok — er producenten ikke bundet, skal indsatserne
    // netop gælde.
    const erAloenUnderOverenskomst =
        klassifikation?.kontrakttype === "a-loen" && erOverenskomstDaekket

    const noteringGaelder = (n: { exclude_for_overenskomst?: string[] | null }) =>
        !erAloenUnderOverenskomst || !(n.exclude_for_overenskomst?.length)

    // ── Hent aktiv-indsats- og altid-noteringer ───────────────
    let aktivIndsatsNoteringer: Array<{ title: string; body: string }> = []
    let altidNoteringer: Array<{ title: string; body: string }> = []
    try {
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
        const { data: noter } = await admin
            .from("legal_notes")
            .select("title, body, priority, exclude_for_overenskomst")
            .in("priority", ["aktiv-indsats", "altid"])
            .eq("active", true)
        const gaeldende = (noter ?? []).filter(noteringGaelder)
        aktivIndsatsNoteringer = gaeldende.filter(n => n.priority === "aktiv-indsats")
        altidNoteringer = gaeldende.filter(n => n.priority === "altid")
    } catch (e) {
        logWarn("analyse", "Notering-hentning fejlede", { error: errorMessage(e) })
    }

    const contextBlock = (contractType || productionType || producerName) ? `
KONTRAKTTYPE: ${contractType ?? "ukendt"}
PRODUKTIONSTYPE: ${productionType ?? "ukendt"}
DISTRIBUTIONSKANALER: ${distributionChannels.length ? distributionChannels.join(", ") : "ukendt"}
PRODUCER: ${producerName ?? "ukendt"}
PRODUCER OVERENSKOMSTBUNDET: ${effectiveOverenskomstStatus}
${parentMemberName ? `VIGTIGT: Producenten er underselskab af ${parentMemberName} som er ProF-medlem. Producenten er derfor juridisk forpligtet af overenskomsterne på samme måde som moderselskabet.` : ""}
${focusAreas.length > 0 ? `FOKUSOMRÅDER: ${focusAreas.join(", ")}` : ""}
${notes ? `SÆRLIGE BEMÆRKNINGER: ${notes}` : ""}

Anvend ovenstående til at:
1. Vælge korrekt overenskomst baseret på produktionstype og ansættelsesform
2. Vurdere producerens forpligtelser baseret på overenskomststatus
3. Vurdere streaming- og genvisningsklausuler i lyset af de angivne distributionskanaler
4. Prioritere feedback inden for de angivne fokusområder
5. Kalibrere hvad der er "standard" vs. "kritisk" for denne kontrakttype

VIGTIGT: Hvis kontraktteksten er på engelsk, skal hele dit svar — inkl. feedback,
anbefalinger og juridiske referencer — leveres på engelsk.
` : ""

    // ── Byg system prompt ─────────────────────────────────────
    let activeSystemPrompt = ""

    if (aktivIndsatsNoteringer.length > 0) {
        activeSystemPrompt +=
            "──────────────────────────────────────────────────────────────────────\n" +
            "⚑ AKTIVE DFKS-INDSATSER — HØJESTE PRIORITET:\n" +
            "──────────────────────────────────────────────────────────────────────\n" +
            "Disse punkter er genstand for en aktiv DFKS-indsats lige nu. Du SKAL:\n" +
            "1. Altid tjekke kontrakten for disse forhold — uanset om kontrakten er tavs eller eksplicit.\n" +
            "2. Altid kommentere på dem i feedbackmailen — positivt hvis kontrakten håndterer det korrekt, negativt hvis den er tavs eller afviger.\n" +
            "3. Nævne eksplicit i mailen at DFKS p.t. kører en målrettet indsats på netop dette punkt, fx: \"Vi har i øjeblikket særligt fokus på ...\". Forklar kort hvorfor.\n\n" +
            aktivIndsatsNoteringer.map(n => `AKTIV INDSATS: ${n.title} — ${n.body}`).join("\n\n") +
            "\n\n"
    }

    if (altidNoteringer.length > 0) {
        activeSystemPrompt +=
            "──────────────────────────────────────────────────────────────────────\n" +
            "DFKS AKTIVE NOTERINGER — KOMMENTER ALTID PÅ DISSE I FEEDBACKMAILEN:\n" +
            "──────────────────────────────────────────────────────────────────────\n" +
            altidNoteringer.map(n => `ALTID KOMMENTER: ${n.title} — ${n.body}`).join("\n\n") +
            "\n\n"
    }

    if (godkendteEksempler.length > 0) {
        activeSystemPrompt +=
            "══════════════════════════════════════════════════════════════════════\n" +
            "GODKENDTE EKSEMPLER FRA DFKS-JURISTER — BRUG SOM REFERENCE:\n" +
            "══════════════════════════════════════════════════════════════════════\n" +
            godkendteEksempler.map(e =>
                `Kontrakttype: ${e.kontrakttype}\n` +
                `Overenskomst: ${e.er_overenskomst ? "ja" : "nej"}\n` +
                `Note: ${e.noter ?? "ingen"}\n` +
                `Analysepunkter: ${JSON.stringify(
                    (e.ai_analyse as any)?.feedbackpunkter?.map((f: any) => f.titel)
                )}\n` +
                (e.feedbackmail
                    ? `Eksempel på feedbackmail:\n${e.feedbackmail.slice(0, 800)}`
                    : "")
            ).join("\n\n") +
            "\n\n"
    }

    if (klassifikation) {
        activeSystemPrompt += byggAbsolutteRegler(klassifikation, dbSatser, distributionChannels, {
            resolved: overenskomstResolvedFlag,
            parentMemberName,
        }) + "\n\n"
    } else if (dbSatser.length > 0) {
        activeSystemPrompt +=
            "AKTUELLE SATSER FRA DATABASE — BRUG KUN DISSE TAL:\n" +
            dbSatser.map(s => `${s.beskrivelse}: ${s.vaerdi} ${s.enhed}`).join("\n") +
            "\n\n"
    }

    activeSystemPrompt += BASE_SYSTEM_PROMPT

    activeSystemPrompt +=
        "\n\n──────────────────────────────────────────────────────────────────────\n" +
        "FEW-SHOT EKSEMPLER FRA DFKS SAGSBEHANDLING:\n" +
        "──────────────────────────────────────────────────────────────────────\n" +
        FEW_SHOT_EXAMPLES +
        "\n\n" + TONE_REGLER

    if (refDocs?.length) {
        for (const doc of refDocs) {
            if (!doc.content_text) continue
            activeSystemPrompt += `\n\n${doc.doc_subtype ?? doc.file_name ?? doc.title}:\n${doc.content_text}`
        }
    }

    // RAG-kontekst
    const ragText = maskSensitiveData(contractText).slice(0, 8000)
    if (ragText.trim()) {
        try {
            if (!orgId) throw new Error("Kontraktanalyse kræver en organisation.")
            const resolvedOrgId = orgId
            const kontekst = await hentKontekst(ragText, resolvedOrgId, {
                runId, orgId: resolvedOrgId, useCase: "contract_advice", stage: "embedding",
            })

            if (kontekst.aftaleGrundlag.length > 0) {
                activeSystemPrompt +=
                    "\n\n──────────────────────────────────────────────────────────────────────\n" +
                    "GODKENDT AFTALEGRUNDLAG FRA AI-KONTROLRUMMET:\n" +
                    "──────────────────────────────────────────────────────────────────────\n" +
                    "Dette er sammenligningskilder, ikke bevis for at kontrakten er omfattet. Kontrollér altid henvisning, produktionstype, funktion, dato og ansættelsesform. En leverandørkontrakt bliver ikke dækket alene ved at nævne en overenskomst. Brug kun en sats, når den matcher kontrakten; ellers beskriv usikkerheden.\n\n" +
                    kontekst.aftaleGrundlag.map(agreement => {
                        const wageLines = agreement.wages.length
                            ? agreement.wages.map(wage => `Løn: ${wage.professionRole}${wage.wageGroup ? ` (${wage.wageGroup})` : ""}: ${wage.amount.toLocaleString("da-DK")} kr. pr. ${wage.unit}, gyldig ${wage.validFrom}${wage.validTo ? `–${wage.validTo}` : " og frem"}. Kilde: ${wage.sourceTitle} (${wage.sourceUrl}).${wage.sourceNote ? ` ${wage.sourceNote}` : ""}`).join("\n")
                            : "Løn: Ingen godkendt, dato- og funktionsmatchende minimumssats i registeret."
                        const pensionLines = agreement.pensions.length
                            ? agreement.pensions.map(pension => `Pension: ${pension.employmentForm}, arbejdsgiver ${pension.employerPercent}%${pension.employeePercent > 0 ? ` + medarbejder ${pension.employeePercent}%` : ""} af ${pension.basis}; ${pension.sectionReference}; gyldig ${pension.validFrom}${pension.validTo ? `–${pension.validTo}` : " og frem"}.${pension.sourceNote ? ` ${pension.sourceNote}` : ""}`).join("\n")
                            : "Pension: Ingen godkendt, dato- og ansættelsesformsmatchende regel i registeret."
                        return `${agreement.title} (${agreement.validFrom ?? "ukendt start"}${agreement.validTo ? `–${agreement.validTo}` : ""})\nOfficiel kilde: ${agreement.sourceUrl ?? "ikke registreret"}\n${wageLines}\n${pensionLines}${agreement.notes ? `\nBemærkning: ${agreement.notes}` : ""}`
                    }).join("\n\n")
            }

            if (kontekst.kategorier.length > 0) {
                activeSystemPrompt +=
                    "\n\n──────────────────────────────────────────────────────────────────────\n" +
                    `OVERENSKOMST-SATSER (${kontekst.detekteredeOverenskomster.join(", ").toUpperCase()}):\n` +
                    "──────────────────────────────────────────────────────────────────────\n" +
                    kontekst.kategorier.map(c => {
                        const sats = (c.metadata as any)?.sats
                        return `${c.kilde_titel}${sats ? ` (${sats})` : ""}:\n${c.tekst}`
                    }).join("\n\n")
            }
            if (kontekst.overenskomstSemantisk.length > 0) {
                activeSystemPrompt +=
                    "\n\n──────────────────────────────────────────────────────────────────────\n" +
                    "OVERENSKOMST-KONTEKST:\n" +
                    "──────────────────────────────────────────────────────────────────────\n" +
                    kontekst.overenskomstSemantisk.map(c => c.tekst).join("\n\n")
            }
            if (kontekst.videnbase.length > 0) {
                activeSystemPrompt +=
                    "\n\n──────────────────────────────────────────────────────────────────────\n" +
                    "LOVGRUNDLAG:\n" +
                    "──────────────────────────────────────────────────────────────────────\n" +
                    kontekst.videnbase.map(r => {
                        const meta = r.metadata as { dfks_fortolkning?: string } | null
                        const fortolkning = meta?.dfks_fortolkning
                        return `${r.kilde_titel}:\n${r.tekst}${fortolkning ? `\nDFKS fortolkning: ${fortolkning}` : ""}`
                    }).join("\n\n")
            }
            if (kontekst.mønstre.length > 0) {
                activeSystemPrompt +=
                    "\n\n──────────────────────────────────────────────────────────────────────\n" +
                    "LÆRTE REGLER FRA DFKS SAGSBEHANDLING — FØLG DISSE NØJAGTIGT:\n" +
                    "──────────────────────────────────────────────────────────────────────\n" +
                    kontekst.mønstre.map(r => `${r.titel}:\n${r.regel}`).join("\n\n")
            }
            const baggrund = kontekst.baggrund.filter(noteringGaelder)
            if (baggrund.length > 0) {
                activeSystemPrompt +=
                    "\n\n──────────────────────────────────────────────────────────────────────\n" +
                    "DFKS BAGGRUNDSVIDEN:\n" +
                    "──────────────────────────────────────────────────────────────────────\n" +
                    baggrund.map(n => `${n.title}: ${n.body}`).join("\n\n")
            }
        } catch (ragErr) {
            logWarn("analyse", "Kontekst-hentning fejlede, fortsætter uden", { error: errorMessage(ragErr) })
        }
    }

    activeSystemPrompt += "\n\n" + MAIL_FORMAT_PROMPT

    // ── Trin 2: Byg beskedindhold ─────────────────────────────
    const memberContext =
        (memberName ? `Kontrakten er indsendt af DFKS-medlemmet: ${memberName}\n\n` : "") +
        (contextBlock ? `${contextBlock}\n\n` : "")

    const maskedText = maskSensitiveData(contractText)
    const messageContent: any[] = [{
        type: "text",
        text: `${memberContext}Gennemgå denne foreløbige kontrakt og returner JSON:\n\n${maskedText.slice(0, 45000)}`,
    }]

    // ── Trin 2: Kald AI ───────────────────────────────────────
    const textBlock = messageContent.find((block: { type: string; text?: string }) => block.type === "text")
    const userMessage = textBlock?.text ?? "Gennemgå den vedhæftede kontrakt og returner JSON."
    const googleParts: Array<{ text: string }> = []
    for (const block of messageContent as Array<{ type: string; text?: string }>) {
        if (block.type === "text") googleParts.push({ text: block.text ?? "" })
    }
    let raw: string
    try {
        raw = (await callAiDetailed({
            provider,
            model,
            system: activeSystemPrompt,
            userMessage,
            anthropicContent: messageContent,
            googleParts,
            maxTokens: 16000,
            responseJson: true,
            promptCaching: runtimeConfig.promptCachingEnabled,
            usageContext: { runId, orgId, useCase: "contract_advice", stage: "advice" },
        })).text
    } catch (error) {
        await finishAiUsageRun(runId, "failed", error instanceof Error ? error.message : "provider_error")
        throw error
    }

    // ── Parse JSON ────────────────────────────────────────────
    const clean = raw
        .replace(/^\s*```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim()

    let parsed: any
    try {
        parsed = JSON.parse(clean)
    } catch {
        const first = clean.indexOf("{")
        const last = clean.lastIndexOf("}")
        if (first !== -1 && last !== -1) {
            try { parsed = JSON.parse(clean.slice(first, last + 1)) } catch { /* falder igennem */ }
        }
        if (!parsed) {
            logWarn("analyse", "AI returnerede ugyldigt JSON", { rawLength: raw.length })
            await finishAiUsageRun(runId, "failed", "invalid_json")
            throw new Error("AI returnerede ugyldigt svar — prøv igen")
        }
    }

    // ── Navnetjek mod DFKS-register ──────────────────────────
    const rightsHolderName: string | null =
        (klassifikation?.membres_fornavn && klassifikation?.membres_efternavn)
            ? `${klassifikation.membres_fornavn} ${klassifikation.membres_efternavn}`.trim()
            : memberName ?? null

    if (rightsHolderName) {
        try {
            const navneTjek = await tjekNavn(rightsHolderName, contractText || undefined, orgId)
            if (navneTjek.feedbackpunkt && navneTjek.status !== "match") {
                parsed.feedbackpunkter = [
                    ...(parsed.feedbackpunkter ?? []),
                    navneTjek.feedbackpunkt,
                ]
            }
        } catch (e) {
            logWarn("analyse", "Navnetjek fejlede", { error: errorMessage(e) })
        }
    }

    // ── Risikovurdering ───────────────────────────────────────
    const VALID_RISK = ["LAV", "MELLEM", "HØJ"] as const
    type RiskLevel = typeof VALID_RISK[number]

    const rawRisk = String(parsed.risk_level ?? "").toUpperCase().trim()
    const riskLevel: RiskLevel | null = VALID_RISK.includes(rawRisk as RiskLevel)
        ? (rawRisk as RiskLevel)
        : parsed.samlet_vurdering === "kritisk" ? "HØJ"
        : parsed.samlet_vurdering === "forbehold" ? "MELLEM"
        : parsed.samlet_vurdering === "godkendt" ? "LAV"
        : null

    const shouldEscalate: boolean =
        typeof parsed.should_escalate === "boolean" ? parsed.should_escalate
        : riskLevel === "HØJ"

    // Rens mailtekst for risikovurdering AI kan skrive som fritekst
    if (parsed.feedbackmail?.tekst) {
        parsed.feedbackmail.tekst = parsed.feedbackmail.tekst
            .replace(/Overordnet vurdering\s*:.*?(JA|NEJ|LAV|MELLEM|HØJ)[^\n]*/gi, "")
            .replace(/Risikoniveau\s*:?\s*(LAV|MELLEM|HØJ)[^\n]*/gi, "")
            .replace(/Skal eskaleres\s*:?\s*(JA|NEJ)[^\n]*/gi, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
    }

    await finishAiUsageRun(runId, "succeeded")
    return {
        result: parsed,
        contractText: returnText,
        klassifikation,
        risk_level: riskLevel,
        should_escalate: shouldEscalate,
    }
}
