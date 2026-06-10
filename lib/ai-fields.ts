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
    "(3) Feriepenge/feriegodtgørelse nævnes som en separat ydelse der betales OVENI lønnen (fx 'feriepenge på 12,5 %' eller 'feriegodtgørelse indbetales til Feriekonto') → 'a-løn'. I leverandørkontrakter er feriepenge altid inkluderet i honoraret, ikke en separat post. " +
    "(4) Ordene 'a-løn', 'ansættelse', 'lønmodtager', 'medarbejder' forekommer eksplicit → 'a-løn'. " +
    "(5) Ingen klare signaler → 'a-løn' som default. " +
    "En leverandørkontrakt der inkorporerer overenskomsten ved reference er stadig 'leverandør'. (string | null)"

export const COLLECTIVE_AGREEMENT_RULE =
    "STRENG REGEL: true KUN hvis kontrakten er en ren A-LØNSKONTRAKT " +
    "(lønmodtager uden CVR, uden moms, med løn og ikke honorar). " +
    "Hvis kontrakten indeholder CVR-nummer, moms, honorar, faktura eller selvstændig erhvervsdrivende: " +
    "sæt til false — UANSET om overenskomstens vilkår er inkorporeret ved reference. " +
    "collectiveAgreementByReference håndterer det tilfælde separat. " +
    "En leverandørkontrakt er ALDRIG en 'overenskomstkontrakt'. (boolean)"

export const COLLECTIVE_AGREEMENT_BY_REFERENCE_RULE =
    "true KUN hvis kontrakten er en LEVERANDØRKONTRAKT (CVR, honorar, moms) OG overenskomstens vilkår eksplicit er inkorporeret ved reference. " +
    "ALDRIG true for A-lønskontrakter — en A-lønskontrakt der nævner overenskomsten er bare en normal A-lønskontrakt, ikke en leverandørkontrakt med reference. " +
    "Eksempel på true: leverandørkontrakt med formulering som 'the terms of the collective agreement shall apply by analogy' eller 'rettigheder overdrages i overensstemmelse med overenskomsten'. " +
    "Eksempel på FALSE: en A-lønskontrakt der slutter med 'I øvrigt henvises til gældende Fiktionsoverenskomst' — dette er IKKE inkorporering ved reference, det er bare en normal overenskomstreference i en A-lønskontrakt. " +
    "Sæt false hvis contractType er 'a-løn'. (boolean)"

export const IS_FREELANCE_CONTRACT_RULE =
    "true hvis kontrakten er en leverandørkontrakt (CVR-nummer, moms, honorar, faktura, selvstændig erhvervsdrivende) " +
    "— false hvis det er en lønmodtagerkontrakt (A-løn). Skal altid matche contractType. (boolean)"

export const HOLIDAY_PAY_RATE_RULE =
    "Helligdagsbetaling i % som tal (number | null). " +
    "Sæt KUN hvis satsen er eksplicit nævnt i selve kontraktteksten. " +
    "Helligdagsbetaling og BETA-fond er reguleret i overenskomsten og fremgår sjældent af kontrakten — sæt null medmindre procentsatsen er skrevet direkte ind i kontrakten."

export const BETA_RATE_RULE =
    "BETA-fondsbidrag i % som tal (number | null). " +
    "Sæt KUN hvis satsen er eksplicit nævnt i selve kontraktteksten. " +
    "BETA-fond er reguleret i overenskomsten og fremgår sjældent af kontrakten — sæt null medmindre procentsatsen er skrevet direkte ind i kontrakten."
