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
      "pension": "EKSAKT og UNIK tekststreng der kun findes i pensionsafsnittet — brug f.eks. procentsatsen med ord der omgiver den: '9,5 % af grundlønnen' eller 'pensionsbidrag (9,5 %' — vælg den korteste streng der KUN forekommer i pensionsafsnittet og ingen andre steder (max 60 tegn) eller null",
      "supplements": "EKSAKT tekststreng der indeholder afsnittet om personlige tillæg inkl. selve beløbet — kopiér fra 'personlige tillæg' og frem til beløbet, f.eks. 'personlige tillæg:___1.586' eller 'følgende personlige tillæg:' — max 60 tegn eller null",
      "otherSupplements": "EKSAKT tekststreng der indeholder afsnittet om andre tillæg (ikke personlige tillæg) — kopiér den sætning der nævner tillægget, f.eks. 'tillæg for særlige opgaver' eller 'øvrige tillæg: 500 kr.' — max 80 tegn eller null",
      "dates": "EKSAKT tekststreng der viser ansættelsesperioden — kopiér sætningen med start- og slutdato, f.eks. 'fra den 26. august til 24. november 2024' eller 'ansættelsesperioden er 01.01.2024 - 31.03.2024' — max 80 tegn eller null",
      "workingWeeks": "EKSAKT og KORT tekststreng der viser det SAMLEDE antal uger — KUN selve ugetallet med umiddelbar kontekst, f.eks. 'engageret i 9 uger', '17,6 weeks', 'i alt 11,6 uger' — STOP før datoer og andre oplysninger. Max 30 tegn. Null hvis intet samlet ugetal findes.",
      "collectiveAgreement": "EKSAKT tekststreng der omhandler overenskomst — kopiér den FULDE sætning uanset om kontrakten ER eller IKKE ER omfattet af overenskomst. Fx positiv: 'I øvrigt henvises til gældende Fiktionsoverenskomst...' Fx negativ: 'Kontrakten er ikke omfattet af kollektive overenskomster' eller 'Kontrakten reguleres ikke af overenskomst'. Max 200 tegn eller null.",
      "copydan": "Kopiér den KOMPLETTE tekstpassage der omhandler Copydan-forbehold eller lignende vederlagsbevarende rettighed — inkl. klausuler der bevarer vederlagsret via ophavsretslovens §§ (fx §§ 13, 17, 35) selv om Copydan ikke nævnes eksplicit. START fra afsnittets allerførste ord. Max 400 tegn. Null hvis ingen sådan klausul.",
      "svod": "Kopiér den KOMPLETTE tekstpassage der omhandler SVOD/streaming eller Create Denmark — START altid fra afsnittets allerførste ord. Inkluder hele afsnittet. Max 400 tegn. Null hvis ikke nævnes.",
      "royalty": "Kopiér den KOMPLETTE tekstpassage FRA KONTRAKTEN der omhandler royaltybetaling — inkl. indirekte formuleringer som 'Producenten afregner royalties til [overenskomst] jf. overenskomst' eller 'Leverandøren vil være berettiget til en andel af disse royalties'. KUN hvis adskilt fra SVOD/streaming-afsnittet. Max 400 tegn. VIGTIGT: hvis royaltyprocenten er UDLEDT fra overenskomstkonteksten uden at stå eksplicit i kontrakten, citér i stedet den sætning i kontrakten der henviser til/inkorporerer overenskomsten (fx 'ansættelsen sker i henhold til [overenskomst]') — SÆT ALDRIG selve procenttallet ind som citat, det er ikke en tekstpassage og kan ikke highlightes i dokumentet. Null hvis hverken royaltytekst eller overenskomst-henvisning findes.",
      "prolongation": "EKSAKT tekststreng der viser prolongations-/optionsklausulen — kopiér sætningen der nævner antal optionsuger/-dage og eventuel ferieperiode, fx 'op til 2 ugers prolongation', 'mulighed for forlængelse med 3 uger', eller 'mulighed for prolongation i ___4___ dage' (inkl. evt. understregninger/udfyldningslinjer omkring tallet, som de faktisk står i kontrakten). Max 120 tegn eller null."
    }`

export type AiSources = {
    workTitle?: string | null
    salary?: string | null
    pension?: string | null
    supplements?: string | null
    otherSupplements?: string | null
    dates?: string | null
    workingWeeks?: string | null
    collectiveAgreement?: string | null
    copydan?: string | null
    svod?: string | null
    royalty?: string | null
    prolongation?: string | null
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

/** Normalise raw _sources from AI response (clip headings on long passage fields). */
export function normaliseSources(raw: Record<string, string | null>): AiSources {
    return {
        ...raw,
        salary: discardIfNoDigits(raw.salary),
        copydan: clipSourceHeading(raw.copydan),
        svod: clipSourceHeading(raw.svod),
        royalty: discardIfBareNumber(clipSourceHeading(raw.royalty)),
    }
}
