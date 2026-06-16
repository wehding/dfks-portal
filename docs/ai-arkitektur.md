# AI-arkitektur — Kontraktgennemgang

Denne fil dokumenterer det tekniske design af AI-analyse-flowet i DFKS Kontraktportal.
Den forklarer hvad hver del gør, hvorfor den er bygget sådan, og hvilke trade-offs der er truffet.

---

## Overblik

Kontraktgennemgang er bygget som et **tre-trins pipeline** der transformerer en uploadet kontraktfil til en færdig feedbackmail til et DFKS-medlem.

```
Kontraktfil (PDF/DOCX/TXT)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ lib/analyse.ts — analyserKontrakt()                     │
│                                                         │
│  Trin 1: Klassifikation          (Anthropic, 500 tok)   │
│     ↓ Klassifikation JSON                               │
│  DB-opslag: satser, noteringer, eksempler, RAG          │
│     ↓ Kontekst                                          │
│  Trin 2: Compliance-udtræk       (Anthropic, 4000 tok)  │
│     ↓ ComplianceExtract JSON                            │
│  Trin 3: Mailgenerering          (Anthropic, 16000 tok) │
│     ↓ Feedbackmail + feedbackpunkter                    │
└─────────────────────────────────────────────────────────┘
        │
        ▼
app/api/gennemgang/route.ts — storage + DB-persistering
```

---

## Trin 1 — Klassifikation

**Fil:** `lib/analyse.ts` → `klassificerKontrakt()`

**Hvad:** Isoleret AI-kald der læser de første 4.000 tegn af kontrakten og returnerer 12 strukturerede felter om kontraktens art.

**Output (`Klassifikation`):**
```typescript
{
  kontrakttype: "a-loen" | "leverandoer" | "hybrid"
  er_overenskomst: boolean          // er producenten ProF-medlem?
  overenskomst_navn: string | null  // "de4-fiktion" | "faf-dokumentar"
  membres_fornavn: string
  membres_efternavn: string
  aftalt_loen: number | null
  loen_enhed: "kr/uge" | "kr/dag" | null
  producent_navn: string
  kontraktsprog: "da" | "en" | "other"
  loen_type: "ugeloeen" | "dagsloen" | "fast_total" | "ukendt"
  loen_valuta: "DKK" | "USD" | "EUR" | "GBP" | "other"
  produktionstype: "spillefilm" | "tvserie" | "dokumentar" | ...
}
```

**Hvorfor isoleret:** Klassifikationen styrer hvilke DB-satser der hentes og hvilke regler der gælder i trin 2. Et fejlagtigt klassifikationsresultat ville forplante sig til begge efterfølgende trin. Ved at isolere det kan det fejle og give en default uden at blokere hele analysen.

**Fallback:** Ved fejl returneres `hybrid` / `false` / `null` som safe defaults. Trin 2 og 3 fortsætter.

---

## DB-opslag (mellem trin 1 og 2)

Fire parallelle datakilder hentes efter klassifikationen er klar:

| Kilde | Hvad | Bruges til |
|---|---|---|
| `overenskomst_satser` | Pension %, normalløn, feriepenge, BETA, helligdag | Konkrete kr-beløb i trin 2's klausultekster |
| `legal_notes` (priority=altid) | Juridiske noteringer markeret "altid" | Injiceres i trin 2's kontekst |
| `case_learnings` (godkendt_eksempel) | Juristen-godkendte tidligere analyser | Stemme-eksempler i trin 3 |
| RAG via `hentKontekst()` | Overenskomsttekster, lovgrundlag, lærte mønstre | Juridisk kontekst i trin 2 |

**Hvorfor satser fra DB og ikke fra træning:** Overenskomstsatser opdateres ved hvert overenskomstfornyelse. Hvis AI bruger sine egne tal fra træningsdata, vil den bruge forældede satser og generere forkerte beregninger. DB-satser er den eneste kilde til korrekte tal.

**RAG-systemet** (`lib/retrieval.ts`) bruger Google `text-embedding-004` (768 dim) til at finde semantisk relevante chunks fra `knowledge_chunks`-tabellen. Det trækker fire kategorier: overenskomst-satser, overenskomst-kontekst, lovgrundlag (ophavsretsloven m.fl.) og lærte mønstre fra sagsbehandling.

---

## Trin 2 — Compliance-udtræk

**Fil:** `lib/compliance-extract-prompt.ts` → `COMPLIANCE_EXTRACT_PROMPT`

**Hvad:** Analyserer kontraktteksten og returnerer strukturerede compliance-data. **Ingen prosa. Ingen stemme-instruktion.**

**Output (`ComplianceExtract`):**
```typescript
{
  risk_level: "LAV" | "MELLEM" | "HØJ"
  should_escalate: boolean
  non_covered_pedagogical: boolean  // producent ikke ProF-medlem
  overenskomst_navn: string | null
  contract_language: "da" | "en" | "other"
  royalty_rate?: 1.0 | 1.5
  loan_calculation?: { amount: number; basis: string }
  required_clauses: RequiredClause[]  // med exact_text_da og requires_gul
  flagged_issues: FlaggedIssue[]      // med internal_note og severity
}
```

**`RequiredClause`:**
```typescript
{
  clause_id: string            // "pension" | "copydan" | "svod" | ...
  exact_text_da: string        // juridisk korrekt klausultekst, klar til kontrakten
  exact_text_en?: string       // engelsk version til engelsksprogede kontrakter
  source: "altid" | "baggrund" // altid=kræves altid, baggrund=kun ved behov
  requires_gul: boolean        // skal dette punkt til producenten?
  position_hint?: string       // "efter lønafsnit"
}
```

**`FlaggedIssue`:**
```typescript
{
  issue_id: string         // "hybrid_kontrakt" | "royalty_mangler" | ...
  internal_note: string    // kun til jurist — ALDRIG vist til член
  severity: "LAV" | "MELLEM" | "HØJ"
  requires_gul: boolean
}
```

**Hvorfor separeret fra mailgenerering:**
Et enkelt AI-kald der både skal finde juridiske problemer OG skrive naturlig prosa vil typisk ofre det ene for det andet. I praksis betød den kombinerede prompt at modellen enten:
- Skrev mekanisk, regelramt prosa fordi den forsøgte at efterleve alle compliance-krav, eller
- Glemte compliance-krav fordi den var fokuseret på at skrive flydende tekst

Med separat compliance-udtræk er trin 2 fri til at fokusere rent på *hvad*, og trin 3 er fri til at fokusere rent på *hvordan*.

**GUL-markering afgøres her:** `requires_gul: true` markerer præcist hvilke punkter der skal til producenten. Trin 3 anvender markeringen mekanisk — den beslutter ikke selv.

**No-paraphrase af klausultekster:** `exact_text_da` indeholder den juridisk korrekte klausultekst. Trin 2 må aldrig parafrasere — teksten skal kunne sættes direkte ind i kontrakten. `COMPLIANCE_EXTRACT_PROMPT` specificerer: "ALDRIG pladsholdere som [X] i exact_text_da — indsæt de faktiske tal."

---

## Trin 3 — Mailgenerering

**Fil:** `lib/mail-generation-prompt.ts` → `MAIL_GENERATION_PROMPT`

**Hvad:** Modtager `ComplianceExtract` JSON som struktureret input og skriver en naturlig feedbackmail.

**System prompt er bevidst kort.** Den indeholder kun:
1. Output JSON-skema (feedbackmail + feedbackpunkter)
2. 7 mekaniske regler (hilsen, GUL-token, no-paraphrase, lækage-forbud, struktur, selvtjek, samlet_vurdering-mapping)
3. `{{VOICE_EXAMPLES}}` — indsætningssted til 2-3 fulde eksempel-mails

**Stemme fra eksempler, ikke fra instruktion:**
Lange tone-instrukser i system-prompten er ineffektive fordi modellen forsøger at efterleve mange abstrakte regler på én gang. Konkrete eksempel-mails er langt mere effektive til at etablere tone, rytme og naturligt sprog. `{{VOICE_EXAMPLES}}` erstattes ved kald med:
- Juristen-godkendte mails fra `case_learnings`-tabellen (same kontrakttype + overenskomst)
- Eventuelt manuelt leverede stemme-referencer

**Lækage-forbud (kritisk):**
`risk_level` og `internal_note` fra `ComplianceExtract` er interne felter. De er eksplicit forbudte i member-rettet tekst. `MAIL_GENERATION_PROMPT` specificerer dette som en mekanisk regel. Derudover renser `analyserKontrakt()` mailteksten post-hoc for eventuelle lækede risikovurderinger.

**Backward compatibility:**
Trin 3 outputter det samme JSON-skema som det eksisterende to-trins flow (`feedbackpunkter`, `feedbackmail`, `overblik`, `samlet_vurdering`, `risk_level`, `should_escalate`). Eksisterende UI fungerer uden ændringer.

---

## Fælles hjælpefunktioner

### `callAnthropic()` — delt API-kald

```typescript
async function callAnthropic(params: {
    apiKey: string
    model: string
    system: string
    messageContent: any[]
    maxTokens?: number
    logTag?: string
}): Promise<string>
```

Alle tre trin bruger samme funktion. Den validerer model-navn mod en allowlist, logger med `logTag` og kaster ved API-fejl. Ingen side-effects.

### `parseJson()` — robust JSON-parsing

Håndterer tre cases:
1. Ren JSON — `JSON.parse(clean)` direkte
2. JSON indpakket i markdown-backticks — strippet inden parsing
3. JSON indpakket i prose — `indexOf("{")` / `lastIndexOf("}")` extraction

Alle tre cases er observeret i production fra Anthropic API.

### `maskSensitiveData()` — GDPR

Masker CPR-numre, bankkonti, IBAN, mobilnumre og private adresser inden teksten sendes til AI-API'et. Kørertransparent — samme tekst returneres med sensitive data erstattet af `****` og `[NR. MASKERET]`.

### `byggKontraktfakta()` — deterministisk faktablok

Bygger en struktureret tekstblok med kontraktfakta og DB-satser til trin 2. Formatet er fast og deterministisk — AI'en kan ikke misforstå hvilke satser der gælder for denne specifikke kontrakt.

---

## Promptarkitektur — injektionsrækkefølge

I trin 2 og 3 bygges system-prompten dynamisk i denne rækkefølge:

```
[Basis-prompt (COMPLIANCE_EXTRACT_PROMPT eller MAIL_GENERATION_PROMPT)]
    +
[KONTRAKTFAKTA — klassifikation + DB-satser]
    +
[Upload-kontekst — kontrakttype, producer, distributionskanaler]
    +
[DFKS AKTIVE NOTERINGER — altid-noteringer fra legal_notes]
    +
[RAG-kontekst — overenskomst-satser, lovgrundlag, lærte mønstre]
    +
[Referencedokumenter — standardkontrakter, lønskemaer fra reference_docs]
```

**Rækkefølgen er bevidst:** Claude følger instruktioner der er placeret sidst i prompten mere konsekvent. Derfor placeres basis-prompten (den der sætter opgave og output-format) *først*, mens kontekst-data der blot er reference-materiale placeres *sidst*.

---

## Datapersistering

`app/api/gennemgang/route.ts` håndterer alt der ikke er AI:

| Handling | Hvad |
|---|---|
| Storage upload | Original fil gemmes i `contract-reviews` bucket som `{orgId}/{timestamp}_{filnavn}` |
| INSERT `contract_reviews` | Al metadata + `ai_result` (trin 3 output) + `compliance_extract` (trin 2 output) + `risk_level` + `should_escalate` |
| UPDATE ved `existingReviewId` | Samme felter — bruges når portal-submit allerede har oprettet rækken |

**`compliance_extract` kolonnen** (`jsonb null`) gemmer trin 2's output uberørt. Det muliggør:
- Debugging: inspicér præcist hvad compliance-udtræket fandt
- Verifikation: kontrollér at alle `required_clauses` faktisk optræder i `ai_result.feedbackmail.tekst`
- Fremtidigt: deterministisk unit-test af trin 2 isoleret fra trin 3

---

## Testcases

**Fil:** `scripts/test-compliance-extract.ts`

Kør med: `npx tsx scripts/test-compliance-extract.ts`

Tre cases der verificerer trin 2 isoleret:

| Test | Kontrakt | Forventet |
|---|---|---|
| 1 | Standard A-løn med pension + Copydan + SVOD | `risk_level: LAV`, ingen manglende klausuler |
| 2 | A-løn uden pension, Copydan, opsigelse | `risk_level: HØJ`, pension+Copydan flagget med `requires_gul: true`, ingen pladsholdere i `exact_text_da` |
| 3 | Hybrid A-løn + faktura | `risk_level: HØJ`, `hybrid_kontrakt` issue med `internal_note` |

---

## Hvad der ikke er ændret

- **Trin 1 (klassifikation)** er identisk med det eksisterende flow
- **DB-opslag** (satser, noteringer, RAG) er identisk
- **API-response format** er en superset — eksisterende UI virker uden ændringer
- **GUL-token syntaks** (`===GUL START===` / `===GUL SLUT===`) er uændret
- **`reanalyse`-routen** (`app/api/admin/contracts/[id]/reanalyse/route.ts`) kalder `analyserKontrakt()` direkte og arver automatisk tre-trins flowet

---

## Fremtidigt arbejde

- **Stemme-eksempler:** `{{VOICE_EXAMPLES}}` venter på 2-3 juristen-godkendte fulde mails som reference
- **Compliance-verifikation:** Post-analyse check der sammenligner `compliance_extract.required_clauses` med `ai_result.feedbackmail.tekst` og advarer hvis en clause mangler
- **Parallelisering:** Trin 2 og trin 3 kunne potentielt køres parallelt hvis trin 3 ikke behøvede trin 2's output — men da `requires_gul` er afgørende for korrekt GUL-markering er sekventiel kørsel nødvendig
