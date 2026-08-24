import { SOURCES_SCHEMA_PROMPT } from "@/lib/ai-sources"
import type { ContractLayout } from "@/lib/contract-layout"
import {
    CONTRACT_TYPE_RULE,
    COLLECTIVE_AGREEMENT_RULE,
    COLLECTIVE_AGREEMENT_BY_REFERENCE_RULE,
    IS_FREELANCE_CONTRACT_RULE,
    HOLIDAY_PAY_RATE_RULE,
    BETA_RATE_RULE,
} from "@/lib/ai-fields"

export const CONTRACT_EXTRACTION_SYSTEM_PROMPT = `Du er ekspert i at udtrække strukturerede data fra danske filmkontrakter.
Din opgave er at læse kontrakten og returnere et JSON-objekt med præcis de felter der er angivet.
Vær præcis — brug null for felter der ikke fremgår af kontrakten. Brug aldrig gæt.
Returner KUN JSON — ingen forklaringstekst.

VIGTIGT — Maskerede tokens: Kontraktteksten er forbehandlet og personoplysninger er erstattet med tokens:
[CPR-NUMMER], [KONTONUMMER], [IBAN], [TELEFON], [EMAIL], [ADRESSE], [POSTNR-BY], [CVR-NUMMER].
Disse tokens er IKKE de faktiske værdier — returner null for felter der kun indeholder et token uden anden kontekst.
Navne (personnavne og firmanavne) maskeres IKKE og fremgår fuldt ud af teksten.

KLAUSUL-ID'ER: Kontraktteksten er annoteret med klausul-ID'er indlejret direkte inline.
Hvert klausul starter med et tag på formen [s1_c14] (PDF) eller [p7] (DOCX) efterfulgt af klausulteksten.
Eksempel: "[s1_c14] A. Ugeløn. Medarbejderen modtager en grundløn på 14.637 DKK pr. uge."
Til _sources.*_clause_id felterne: kopiér tagget fra begyndelsen af den linje du citerer — det er en direkte aflæsning, ikke en gætteopgave.`

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
  "creditedFunction": "krediteret funktion: klipper, medklipper, b-klipper, supplerende klipper, klipperassistent, logger, loader, fotograf, instruktør, scenograf, Andet eller null",
  "contractType": "${CONTRACT_TYPE_RULE}",
  "overenskomst": "én af: de4-fiktion, faf-fiktion, faf-dokumentar, faf-tv-ansat, faf-tv-freelance, dj-tv, metal, ingen (string | null). Ældre eller formelle kontraktskabeloner bruger ofte organisationens fulde, formelle navn i stedet for en moderne forkortelse — genkend disse som samme organisation: FAF = \"Film- og TV-Arbejderforeningen\"; \"Kort- og dokumentarfilmoverenskomsten mellem Film- og TV-arbejderforeningen og Danske Film- og TV-Producenter\" = faf-dokumentar, uanset at ordet \"FAF\" ikke nævnes eksplicit. Match generelt på den navngivne organisations fulde, formelle navn, ikke kun på en genkendt forkortelse.",
  "agreementEmploymentForm": "én af: a-løn, lønmodtager-freelance, leverandør, unknown. Lønmodtager-freelance bruges kun når personen kaldes freelancer, men aflønnes som lønmodtager uden CVR/moms/faktura.",
  "contractDate": "kontraktens dato ISO 8601 (string | null)",
  "signatureStatus": "én af: yes, no, unknown. yes når kontrakten tydeligt er håndskrevet underskrevet, eller når PDF-teksten dokumenterer en gennemført digital/elektronisk underskrift (fx Penneo, DocuSign, Adobe Sign eller MitID-signering). Et tomt felt eller en tom underskriftslinje er no. En blot trykt navnelinje uden dokumenteret signering er unknown.",
  "signatureMethod": "én af: handwritten, digital, none, unknown. Angiv digital ved dokumenteret elektronisk signering. Håndskrift kan også blive bestemt af den lokale PDF-kontrol. (string)",
  "signatureDate": "underskriftsdato ISO 8601 hvis den fremgår (string | null)",
  "signatureEvidence": "kort evidens for underskriftsstatus uden navne eller andre personfølsomme oplysninger (string | null)",
  "signaturePage": "sidetal for evidensen som tal, hvis det kan bestemmes (number | null)",
  "startDate": "ansættelsens startdato ISO 8601 (string | null). VIGTIGT VED MANGLENDE ÅRSTAL: nogle skabeloner angiver kun dag og måned uden årstal (fx 'fra den 15. marts til den 20. juni'). Udled i så fald året ud fra kontraktens egen dato (contractDate) — brug samme år som contractDate, MEDMINDRE dag/måned tydeligvis ligger tidligere på kalenderåret end contractDate (fx kontraktdato i november, startdato i januar) — brug da det PÅFØLGENDE år i stedet. Sæt ALDRIG blot null, blot fordi årstallet ikke står eksplicit — udled det efter denne regel. Tilføj altid en kort note i specialNotes, når året er udledt frem for eksplicit angivet, så reviewer kan dobbelttjekke (fx 'Startdato: årstal udledt fra kontraktdato, ikke eksplicit angivet i kontrakten').",
  "endDate": "ansættelsens slutdato ISO 8601 (string | null). Samme regel som startDate ved manglende årstal — udled fra contractDate/startDate efter samme logik, og tilføj tilsvarende note i specialNotes hvis udledt.",
  "productionType": "én af: feature, tvSeries, documentary, docSeries, short, tvEntertainment, reality, other. Hvis kontrakten nævner afsnit/episode/sæson → tvSeries eller docSeries.",
  "seasonNumber": "sæsonnummer som positivt heltal, kun hvis det fremgår af kontrakten eller værktitlen; ellers null",
  "episodeNumbers": "sorteret liste af afsnitsnumre, kun når konkrete afsnit udtrykkeligt nævnes; ellers null. Listen er kun et AI-forslag og er ikke medlemsbekræftelse.",
  "workingDays": "antal arbejdsdage/klippedage som tal. Hvis kun uger fremgår, brug uger * 5. Hvis uklart, null. (number | null)",
  "workingWeeks": "antal arbejdsuger som tal. Dage divideres med 5, måneder multipliceres med 4,33. (number | null)",
  "prolongationWeeks": "antal EKSTRA optionsuger/prolongationsuger som tal til statistik, hvis det fremgår eksplicit eller kan beregnes sikkert (number | null). Skeln mellem ekstra uger og en samlet maksimumsramme: Hvis medarbejderen fx er engageret i 19 uger 'med mulighed for prolongation i indtil 24 uger', er 24 den samlede ramme, og prolongationWeeks er 24 - 19 = 5. Skriv beregningen i prolongationNote. Formuleringen 'op til 2 ugers prolongation' betyder derimod 2 ekstra uger. Ved dage divideres præcist med 5 UDEN afrunding: 3 dage → 0.6 uge, 4 dage → 0.8 uge, 10 dage → 2 uger.",
  "prolongationAmount": "det oprindelige prolongationstal præcis som angivet i kontrakten, uden enhedskonvertering. Eksempel: 3 ved '3 dages prolongation', 2 ved '2 ugers prolongation'. (number | null)",
  "prolongationUnit": "days når kontrakten angiver dage; weeks når den angiver uger; ellers null.",
  "prolongationTotalWeeks": "samlet maksimum for arbejdsperioden, kun når prolongationsklausulen angiver en mulig samlet slutramme; ellers null. (number | null)",
  "prolongationInterpretation": "additional når tallet klart er ekstra prolongation; total_limit når tallet fortolkes som samlet maksimum; unclear når ordlyden ikke kan afgøres sikkert.",
  "needsManualProlongationReview": "true når det kræver fortolkning at afgøre, om klausulens tal er ekstra uger eller samlet maksimum — også når du foreslår og beregner en sandsynlig værdi. Ellers false. (boolean)",
  "prolongationNote": "kort beskrivelse af prolongationsvilkåret med eventuel ferieperiode eller andre betingelser, hvis nævnt (string | null). Angiv den oprindelige enhed (dage eller uger), som den fremgår af kontrakten, uanset hvad der er udledt i prolongationWeeks.",

  "salary": "UGELØN som tal uden valuta (number | null). Regler: eksplicit ugepris vinder — ved flere linjer der summerer til en total (se otherSupplements-feltet for dette mønster), er det GRUNDLØNNEN/normallønnen, ikke totalen, der er den eksplicitte ugepris; dagssats * 5; timesats * 37 medmindre 40 timer/uge står tydeligt; lump sum kun hvis periode er tydelig; ignorer moms/subtotal/fakturatotal/feriepenge/sociale omkostninger; tillæg lægges ikke oven i grundløn. VIGTIGT — skabeloner har ofte flere alternative betalingsklausuler (fx både A. Ugeløn og B. Klumpsum), hvor kun én er udfyldt: en klausul med KUN en streg/understregning og INGEN tal efter beløbsfeltet (fx \"løn på _\" eller \"løn på ___\") er UBRUGT — brug ALDRIG en sådan klausul, uanset hvor tæt den ellers ligner en lønbestemmelse. Brug udelukkende den klausul, hvor der rent faktisk står et konkret tal i beløbsfeltet. AFGØRENDE: hvis du udregner en ugeløn fra en klumpsum/samlet honorar divideret med en tydelig periode (fx et fakturabaseret leverandørhonorar på et samlet beløb for en angivet periode i uger), SKAL det udregnede tal sættes i dette felt — sæt ALDRIG feltet til 0/null, blot fordi tallet er udregnet/afledt frem for eksplicit angivet som en ugesats. Usikkerhed om beregningen skal udtrykkes via salaryConfidence/needsManualSalaryReview, IKKE ved at udelade selve tallet her.",
  "lumpSumAmount": "kontraktens oprindelige samlede honorar/klumpsum som tal uden valuta. Udfyld kun ved klumpsum; salary skal samtidig være den beregnede ugeløn, når perioden kendes. (number | null)",
  "salaryUnit": "weekly hvis salary er en ugeløn. Brug kun monthly, daily eller total hvis ugeløn ikke kan beregnes. (string | null)",
  "salarySourceType": "én af: weekly, daily_converted, hourly_converted, lump_calculated, invoice_line, unknown",
  "salaryConfidence": "én af: high, medium, low",
  "salaryNote": "kort forklaring på hvordan salary er fundet eller hvorfor den er null (string | null)",
  "needsManualSalaryReview": "true hvis OCR er tom/ulæselig, beløb er modstridende, periode mangler, eller løn ikke kan bestemmes sikkert (boolean)",
  "pensionPercent": "pensionsprocent som tal KUN når den står udtrykkeligt i kontrakten (number | null). Udled aldrig selv satsen fra en overenskomst.",
  "pensionEmployeePercent": "medarbejderens eget pensionsbidrag som procent, kun hvis det står udtrykkeligt (number | null)",
  "pensionBasisAmount": "det konkrete løn-/honorarbeløb som kontrakten udtrykkeligt siger pensionen beregnes af (number | null)",
  "pensionSupplement": "Det KONKRETE kronebeløb pensionsbidraget udgør pr. periode, som eksplicit angivet lige efter procentsatsen i pensionsklausulen — fx '1330 DKK' i 'pensionsbidrag (9,5% af grundlønnen) 1330 DKK pr. uge'. IKKE det samme som personalSupplement (et separat, ikke-pensionsrelateret tillæg). Sæt null hvis kun procentsatsen er angivet uden et konkret beløb (fx ved en ubrugt alternativ betalingsklausul med tomt beløbsfelt — samme mønster som salary-feltets klumpsum-advarsel). (number | null)",
  "personalSupplement": "personligt tillæg som tal i kr. hvis konkret aftalt (number | null)",
  "otherSupplements": "liste over alle SÆRSKILTE ØKONOMISKE tillæg der ikke allerede er dækket af personalSupplement. Et tillæg er et beløb, som arbejdsgiveren betaler TIL medarbejderen ud over grundlønnen. UDELAD ALTID medarbejderbetalte udgifter, egenbetaling og fradrag i løn/honorar — fx kantineordning, kost, logi eller udstyr som medarbejderen selv betaler, eller som trækkes/fratrækkes i honoraret. De er ikke tillæg, heller ikke når kontrakten angiver et beløb pr. dag eller uge. Hvert tillæg som en separat post — slå ikke flere tillæg sammen. AFGØRENDE — HYPPIGT MØNSTER: lønafsnit viser ofte FLERE linjer der summerer til en samlet ugeløn (fx 'Normalløn: X, Personligt tillæg: Y, Fast tillæg for over-/forskudttid: Z, Således samlet ugeløn: X+Y+Z'). I så fald er det IKKE nok kun at sætte salary til totalbeløbet — HVER linje ud over selve grundlønnen SKAL udtrækkes som sin egen post her (personligt tillæg → personalSupplement-feltet; alt andet → en post i denne liste). Undlad ALDRIG at udtrække en linje blot fordi den indgår i en sum. For hvert tillæg: category (overtidstillaeg=fast aftalt overtidskompensation, herunder et fast samlet tillæg for 'over- og forskudttid', IKKE optalte timer; genetillaeg=ubekvemme tidspunkter/forskudttid/nat når tillægget ikke samtidig dækker overtid; weekend_helligdag=weekend eller helligdag, IKKE sammenlagt med genetillaeg; rejsetillaeg=rejsegodtgørelse; udetillaeg=lokationstillæg; diaeter=arbejdsgiverbetalt kost- og logigodtgørelse, ALDRIG medarbejderens egenbetaling; udstyr_telefon=arbejdsgiverbetalt udstyrs/telefongodtgørelse; preproduktion=særskilt pre-produktionstillæg; efterarbejde=særskilt betaling for FÆRDIGGØRELSE EFTER DEN PRIMÆRE KLIPNING, fx lydmix, grading, komponist, VFX, mastering eller aflevering — almindelig klipning eller ordet 'postproduktion' alene er IKKE efterarbejde; fast_uspecificeret=fast tillæg uden specificeret årsag; andet=fangkategori); amount som tal eller null; unit fx 'pr. uge', 'pr. dag', 'engangsbeløb'; note: kort begrundelse for kategorivalget når det ikke er indlysende; sourceText: citat fra kontrakten med [sX_cY]-tag forrest. (array | null)",
  "workPhases": "struktureret liste over BETALTE ELLER AFTALTE ARBEJDSFASER, kun når kontrakten konkret beskriver dem. phase: preproduction=arbejde før den primære klippeperiode; editing=selve den almindelige klippeperiode; post_edit_finishing=arbejde VED SIDEN AF ELLER EFTER den primære klipning, fx deltagelse i lydmix, grading, komponistarbejde, VFX, mastering eller aflevering. AFGØRENDE: almindelig klipning er typisk en del af postproduktionen og må ALDRIG alene klassificeres som post_edit_finishing. Ordet 'postproduktion' er derfor ikke tilstrækkeligt; der skal stå en konkret færdiggørelsesaktivitet ud over normal klipning. For hver fase: weeks som eksplicit antal uger eller null; paymentType=included_in_salary når fasen dækkes af samlet løn/klumpsum, separate_supplement ved særskilt betaling, unpaid ved udtrykkelig ulønnet deltagelse, ellers unclear; amount som eksplicit eller sikkert beregnet fasebeløb eller null; amountType=explicit/calculated eller null; note med kort begrundelse; sourceText som kontraktens fulde relevante citat med [sX_cY]-tag forrest. Opfind ikke en fase ud fra branchepraksis. (array | null)",
  "holidayPayRate": "${HOLIDAY_PAY_RATE_RULE}",
  "betaRate": "${BETA_RATE_RULE}",

  "svod": "har kontrakten en SPECIFIK SVOD-rettighedsklausul — fx en eksplicit henvisning til SVOD-rammeaftalen mellem Producentforeningen og kunstnerorganisationerne, Create Denmark, eller at produktionen er bestilt direkte til en streamingtjeneste? Svar IKKE true, blot fordi 'streamingtjenester' nævnes som ét blandt flere distributionsled i en generel/bred rettighedsoverdragelse (fx en opremsning af biograf, tv, streaming, on demand osv. som eksempler på udnyttelsesformer) — det er standard boilerplate-sprog, ikke en SVOD-aftale. (boolean)",
  "copydan": "true ved Copydan, aftalelicens, privatkopiering, kollektivt forvaltningsselskab, §§ 13, 13a, 17, 30a, 35, 39-46a, 50 stk. 2 eller lignende vederlagsforbehold. (boolean)",
  "royalty": "true hvis kontrakten eksplicit aftaler individuel royaltybetaling til medarbejderen, ELLER hvis kontrakten inkorporerer en overenskomst der indeholder royalty-bestemmelser — herunder formuleringer som 'afregner royalties til [overenskomst] jf. overenskomst' eller 'leverandøren vil være berettiget til en andel af disse royalties efter nærmere aftale'. Copydan og Create Denmark/SVOD tæller ikke som royalty. (boolean)",
  "royaltyPercent": "royaltyprocent som tal KUN hvis den fremgår eksplicit af selve kontrakten (number | null). Udled ALDRIG satsen fra en overenskomst — det håndteres deterministisk af systemet.",
  "creditedRoles": "Krediteret titel/rolle som angivet i kontrakten, fx 'Klipper', 'Film Editor', 'Supervising Editor' — kan afvige fra creditedFunction hvis kontrakten bruger en anden betegnelse. Udtræk KUN rollen, ikke personens navn: 'Der er aftalt følgende vedrørende kreditering: Klipper Sofie Steenberger' → 'Klipper'. (string | null)",
  "creditClauseStatus": "Vurder kontraktens kreditering: precise når producenten forpligtes og mindst én eksakt krediteringstitel er angivet; vague når kreditering nævnes uden titel; role_only når en arbejdsfunktion står uden krediteringsforpligtelse; conditional når kreditering afhænger af skøn, sædvanlig praksis eller andre vilkår; absent når ingen kreditering findes; ellers unclear.",
  "contractCredits": "ALLE eksakte krediteringstitler som en liste — fx 'Klipper og Konceptuerende klipper' giver TO poster. Hver post: title uden personnavn; sourceText med klausulens HELE ordlyd og [sX_cY]/[pN]-tag forrest. En stillingsbetegnelse alene er ikke en kreditering. (array | null)",
  "aiDataMiningClause": "har kontrakten AI/data mining-forbehold? (boolean)",
  "futureRightsReservation": "har kontrakten forbehold for fremtidige udnyttelsesformer/data/AI-rettigheder der ikke er erhvervet af producenten? (boolean)",
  "rightsOverview": "kort JSON-venlig oversigt med nøglerne overenskomst, kreditering, copydanforbehold, streamingforbehold. Værdier: ja, nej, implicit via overenskomst eller uklart.",
  "distribution": "distributionsplatforme kommasepareret (string | null)",

  "collectiveAgreement": "${COLLECTIVE_AGREEMENT_RULE}",
  "collectiveAgreementName": "overenskomstens navn (string | null)",
  "collectiveAgreementByReference": "${COLLECTIVE_AGREEMENT_BY_REFERENCE_RULE}",
  "agreementReferenceStatus": "én af: yes, no, unknown. yes når kontrakten direkte henviser til De4-fiktion, FAF, FAF-dokumentar, DJ TV eller Metal som aftalegrundlag; no ved en udtrykkelig afvisning; ellers unknown",
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

/** Byg klausuloversigt til AI-prompten — max 120 tegn preview per klausul. */
export function buildClauseListPrompt(layout: ContractLayout): string {
    const lines = [
        "══════════════════════════════════════",
        "KLAUSULLISTE — brug ID'erne i _sources.*_clause_id felterne:",
        "══════════════════════════════════════",
    ]
    for (const clause of layout.clauses) {
        const preview = clause.text.replace(/\n/g, " ").slice(0, 120)
        lines.push(`[${clause.id}] ${preview}`)
    }
    lines.push("══════════════════════════════════════")
    lines.push("Brug KUN ID'er fra listen ovenfor. Et ID der ikke findes i listen er ugyldigt — returner null i stedet.")
    return lines.join("\n")
}

export function buildContractExtractionPrompt(
    referenceDocs?: Array<{ title: string; doc_subtype: string | null; content_text: string | null }>,
    overenskomstChunks?: Array<{ kilde_titel: string; tekst: string; overenskomst: string | null; kategori: string | null }>,
    layout?: ContractLayout | null,
    agreementSatser?: { agreementCode: string; satser: Array<{ beskrivelse: string; vaerdi: number; enhed: string }> } | null,
) {
    let prompt = `${CONTRACT_EXTRACTION_SYSTEM_PROMPT}\n\n${CONTRACT_EXTRACTION_SCHEMA_PROMPT}`

    if (agreementSatser?.satser?.length) {
        prompt += `\n\n══════════════════════════════════════\nOVEREENSKOMST-SATSER (${agreementSatser.agreementCode.toUpperCase()}):\n══════════════════════════════════════`
        prompt += "\nDisse satser er verificerede og gælder for netop denne kontrakt. Brug dem som den autoritative kilde for løn, pension og procentsatser — aldrig hardcodede tal fra din træning:"
        for (const s of agreementSatser.satser) {
            prompt += `\n• ${s.beskrivelse}: ${s.vaerdi} ${s.enhed}`
        }
    }

    if (referenceDocs?.length) {
        prompt += "\n\n──────────────────────────────────────\nREFERENCEDOKUMENTER — BRUG SOM BAGGRUNDSVIDEN:\n──────────────────────────────────────"
        for (const doc of referenceDocs) {
            if (!doc.content_text) continue
            prompt += `\n\n${doc.doc_subtype ?? doc.title}:\n${doc.content_text}`
        }
    }

    if (overenskomstChunks?.length) {
        prompt += "\n\n══════════════════════════════════════\nOVEREENSKOMSTER — BRUG NÅR KONTRAKTEN REFERERER TIL GÆLDENDE OVERENSKOMST:\n══════════════════════════════════════"
        prompt += "\nNår en leverandørkontrakt inkorporerer overenskomstens vilkår ved reference, gælder følgende regler fra den relevante overenskomst:"
        // Gruppér chunks per overenskomst
        const grouped = new Map<string, typeof overenskomstChunks>()
        for (const chunk of overenskomstChunks) {
            const key = chunk.overenskomst ?? "ukendt"
            if (!grouped.has(key)) grouped.set(key, [])
            grouped.get(key)!.push(chunk)
        }
        for (const [ov, chunks] of grouped) {
            prompt += `\n\n── ${ov.toUpperCase()} ──`
            for (const chunk of chunks) {
                prompt += `\n\n${chunk.kilde_titel}:\n${chunk.tekst}`
            }
        }
    }

    // buildClauseListPrompt() fjernet — ID'erne er nu indlejret direkte i kontraktteksten
    // (buildAnnotatedContractText), så en separat opsummeringsliste er overflødig.

    return prompt
}
