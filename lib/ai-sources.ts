/**
 * lib/ai-sources.ts
 *
 * Single source of truth for the AI _sources field definitions.
 * Imported by lib/ai.ts (buildSystemPrompt) AND app/api/contracts/extract/route.ts.
 *
 * Tune the prompt instructions here — changes propagate to all extraction points automatically.
 */

// JSON fragment (without surrounding braces) ready to embed in a prompt template literal.
// Each field must be an EXACT quote from the contract so the PDF highlighter can locate it.
export const SOURCES_SCHEMA_PROMPT = `    "_sources": {
      "workTitle": "EKSAKT tekststreng der nævner produktionens/filmens titel — kopiér sætningen med titlen, f.eks. 'produktionen 'MIN FILM'' eller 'arbejdet med serien \"TITLEN\"' — max 80 tegn eller null",
      "salary": "EKSAKT tekststreng fra kontrakten der indeholder DET FAKTISKE, GÆLDENDE honorar — kopiér sætningen der nævner beløbet, f.eks. 'grundløn på __14.637__ DKK pr. uge' eller 'honorar på 45.000 kr. pr. måned' — max 120 tegn eller null. VIGTIGT — skabeloner har ofte flere alternative betalingsklausuler (fx både A. Ugeløn og B. Klumpsum), hvor kun én er udfyldt: en klausul med KUN en streg/understregning og INGEN tal i beløbsfeltet (fx 'løn på _' eller 'løn på ___') er UBRUGT — citér ALDRIG en sådan klausul, uanset hvor tæt den ellers ligner en lønbestemmelse. Citér udelukkende den klausul, hvor der rent faktisk står et konkret tal.",
      "salary_clause_id": "Kopiér tagget fra begyndelsen af den linje du citerer i salary — fx '[s1_c14]' → returner 's1_c14'. Direkte aflæsning fra den annoterede kontrakttekst. Null hvis teksten ikke er annoteret.",
      "pension": "EKSAKT og UNIK tekststreng der kun findes i DEN FAKTISK GÆLDENDE pensionsklausul. Citatet SKAL altid inkludere selve DKK/kr.-beløbet efter procentsatsen — stop ALDRIG ved parentesen eller lige efter procenttegnet. Et citat uden beløb er ubrugeligt, selvom det er unikt for det korrekte afsnit. Korrekt eksempel: 'pensionsbidrag (9,5 % af grundlønnen) 1330 DKK' — forkert eksempel: 'pensionsbidrag (9,5 % af grundlønnen)' (stopper for tidligt, mangler beløbet). Max 60 tegn eller null. VIGTIGT — skabeloner gentager ofte pensionsformuleringen i en alternativ klausul (fx B. Fast løn/klumpsum): en gentagelse med KUN streger/understregninger og INTET konkret beløb (fx 'pensionsbidrag (9,5 %) ___DKK') er UBRUGT — citér ALDRIG en sådan gentagelse. Citér udelukkende fra den klausul, hvor der rent faktisk står et konkret kr.-beløb.",
      "pension_clause_id": "Kopiér tagget fra begyndelsen af den linje du citerer i pension — direkte aflæsning. Null hvis ikke annoteret.",
      "supplements": "EKSAKT tekststreng der indeholder afsnittet om personlige tillæg inkl. selve beløbet — kopiér fra 'personlige tillæg' og frem til beløbet, f.eks. 'personlige tillæg: 2.500 DKK' eller 'følgende personlige tillæg:___1.586' — max 60 tegn eller null. VIGTIGT — skabeloner gentager ofte tillægsformuleringen i en alternativ klausul (fx B. Fast løn/klumpsum): en gentagelse med KUN streger/understregninger og INTET konkret beløb er UBRUGT — citér ALDRIG en sådan gentagelse. Citér udelukkende fra den klausul, hvor der rent faktisk står et konkret kr.-beløb.",
      "supplements_clause_id": "Kopiér tagget fra begyndelsen af den linje du citerer i supplements — direkte aflæsning. Null hvis ikke annoteret.",
      "otherSupplements": "EKSAKT tekststreng der indeholder afsnittet om andre tillæg (ikke personlige tillæg) — kopiér den sætning der nævner tillægget, f.eks. 'tillæg for særlige opgaver' eller 'øvrige tillæg: 500 kr.' — max 80 tegn eller null",
      "dates": "EKSAKT tekststreng der viser ansættelsesperioden — kopiér sætningen med start- og slutdato, f.eks. 'fra den 26. august til 24. november 2024' eller 'ansættelsesperioden er 01.01.2024 - 31.03.2024' — max 80 tegn eller null",
      "dates_clause_id": "Kopiér tagget fra begyndelsen af den linje du citerer i dates — direkte aflæsning. Null hvis ikke annoteret.",
      "workingWeeks": "EKSAKT og KORT tekststreng der viser det SAMLEDE antal uger — KUN selve ugetallet med umiddelbar kontekst, f.eks. 'engageret i 9 uger', '17,6 weeks', 'i alt 11,6 uger' — STOP før datoer og andre oplysninger. Max 30 tegn. Null hvis intet samlet ugetal findes.",
      "collectiveAgreement": "EKSAKT tekststreng der omhandler overenskomst — kopiér den FULDE sætning uanset om kontrakten ER eller IKKE ER omfattet af overenskomst. Fx positiv: 'I øvrigt henvises til gældende Fiktionsoverenskomst...' Fx negativ: 'Kontrakten er ikke omfattet af kollektive overenskomster' eller 'Kontrakten reguleres ikke af overenskomst'. Max 200 tegn eller null. VIGTIGT — overenskomsten nævnes ofte i forbifarten mange steder (§3, §4 osv.); prioritér den DEDIKEREDE overenskomst-erklæringsklausul — typisk den sætning der eksplicit erklærer hvilken overenskomst kontrakten er eller ikke er underlagt, ikke de steder overenskomsten blot citeres som kilde til en specifik regel.",
      "copydan": "Kopiér den KOMPLETTE tekstpassage der omhandler Copydan-forbehold eller lignende vederlagsbevarende rettighed — inkl. klausuler der bevarer vederlagsret via ophavsretslovens §§ (fx §§ 13, 17, 35) selv om Copydan ikke nævnes eksplicit. START fra afsnittets allerførste ord. Max 400 tegn. Null hvis ingen sådan klausul.",
      "copydan_clause_id": "Kopiér tagget fra begyndelsen af den linje du citerer i copydan — direkte aflæsning. Null hvis ikke annoteret.",
      "svod": "Kopiér den KOMPLETTE tekstpassage der omhandler SVOD/streaming eller Create Denmark — START altid fra afsnittets allerførste ord. Inkluder hele afsnittet. Max 400 tegn. Null hvis ikke nævnes.",
      "svod_clause_id": "Kopiér tagget fra begyndelsen af den linje du citerer i svod — direkte aflæsning. Null hvis ikke annoteret.",
      "royalty": "Kopiér den KOMPLETTE tekstpassage FRA KONTRAKTEN der omhandler royaltybetaling — inkl. indirekte formuleringer som 'Producenten afregner royalties til [overenskomst] jf. overenskomst' eller 'Leverandøren vil være berettiget til en andel af disse royalties'. KUN hvis adskilt fra SVOD/streaming-afsnittet. Max 400 tegn. VIGTIGT: hvis royaltyprocenten er UDLEDT fra overenskomstkonteksten uden at stå eksplicit i kontrakten, citér i stedet den sætning i kontrakten der henviser til/inkorporerer overenskomsten (fx 'ansættelsen sker i henhold til [overenskomst]') — SÆT ALDRIG selve procenttallet ind som citat, det er ikke en tekstpassage og kan ikke highlightes i dokumentet. Null hvis hverken royaltytekst eller overenskomst-henvisning findes.",
      "royalty_clause_id": "Kopiér tagget fra begyndelsen af den linje du citerer i royalty — direkte aflæsning. Null hvis ikke annoteret.",
      "prolongation": "EKSAKT tekststreng der viser prolongations-/optionsklausulen — kopiér sætningen der nævner antal optionsuger/-dage og eventuel ferieperiode, fx 'op til 2 ugers prolongation', 'mulighed for forlængelse med 3 uger', eller 'mulighed for prolongation i ___4___ dage' (inkl. evt. understregninger/udfyldningslinjer omkring tallet, som de faktisk står i kontrakten). Max 120 tegn eller null.",
      "prolongation_clause_id": "Kopiér tagget fra begyndelsen af den linje du citerer i prolongation — direkte aflæsning. Null hvis ikke annoteret."
    }`

export type AiSources = {
    workTitle?: string | null
    salary?: string | null
    salary_clause_id?: string | null
    pension?: string | null
    pension_clause_id?: string | null
    supplements?: string | null
    supplements_clause_id?: string | null
    otherSupplements?: string | null
    dates?: string | null
    dates_clause_id?: string | null
    workingWeeks?: string | null
    collectiveAgreement?: string | null
    copydan?: string | null
    copydan_clause_id?: string | null
    svod?: string | null
    svod_clause_id?: string | null
    royalty?: string | null
    royalty_clause_id?: string | null
    prolongation?: string | null
    prolongation_clause_id?: string | null
}

/** Strip a source quote at the first heading boundary (camelCase or newline). */
export function clipSourceHeading(s: string | null | undefined): string | null {
    if (!s) return null
    for (let i = 1; i < s.length; i++) {
        if (/[a-zæøå]/.test(s[i - 1]) && /[A-ZÆØÅ]/.test(s[i])) return s.slice(0, i).trim()
        if (s[i] === "\n" || s[i] === "\r") return s.slice(0, i).trim()
    }
    return s
}

/**
 * En sats-/beløbscitation uden et eneste ciffer kan pr. definition ikke være et
 * udfyldt beløbsfelt — kun en ubrugt skabelon-klausul (fx "løn på ___" med kun
 * en streg). Mekanisk sikkerhedsnet: kasser citatet uafhængigt af om AI'en
 * fulgte instruksen om at undgå ubrugte alternative klausuler.
 */
export function discardIfNoDigits(s: string | null | undefined): string | null {
    if (!s) return null
    return /\d/.test(s) ? s : null
}

/**
 * Et pension- eller supplement-citat skal indeholde et konkret DKK/kr.-beløb —
 * ikke blot en procentsats. Kontraktskabeloner gentager pensionsformuleringen i
 * alternative klausuler (fx B. Klumpsum) men med tomt beløbsfelt: "9,5 % ... ___DKK".
 * Begge forekomster indeholder et ciffer (procentsatsen), men kun den udfyldte har
 * et tal UMIDDELBART INDEN "DKK" eller "kr." — uden mellemliggende streger.
 * Kasser citatet hvis "DKK"/"kr." kun er forudgået af streger/mellemrum (tomt felt).
 */
export function discardIfNoDkkAmount(s: string | null | undefined): string | null {
    if (!s) return null
    // Kræver mindst ét ciffer direkte inden DKK/kr. (evt. adskilt af punktum/komma/mellemrum)
    // men IKKE kun streger "_" inden DKK/kr.
    // [\d.,\s-]* tillader "2500 ,-DKK" (dansk format) — \d i starten udelukker "___-DKK"
    return /\d[\d.,\s-]*\s*(DKK|kr\.)/i.test(s) ? s : null
}

/**
 * Et citat der KUN er et tal/procentangivelse (fx "1%", "1,0 %") er ikke en
 * tekstpassage fra kontrakten — det er en udledt værdi, AI'en fejlagtigt har
 * sat ind som "kilde". Sådan et citat kan aldrig meningsfuldt highlightes
 * (det matcher enten intet, eller et tilfældigt forekommende tal et andet
 * sted i dokumentet). Mekanisk sikkerhedsnet, uafhængigt af prompt-instruks.
 */
export function discardIfBareNumber(s: string | null | undefined): string | null {
    if (!s) return null
    return /^\s*\d+([.,]\d+)?\s*%?\s*$/.test(s) ? null : s
}

/** Validerer et AI-returneret klausul-ID mod den kendte ID-liste. Returnerer null ved ukendt ID. */
export function validateClauseId(id: string | null | undefined, knownIds: Set<string>): string | null {
    if (!id) return null
    return knownIds.has(id) ? id : null
}

/** Normalise raw _sources from AI response (clip headings on long passage fields).
 *  knownClauseIds: validerede IDs fra layout — AI-returnerede IDs der ikke findes heri kasseres. */
export function normaliseSources(raw: Record<string, string | null>, knownClauseIds?: Set<string>): AiSources {
    const ids = knownClauseIds ?? new Set<string>()
    const validateId = (id: string | null | undefined) => knownClauseIds ? validateClauseId(id, ids) : (id ?? null)
    return {
        ...raw,
        salary: discardIfNoDigits(raw.salary),
        salary_clause_id: validateId(raw.salary_clause_id),
        pension: discardIfNoDkkAmount(raw.pension),
        pension_clause_id: validateId(raw.pension_clause_id),
        supplements: discardIfNoDkkAmount(raw.supplements),
        supplements_clause_id: validateId(raw.supplements_clause_id),
        dates_clause_id: validateId(raw.dates_clause_id),
        copydan: clipSourceHeading(raw.copydan),
        copydan_clause_id: validateId(raw.copydan_clause_id),
        svod: clipSourceHeading(raw.svod),
        svod_clause_id: validateId(raw.svod_clause_id),
        royalty: discardIfBareNumber(clipSourceHeading(raw.royalty)),
        royalty_clause_id: validateId(raw.royalty_clause_id),
        prolongation_clause_id: validateId(raw.prolongation_clause_id),
    }
}
