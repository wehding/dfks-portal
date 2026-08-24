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
    "(2) Ordet 'leverandør', moms, faktura, selvstændig erhvervsdrivende, 'agreement for services' eller 'serviceaftale' forekommer eksplicit → 'leverandør'. " +
    "Ordet 'freelance' er IKKE nok i sig selv: en freelancer med A-skat, feriepenge og arbejdsgiverpension er lønmodtager og skal være 'a-løn'. " +
    "(3) Feriepenge/feriegodtgørelse nævnes som en separat ydelse der betales OVENI lønnen (fx 'feriepenge på 12,5 %' eller 'feriegodtgørelse indbetales til Feriekonto') → 'a-løn'. I leverandørkontrakter er feriepenge altid inkluderet i honoraret, ikke en separat post. " +
    "(4) Ordene 'a-løn', 'ansættelse', 'lønmodtager', 'medarbejder' forekommer eksplicit → 'a-løn'. " +
    "(5) Ingen klare signaler → 'a-løn' som default. " +
    "En leverandørkontrakt der inkorporerer overenskomsten ved reference er stadig 'leverandør'. (string | null)"

export const COLLECTIVE_AGREEMENT_RULE =
    "STRENG REGEL: true KUN hvis kontrakten er en A-LØNSKONTRAKT eller en udtrykkeligt overenskomstdækket lønmodtagerfreelance " +
    "(lønmodtager uden CVR, uden moms og uden fakturering). Ordet honorar er ikke i sig selv afgørende. " +
    "Hvis kontrakten er B2B og indeholder CVR-nummer på leverandøren, moms, faktura eller selvstændig erhvervsdrivende: " +
    "sæt til false — UANSET om overenskomstens vilkår er inkorporeret ved reference. " +
    "collectiveAgreementByReference håndterer det tilfælde separat. " +
    "En leverandørkontrakt er ALDRIG en 'overenskomstkontrakt'. (boolean)"

export const COLLECTIVE_AGREEMENT_BY_REFERENCE_RULE =
    "true KUN hvis kontrakten er en LEVERANDØRKONTRAKT (CVR, moms, faktura eller tydelig B2B-aftale) OG direkte henviser til en navngiven overenskomst. " +
    "Feltet monitorerer, at referencen findes. Det betyder IKKE, at leverandøren er overenskomstdækket, og der må ikke udledes pension, helligdagsbetaling, BETA eller andre lønmodtagervilkår automatisk. " +
    "En afgrænset henvisning til en navngiven overenskomst i en ophavsrets-, rettigheds- eller royaltyklausul giver derfor OGSÅ true. En sådan reference må kun bruges til de rettigheder, klausulen konkret omtaler. " +
    "ALDRIG true for A-lønskontrakter — en A-lønskontrakt der nævner overenskomsten er bare en normal A-lønskontrakt, ikke en leverandørkontrakt med reference. " +
    "Eksempel på true: en leverandørkontrakt der generelt anvender en overenskomst analogt, eller som henviser til en navngiven overenskomst i en afgrænset rettighedsklausul. " +
    "Eksempel på FALSE: en A-lønskontrakt der slutter med 'I øvrigt henvises til gældende Fiktionsoverenskomst' — dette er IKKE inkorporering ved reference, det er bare en normal overenskomstreference i en A-lønskontrakt. " +
    "Sæt false hvis contractType er 'a-løn'. (boolean)"

export const IS_FREELANCE_CONTRACT_RULE =
    "true hvis kontrakten er en leverandørkontrakt (CVR-nummer, moms, faktura, selvstændig erhvervsdrivende) " +
    "— false hvis det er en lønmodtagerkontrakt (A-løn). Skal altid matche contractType. (boolean)"

export const HOLIDAY_PAY_RATE_RULE =
    "Helligdagsbetaling i % som tal (number | null). " +
    "Sæt KUN hvis satsen er eksplicit nævnt i selve kontraktteksten — fx '8,33% i helligdagsbetaling'. " +
    "Sæt null ellers; satsen udledes automatisk deterministisk fra overenskomstregisteret."

export const BETA_RATE_RULE =
    "BETA-fondsbidrag i % som tal (number | null). " +
    "Sæt KUN hvis satsen er eksplicit nævnt i selve kontraktteksten — fx '1% til BETA-fonden'. " +
    "Sæt null ellers; satsen udledes automatisk deterministisk fra overenskomstregisteret."
