const BASE = `Du er ekspert i danske overenskomster (film, TV, medie og lignende brancher).

Analyser det uploadede dokument og identificer de reelt betydningsfulde, indholdsmæssigt afgrænsede afsnit. Du bestemmer selv hvilke afsnit der er relevante — begræns dig ikke til en fast liste. Fokuser på afsnit med konkrete rettigheder, pligter, satser eller frister. Udelad rent administrative afsnit som "ikrafttræden", "underskrifter" og lignende, medmindre de indeholder noget indholdsmæssigt væsentligt.

Typiske typer af indhold der ofte er relevante: løn/honorar, pension, arbejdstid/overarbejde, ferie/orlov/barsel, ophavsrettigheder/rettigheder, opsigelse/varsler, fonde og bidragspuljer, tvistløsning — men dokumentet kan indeholde andet, og du skal finde hvad der faktisk er der.

For hvert afsnit:
- Angiv afsnittets overskrift præcis som den står i dokumentet
- Angiv de første 60 tegn af afsnittet (start_marker) — bruges til at finde teksten i dokumentet
- Giv afsnittet en kort, præcis dansk kategori-betegnelse (fx "pension", "barsel", "arbejdstid", "ophavsret", "opsigelse")
- Angiv din tillid: høj hvis afsnittet er eksplicit og tydelig, lav hvis uklart eller implicit
- Angiv eventuelt en sats hvis der er en konkret procentsats eller beløb`

const SUFFIX = `

VIGTIGT: Inkluder IKKE den fulde tekst i JSON-svaret — kun titel, start_marker, kategori, tillid og sats.

Returner KUN valid JSON uden markdown:
{
  "sektioner": [
    {
      "titel": "Afsnittets overskrift fra dokumentet",
      "start_marker": "de første 60 tegn af afsnittet",
      "kategori": "pension",
      "tillid": "høj",
      "sats": "9 %"
    }
  ]
}`

/** Static version for the prompt registry display. */
export const OVERENSKOMST_ANALYSE_SYSTEM_PROMPT = BASE + SUFFIX

/** Build the prompt with optional existing-category context injected inline. */
export function buildOverenskomstAnalysePrompt(kategorikontekst: string): string {
    return BASE + kategorikontekst + SUFFIX
}
