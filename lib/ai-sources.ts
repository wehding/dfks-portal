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
      "salary": "EKSAKT tekststreng fra kontrakten der indeholder honoraret — kopiér sætningen der nævner beløbet, f.eks. 'grundløn på __14.637__ DKK pr. uge' eller 'honorar på 45.000 kr. pr. måned' — max 120 tegn eller null",
      "pension": "EKSAKT og UNIK tekststreng der kun findes i pensionsafsnittet — brug f.eks. procentsatsen med ord der omgiver den: '9,5 % af grundlønnen' eller 'pensionsbidrag (9,5 %' — vælg den korteste streng der KUN forekommer i pensionsafsnittet og ingen andre steder (max 60 tegn) eller null",
      "supplements": "EKSAKT tekststreng der indeholder afsnittet om personlige tillæg inkl. selve beløbet — kopiér fra 'personlige tillæg' og frem til beløbet, f.eks. 'personlige tillæg:___1.586' eller 'følgende personlige tillæg:' — max 60 tegn eller null",
      "otherSupplements": "EKSAKT tekststreng der indeholder afsnittet om andre tillæg (ikke personlige tillæg) — kopiér den sætning der nævner tillægget, f.eks. 'tillæg for særlige opgaver' eller 'øvrige tillæg: 500 kr.' — max 80 tegn eller null",
      "dates": "EKSAKT tekststreng der viser ansættelsesperioden — kopiér sætningen med start- og slutdato, f.eks. 'fra den 26. august til 24. november 2024' eller 'ansættelsesperioden er 01.01.2024 - 31.03.2024' — max 80 tegn eller null",
      "workingWeeks": "EKSAKT og KORT tekststreng der viser det SAMLEDE antal uger — KUN selve ugetallet med umiddelbar kontekst, f.eks. 'engageret i 9 uger', '17,6 weeks', 'i alt 11,6 uger' — STOP før datoer og andre oplysninger. Max 30 tegn. Null hvis intet samlet ugetal findes.",
      "collectiveAgreement": "EKSAKT tekststreng der omhandler overenskomst — kopiér den FULDE sætning uanset om kontrakten ER eller IKKE ER omfattet af overenskomst. Fx positiv: 'I øvrigt henvises til gældende Fiktionsoverenskomst...' Fx negativ: 'Kontrakten er ikke omfattet af kollektive overenskomster' eller 'Kontrakten reguleres ikke af overenskomst'. Max 200 tegn eller null.",
      "copydan": "Kopiér den KOMPLETTE tekstpassage der omhandler Copydan-forbehold eller lignende vederlagsbevarende rettighed — inkl. klausuler der bevarer vederlagsret via ophavsretslovens §§ (fx §§ 13, 17, 35) selv om Copydan ikke nævnes eksplicit. START fra afsnittets allerførste ord. Max 400 tegn. Null hvis ingen sådan klausul.",
      "svod": "Kopiér den KOMPLETTE tekstpassage der omhandler SVOD/streaming eller Create Denmark — START altid fra afsnittets allerførste ord. Inkluder hele afsnittet. Max 400 tegn. Null hvis ikke nævnes.",
      "royalty": "Kopiér den KOMPLETTE tekstpassage der omhandler et specifikt royalty-forbehold med en konkret aftale om royaltybetaling — KUN hvis der er et dedikeret royalty-afsnit adskilt fra SVOD/streaming. Royalties der blot nævnes i SVOD-afsnittet tæller IKKE. Max 400 tegn. Null hvis ikke relevant."
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

/** Normalise raw _sources from AI response (clip headings on long passage fields). */
export function normaliseSources(raw: Record<string, string | null>): AiSources {
    return {
        ...raw,
        copydan: clipSourceHeading(raw.copydan),
        svod: clipSourceHeading(raw.svod),
        royalty: clipSourceHeading(raw.royalty),
    }
}
