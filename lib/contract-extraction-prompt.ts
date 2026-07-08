import { SOURCES_SCHEMA_PROMPT } from "@/lib/ai-sources"
import {
    CONTRACT_TYPE_RULE,
    COLLECTIVE_AGREEMENT_RULE,
    COLLECTIVE_AGREEMENT_BY_REFERENCE_RULE,
    IS_FREELANCE_CONTRACT_RULE,
    HOLIDAY_PAY_RATE_RULE,
    BETA_RATE_RULE,
} from "@/lib/ai-fields"

// Fælles model for AL kontrakt-udtræk, så batch-læsning (jobs/process →
// contracts/extract) og manuel re-læsning (validate/extract) giver samme
// kvalitet. Tidligere brugte de to ruter forskellige modeller.
export const CONTRACT_EXTRACTION_MODEL = "claude-sonnet-4-6"

export const CONTRACT_EXTRACTION_SYSTEM_PROMPT = `Du er ekspert i at udtrække strukturerede data fra danske filmkontrakter.
Din opgave er at læse kontrakten og returnere et JSON-objekt med præcis de felter der er angivet.
Vær præcis — brug null for felter der ikke fremgår af kontrakten. Brug aldrig gæt.
Returner KUN JSON — ingen forklaringstekst.

VIGTIGT — Maskerede tokens: Kontraktteksten er forbehandlet og personoplysninger er erstattet med tokens:
[CPR-NUMMER], [KONTONUMMER], [IBAN], [TELEFON], [EMAIL], [ADRESSE], [POSTNR-BY], [CVR-NUMMER].
Disse tokens er IKKE de faktiske værdier — returner null for felter der kun indeholder et token uden anden kontekst.
Navne (personnavne og firmanavne) maskeres IKKE og fremgår fuldt ud af teksten.`

export const CONTRACT_EXTRACTION_SCHEMA_PROMPT = `Udtræk følgende data fra denne kontrakt og returner som JSON.
Returner KUN JSON — ingen forklaringstekst.

{
  "employerName": "producentens/arbejdsgiverens FIRMANAVN — juridisk kontraktpart, aldrig rent personnavn (string | null)",
  "parentCompanyName": "moderselskabets firmanavn hvis adskilt fra employerName (string | null)",
  "rightsHolderName": "klipperens/medarbejderens/leverandørens fulde PERSONNAVN, aldrig firmanavn (string | null)",
  "workTitle": "produktionens/filmens titel (string | null)",
  "director": "instruktørens fulde navn hvis det fremgår (string | null)",
  "duration": "værkets varighed i minutter som tal, hvis det fremgår (number | null)",
  "premiereYear": "premiereår eller produktionsår som firecifret årstal, hvis det fremgår (number | null)",
  "creditedFunction": "krediteret funktion: klipper, b-klipper, supplerende klipper, fotograf, instruktør, scenograf, Andet eller null",
  "contractType": "${CONTRACT_TYPE_RULE}",
  "overenskomst": "én af: de4-fiktion, faf, faf-dokumentar, dj, metal, ingen (string | null)",
  "contractDate": "kontraktens dato ISO 8601 (string | null)",
  "startDate": "ansættelsens startdato ISO 8601 (string | null)",
  "endDate": "ansættelsens slutdato ISO 8601 (string | null)",
  "productionType": "én af: feature, tvSeries, documentary, docSeries, short, tvEntertainment, reality, other. Hvis kontrakten nævner afsnit/episode/sæson → tvSeries eller docSeries.",
  "workingDays": "antal arbejdsdage/klippedage som tal. Hvis kun uger fremgår, brug uger * 5. Hvis uklart, null. (number | null)",
  "workingWeeks": "antal arbejdsuger som tal. Dage divideres med 5, måneder multipliceres med 4,33. (number | null)",

  "salary": "UGELØN som tal uden valuta (number | null). Regler: eksplicit ugepris vinder; dagssats * 5; timesats * 37 medmindre 40 timer/uge står tydeligt; lump sum kun hvis periode er tydelig; ignorer moms/subtotal/fakturatotal/feriepenge/sociale omkostninger; tillæg lægges ikke oven i grundløn.",
  "salaryUnit": "weekly hvis salary er en ugeløn. Brug kun monthly, daily eller total hvis ugeløn ikke kan beregnes. (string | null)",
  "salarySourceType": "én af: weekly, daily_converted, hourly_converted, lump_calculated, invoice_line, unknown",
  "salaryConfidence": "én af: high, medium, low",
  "salaryNote": "kort forklaring på hvordan salary er fundet eller hvorfor den er null (string | null)",
  "needsManualSalaryReview": "true hvis OCR er tom/ulæselig, beløb er modstridende, periode mangler, eller løn ikke kan bestemmes sikkert (boolean)",
  "pensionPercent": "pensionsprocent som tal (number | null)",
  "pensionSupplement": "pensionssupplement i kr. som tal (number | null)",
  "personalSupplement": "personligt tillæg som tal i kr. hvis konkret aftalt (number | null)",
  "loentillaeg": "løntillæg/personligt tillæg som tal i kr. hvis det fremgår; ellers null. Må ikke lægges oven i salary. (number | null)",
  "otherSupplements": "andre tillæg der ikke kan udtrykkes som et enkelt tal. Fritekst. (string | null)",
  "holidayPayRate": "${HOLIDAY_PAY_RATE_RULE}",
  "betaRate": "${BETA_RATE_RULE}",

  "svod": "har kontrakten SVOD/streaming-rettigheder? (boolean)",
  "copydan": "true ved Copydan, aftalelicens, privatkopiering, kollektivt forvaltningsselskab, §§ 13, 13a, 17, 30a, 35, 39-46a, 50 stk. 2 eller lignende vederlagsforbehold. (boolean)",
  "royalty": "ALDRIG true automatisk. Kun true hvis kontrakten eksplicit aftaler individuel royaltybetaling i procent eller kr. til medarbejderen personligt. Copydan og Create Denmark/SVOD tæller ikke som royalty. (boolean)",
  "royaltyPercent": "royaltyprocent som tal (number | null)",
  "aiDataMiningClause": "har kontrakten AI/data mining-forbehold? (boolean)",
  "futureRightsReservation": "har kontrakten forbehold for fremtidige udnyttelsesformer/data/AI-rettigheder der ikke er erhvervet af producenten? (boolean)",
  "rightsOverview": "kort JSON-venlig oversigt med nøglerne overenskomst, kreditering, copydanforbehold, streamingforbehold. Værdier: ja, nej, implicit via overenskomst eller uklart.",
  "distribution": "distributionsplatforme kommasepareret (string | null)",

  "collectiveAgreement": "${COLLECTIVE_AGREEMENT_RULE}",
  "collectiveAgreementName": "overenskomstens navn (string | null)",
  "collectiveAgreementByReference": "${COLLECTIVE_AGREEMENT_BY_REFERENCE_RULE}",
  "isFreelanceContract": "${IS_FREELANCE_CONTRACT_RULE}",
  "hasCreditClause": "er der en krediteringsklausul? (boolean)",
  "hasTerminationClause": "er der en opsigelsesklausul? (boolean)",
  "terminationDaysEditor": "klipperens opsigelsesvarsel i dage (number | null)",
  "terminationDaysProducer": "producentens opsigelsesvarsel i dage (number | null)",
  "hasIndemnification": "er der en skadesløsholdelsesklausul? (boolean)",
  "hasOverenskomstIncorporation": "er overenskomst inkorporeret i leverandørkontrakt? (boolean)",
  "specialNotes": "særlige bemærkninger der bør noteres (string | null)",

${SOURCES_SCHEMA_PROMPT}
}`

export function buildContractExtractionPrompt(referenceDocs?: Array<{ title: string; doc_subtype: string | null; content_text: string | null }>) {
    let prompt = `${CONTRACT_EXTRACTION_SYSTEM_PROMPT}\n\n${CONTRACT_EXTRACTION_SCHEMA_PROMPT}`
    if (referenceDocs?.length) {
        prompt += "\n\n──────────────────────────────────────\nREFERENCEDOKUMENTER — BRUG SOM BAGGRUNDSVIDEN:\n──────────────────────────────────────"
        for (const doc of referenceDocs) {
            if (!doc.content_text) continue
            prompt += `\n\n${doc.doc_subtype ?? doc.title}:\n${doc.content_text}`
        }
    }
    return prompt
}
