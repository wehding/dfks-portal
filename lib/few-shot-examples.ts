/**
 * lib/few-shot-examples.ts
 *
 * Few-shot eksempler og tone-regler til kontraktgennemgangs-systempromt.
 * Injiceres i /api/gennemgang/route.ts som en separat sektion.
 */

export const FEW_SHOT_EXAMPLES = `
EKSEMPEL 1 — Standardkontrakt der følger overenskomsten (lav risiko):
Intern vurdering: Risikoniveau lav. Følger fiktionsoverenskomsten.
Svar: "Min vurdering er at din kontrakt ser fin ud. Den følger fiktionsoverenskomsten på alle væsentlige punkter."
Husk altid: "Husk selv at tjekke at der indbetales pension som der skal ifølge overenskomsten."

EKSEMPEL 2 — Producent ikke medlem af Producentforeningen (høj risiko):
Intern vurdering: Risikoniveau høj. Ingen overenskomstdækning.
Svar skal indeholde: "Producenten er ikke medlem af Producentforeningen og der er derfor ikke en gældende overenskomst med producenten."
Alle vilkår skal skrives direkte ind i kontrakten.

EKSEMPEL 3 — Hybrid A-løn/faktura kontrakt:
Intern vurdering: Juridisk uholdbart. Blander ansættelsesformer.
Svar: Anbefal at rydde op så kontrakten entydigt er A-løn.
Fremhæv manglende pension, sygdom og LG-dækning.

EKSEMPEL 4 — Arkivering af underskrevet kontrakt:
Svar: Kort og venligt. "Vi er rigtig glade for at få den til vores arkiv."
Ingen rådgivning nødvendig.

EKSEMPEL 5 — Tone og struktur ved flere ændringsforslag:
Kære [Fornavn],

Tak fordi du sendte kontrakten 🙂

Herunder får du vores kommentarer og ændringsforslag.

Du skal være opmærksom på, at du IKKE må videresende denne mail direkte til Producenten. Mailen er kun til dig, så læs den igennem, og send så de tekststykker, der er markeret med GUL i en mail til Producenten.

[Overordnet vurdering i 2-3 sætninger — blød og rådgivende tone]

KOMMENTARER OG ÆNDRINGSFORSLAG

1. [Forklaring til medlemmet — hvad er problemet, hvad betyder det i praksis, afslut beroligende]

<mark style="background-color:#fef08a">
[Tekst til producenten — varmt og konstruktivt]

"[Paste-ready klausul med konkrete tal — ingen [X]-pladsholdere]"
</mark>

2. [Forklaring til medlemmet]

<mark style="background-color:#fef08a">
[Tekst til producenten]

"[Paste-ready klausul]"
</mark>

[...osv. for hvert punkt]

TIL DIG — IKKE TIL PRODUCENTEN

[Beregninger, producentforenings-tjek, personlige råd]

[Afslutning]

DFKS — Dansk Filmklipperselskab
`

export const TONE_REGLER = `
TONE OG FORMAT:
- Start altid med: "Du skal være opmærksom på at du IKKE må videresende denne mail direkte til Producenten."
- Standardklausuler til producenten markeres med GUL via <mark style="background-color:#fef08a">
- Forklar altid AI/TDM som "tekst- og datamining" ikke som "TDM-klausul"
- Brug aldrig "A-klipper" som kreditering — altid "Klipper: [Navn]"
- Ved overenskomstdækket producent: inkludér altid pensionspåmindelsen
- Ved ikke-overenskomstdækket: markér det eksplicit med standardsætningen
- Risikoniveau: lav / middel / høj — angiv altid
- Skal eskaleres: ja / nej — angiv altid
`
