/**
 * lib/ai-fields.ts
 *
 * Single source of truth for shared AI field descriptions used in both:
 *   - lib/ai.ts (kontraktgennemgang / review)
 *   - app/api/contracts/extract/route.ts (kontrakter upload extraction)
 *
 * Edit here — changes propagate automatically to both AI calls.
 */

export const CONTRACT_TYPE_RULE =
    "RETURNER præcis én af: 'a-løn' eller 'leverandør'. " +
    "REGLER — brug første matchende regel: " +
    "(1) Indeholder kontrakten et CVR-nummer på medarbejderen/klipperen → 'leverandør'. " +
    "(2) Ordet 'leverandør', 'freelance', 'honorar', 'agreement for services' eller 'serviceaftale' forekommer eksplicit → 'leverandør'. " +
    "(3) Ordene 'a-løn', 'ansættelse', 'lønmodtager' forekommer eksplicit → 'a-løn'. " +
    "(4) Ingen klare signaler → 'a-løn' som default. " +
    "En leverandørkontrakt der inkorporerer overenskomsten ved reference er stadig 'leverandør'. (string | null)"

export const COLLECTIVE_AGREEMENT_RULE =
    "STRENG REGEL: true KUN hvis kontrakten er en ren A-LØNSKONTRAKT " +
    "(lønmodtager uden CVR, uden moms, med løn og ikke honorar). " +
    "Hvis kontrakten indeholder CVR-nummer, moms, honorar, faktura eller selvstændig erhvervsdrivende: " +
    "sæt til false — UANSET om overenskomstens vilkår er inkorporeret ved reference. " +
    "collectiveAgreementByReference håndterer det tilfælde separat. " +
    "En leverandørkontrakt er ALDRIG en 'overenskomstkontrakt'. (boolean)"

export const COLLECTIVE_AGREEMENT_BY_REFERENCE_RULE =
    "true hvis overenskomstens vilkår er inkorporeret ved reference i en leverandørkontrakt. " +
    "Sæt true ved formuleringer som: " +
    "'the terms set forth therein shall supplement', " +
    "'I øvrigt gælder overenskomstens bestemmelser', " +
    "'In all other respects the terms of the collective agreement apply', " +
    "'overenskomstens vilkår finder tilsvarende anvendelse', " +
    "'the collective agreement shall apply by analogy', " +
    "'rights shall be transferred in accordance with the collective agreement', " +
    "'rettigheder overdrages i overensstemmelse med overenskomsten', " +
    "'the transfer of rights ... shall be in accordance with the collective agreement'. " +
    "Sæt false hvis overenskomsten slet ikke nævnes. (boolean)"

export const IS_FREELANCE_CONTRACT_RULE =
    "true hvis kontrakten er en leverandørkontrakt (CVR-nummer, moms, honorar, faktura, selvstændig erhvervsdrivende) " +
    "— false hvis det er en lønmodtagerkontrakt (A-løn). Skal altid matche contractType. (boolean)"

export const HOLIDAY_PAY_RATE_RULE =
    "Helligdagsbetaling i % som tal (number | null). " +
    "REGEL: (A) For A-lønskontrakter der refererer til De4-fiktionsoverenskomsten: sæt til 1 (1% — fastsat i overenskomsten). " +
    "(B) For leverandørkontrakter: sæt altid til null — uanset om overenskomstens vilkår er inkorporeret ved reference. " +
    "(C) For andre kontrakttyper: sæt KUN hvis satsen er eksplicit nævnt i kontraktteksten, ellers null."

export const BETA_RATE_RULE =
    "BETA-fondsbidrag i % som tal (number | null). " +
    "REGEL: (A) For A-lønskontrakter der refererer til De4-fiktionsoverenskomsten: sæt til 0.5 (0,5% — fastsat i § 21 af overenskomsten). " +
    "(B) For leverandørkontrakter: sæt altid til null — uanset om overenskomstens vilkår er inkorporeret ved reference. " +
    "(C) For andre kontrakttyper: sæt KUN hvis satsen er eksplicit nævnt i kontraktteksten, ellers null."
