# AI-assisteret kontraktgennemgang — tilgang og arkitektur

**DFKS — Dansk Filmklipperselskab**
Juni 2026

---

## Baggrund

DFKS gennemgår løbende foreløbige kontrakter på vegne af sine medlemmer. Processen kræver juridisk fagviden, kendskab til overenskomster og evnen til at formulere konstruktive tilbagemeldinger til producenter. Det er tidskrævende arbejde, og kvaliteten afhænger af at den rette viden er tilgængelig i det rette øjeblik.

Portalen automatiserer den første gennemgang ved at kombinere en stor sprogmodel (Claude fra Anthropic) med en struktureret vidensbase opbygget af DFKS's egne jurister. AI'en erstatter ikke den juridiske vurdering — den producerer et kvalificeret udkast som juristerne kan godkende, justere og sende.

---

## Princip: AI styret af faglig viden, ikke mavefornemmelse

Den centrale designbeslutning er at AI'en aldrig arbejder ud fra generel juridisk viden alene. Hver kontraktgennemgang sammensættes dynamisk af fem lag viden der alle er kureret og godkendt af DFKS:

```
Kontrakt (PDF/DOCX)
        │
        ▼
┌───────────────────────────────────────────────────────┐
│  1. Semantisk videnbase — lovtekster og DFKS-regler   │
│  2. Overenskomstsatser — præcise tal, altid opdaterede│
│  3. Lærte mønstre — anonymiserede sagseksempler       │
│  4. Juridiske noteringer — aktive indsatspunkter      │
│  5. Referencedokumenter — standardkontrakter          │
└───────────────────────────────────────────────────────┘
        │
        ▼
   Claude (Anthropic)
        │
        ▼
  Udkast til feedbackmail
```

AI'en ser kun det der er relevant for den konkrete kontrakt. En fiktionskontrakt får De4-overenskomstens satser og regler; en dokumentarkontrakt får dokumentaroverenskomstens. Viden der ikke er relevant for den aktuelle kontrakt indgår ikke i analysen.

---

## De fem lag i detaljer

### 1. Semantisk videnbase

Vidensbasen indeholder tekststykker ("chunks") fra:

- Ophavsretsloven, aftaleloven, ferieloven, barselsloven og funktionærloven
- DFKS's egne faglige regler og standardklausuler (Copydan-forbehold, Create Denmark-klausul, AI-beskyttelse, konkursklausul m.fl.)
- Principper for ansættelsesformer, kreditering og navnekontrol

Hvert tekststykke er konverteret til en matematisk repræsentation (embedding) via Google AI. Når en kontrakt indsendes, beregnes en tilsvarende repræsentation af kontraktteksten, og systemet henter automatisk de tekststykker der er semantisk mest relevante — uanset om de bruger præcis de samme ord.

**Vigtig begrænsning:** Vidensbasen indeholder aldrig konkrete kroner- eller procenttal. Det sikrer at forældede satser aldrig kan forurene søgeresultaterne.

### 2. Overenskomstsatser

Lønsatser, pensionsprocenter og tillæg lagres separat i en dedikeret tabel med gyldigheds­datoer. Ved hver ny overenskomstrunde opdateres tabellen, og de gamle satser arkiveres men slettes ikke — så ældre kontrakter stadig kan analyseres korrekt.

Aktuelle satser for De4-fiktionsoverenskomsten (2022):

| Kategori | Sats |
|---|---|
| Normalløn filmklipper (Løngruppe 2) | 14.637 kr/uge |
| Pensionsbidrag (producenten betaler) | 9,5 % |
| BETA/Helligdagstillæg | 1,5 % |
| Tillæg ved dagsgager | 10,0 % |
| Feriepenge | 12,5 % |

Systemet detekterer automatisk hvilken overenskomst kontrakten reguleres af og henter kun de relevante satser. Satserne injiceres som en separat blok i AI'ens kontekst — tydeligt adskilt fra den semantiske søgning — så AI'en aldrig er i tvivl om hvilke tal der er autoritative.

### 3. Lærte mønstre

Anonymiserede sagseksempler fra DFKS's sagsbehandling er konverteret til lærte mønstre. Hvert mønster består af en semantisk beskrivelse (bruges til at finde frem til møstret) og en regel (hvad AI'en skal gøre i denne situation).

Eksempler på mønstre:

- *Hybrid A-løn/faktura-kontrakt* → juridisk uholdbar, anbefal ikke at underskrive, kræv entydig A-lønsaftale
- *Producent ikke medlem af Producentforeningen* → ingen overenskomstdækning, alle vilkår skal skrives eksplicit ind
- *Underskrevet kontrakt indsendt til arkivering* → ingen rådgivning, kort og venlig kvitteringsmail

Mønstrene godkendes af DFKS's sekretariat inden de aktiveres.

### 4. Juridiske noteringer

Sekretariatet vedligeholder løbende en liste over juridiske noteringer i tre prioriteter:

- **Altid-kommentér** (orange): AI'en kommenterer altid dette punkt — positivt eller negativt — uanset hvad kontrakten indeholder. Bruges til aktuelle indsatsområder som AI/TDM-klausuler.
- **Fast regel** (blå): et fast tjekpunkt der altid skal med i analysen.
- **Orientering** (grå): baggrundsviden AI'en kan trække på, men ikke aktivt kommenterer.

Noteringerne administreres i AI-kontrolrummet uden behov for kodeændringer.

### 5. Referencedokumenter

Uploadede standardkontrakter og lønskemaer (PDF/DOCX) stilles til rådighed for AI'en som helhedsdokumenter. Det giver AI'en mulighed for at sammenligne den konkrete kontrakt direkte med den overenskomstmæssige standard.

---

## Output: feedbackmail med markeret producent-tekst

AI'en producerer ikke blot en analyse — den skriver et konkret udkast til den mail juristerne sender til medlemmet. Mailen følger DFKS's tone og struktur:

- Åbner varmt og uformelt
- Indeholder en eksplicit advarsel om at mailen ikke må videresendes direkte til producenten
- Markerer de tekststykker der skal sendes til producenten med `[GUL]`-tags
- Foreslår præcise erstatningsformuleringer i kontraktsprog
- Angiver risikoniveau (lav / middel / høj) og om sagen skal eskaleres

Juristerne kan godkende udkastet, redigere enkeltafsnit og sende — eller bruge det som afsæt for en dybere gennemgang i komplekse sager.

---

## Hvad AI'en ikke gør

- **Sender ikke mails.** Al kommunikation går via juristerne.
- **Træffer ikke afgørelser.** Output er altid et udkast til menneskelig godkendelse.
- **Lærer ikke af nye kontrakter automatisk.** Nye mønstre godkendes manuelt af sekretariatet.
- **Deler ikke data på tværs af organisationer.** Hver organisations data er isoleret.

---

## Kontrol og vedligehold

AI-kontrolrummet giver sekretariatet fuld kontrol over vidensbasen uden teknisk assistance:

| Funktion | Hvad det gør |
|---|---|
| Videnbase | Tilføj, rediger og slet chunks fra lovtekster og DFKS-regler |
| Satser | Opdatér lønsatser ved ny overenskomstrunde |
| Noteringer | Administrér aktive indsatsområder og prioriteter |
| Mønstre | Godkend og rediger lærte sagseksempler |
| Kvalitet | Giv feedback på AI-svar — thumbs up/down med kommentar |

Feedback fra jurister gemmes og bruges til løbende at forbedre mønstre og noteringer.

---

## Teknisk fundament

| Komponent | Valg | Begrundelse |
|---|---|---|
| Sprogmodel | Claude (Anthropic) | Stærk på dansk juridisk sprog og lange dokumenter |
| Embeddings | Google Gemini Embedding 001 | 768-dimensionel, stabil og hurtig |
| Database | Supabase (PostgreSQL + pgvector) | Vektorssøgning og strukturerede data i ét system |
| Hosting | Vercel | Serverless, ingen infrastruktur at vedligeholde |

Alle API-kald sker server-side. Kontrakttekst forlader aldrig serveren ukrypteret, og CPR-numre, bankkontonumre og adresser maskeres automatisk inden teksten sendes til AI'en.
