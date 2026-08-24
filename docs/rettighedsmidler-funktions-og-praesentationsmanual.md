# Funktions- og præsentationsmanual: DFKS Rettighedsmidler

## Formål

Denne manual forklarer det planlagte system i et sprog, der kan bruges til præsentationer, introduktion af administratorer og dialog med organisationer, bestyrelser, revisorer og rettighedshavere.

Manualen beskriver det aftalte design. Funktionerne er endnu ikke nødvendigvis implementeret.

## Den korte forklaring

DFKS Portal skal kunne modtage et grundlag for rettighedsbetaling, beregne hvad hvert værk har ret til, fordele beløbet mellem værkets rettighedshavere og følge beløbet frem til en dokumenteret udbetaling.

Portalen er ikke en bank eller wallet. Den viser, hvilke rettighedsmidler organisationen har beregnet og tildelt den enkelte, hvad der er til gode, og hvad der er blevet afregnet og udbetalt.

## 1. Hvad systemet skal løse

Systemet samler hele processen:

```text
Rettighedsbetaling modtages
→ fradrag og hensættelser beregnes
→ beløbet fordeles til værker
→ værket fordeles mellem rettighedshavere
→ rettighedsmidler tildeles personer
→ beløb afventer organisationens udbetalingsgrænse
→ afregning godkendes
→ udbetaling behandles gennem DataLøn
→ bankudbetaling bekræftes
```

Samtidig bevarer systemet dokumentation for, hvorfor hvert beløb ser ud, som det gør.

## 2. Organisationerne er helt adskilte

Hver organisation fungerer som sit eget lukkede system.

- Egne rettighedsmidler.
- Egne regler og procentsatser.
- Egne faggrupper.
- Egne rettighedshavere og værkrelationer.
- Egen udbetalingsgrænse.
- Egne afregninger.
- Egen DataLøn-forbindelse.

Hvis den samme person har rettigheder hos to organisationer, vises og behandles de hver for sig.

Eksempel:

```text
Person hos organisation A
Til gode: 450 kr.
Grænse: 500 kr.
Status: Afventer

Person hos organisation B
Til gode: 300 kr.
Grænse: 250 kr.
Status: Klar til afregning
```

Beløbene må aldrig lægges sammen til 750 kr., og de må aldrig komme i samme udbetaling.

## 3. Rettighedsmidler – ikke en bankkonto

I portalen siger vi:

- “Mine rettighedsmidler”.
- “Rettighedsmidler til gode”.
- “Tildelt”.
- “Afventer afregning”.
- “Udbetalt”.

Vi siger ikke, at pengene er indsat på en intern konto. Tilgodehavendet er organisationens registrering af personens rettighedskrav, indtil det afregnes.

Brugeren kan ikke selv indsætte, hæve, overføre eller bruge beløbet til betalinger.

## 4. Forskellige rettighedskasser

Systemet holder betalingstyper adskilt, så brugeren kan forstå, hvor pengene kommer fra.

### Copydan og anden sekundær udnyttelse

Et samlet beløb fordeles efter godkendte vægte, værktyper, varighed og konkrete visninger.

### Netflix/SVOD

Et individuelt beløb gives til et bestemt værk eller en episode. Beløbet vises særskilt som primær udnyttelse og blandes ikke ind i Copydan-beregningen.

### Spillefilmsroyalty

Royalty beregnes som en procentdel af producentens relevante indtjening. Producentens opgørelse, periode, procent og beregning bevares, så beløbet kan forklares senere.

Royalty kan komme løbende og oprettes derfor som nye afregningsperioder frem for at overskrive gamle opgørelser.

## 5. Fra brutto til det, der kan fordeles

Organisationerne kan have forskellige politikker. Alle procenter administreres ét centralt sted på organisationens stamdataside, men konfigureres særskilt efter rettighedskilde og periode.

Eksempel:

```text
Stamdata → Fordelingspolitikker
├─ Verdens TV
├─ AVU
├─ Arkiv
└─ KulturPlus
```

Hver politik har versionsnummer, gyldighedsperiode og dokumentation for, hvem eller hvilket organ der har godkendt den. Gamle fordelingsrunder beholder altid den policyversion, de blev beregnet med.

Den grundlæggende rækkefølge er:

```text
Bruttorettighedsbeløb
− administration
= fordelingsgrundlag
```

Fra fordelingsgrundlaget kan organisationen afsætte:

- en hensættelse til senere krav,
- et direkte beløb til sociale aktiviteter,
- en social andel af den allerede tilbageholdte hensættelse,
- en eventuel lovbestemt kollektiv andel.

De enkelte dele kan efter den godkendte policy beregnes af forskellige grundlag, eksempelvis brutto, beløbet efter administration eller selve hensættelsen. Systemet tilbyder kun kontrollerede og validerede kombinationer og viser altid en prøveberegning, før en policy aktiveres.

Eksempel:

```text
Bruttobeløb                             100.000 kr.
Administration, 10 %                   -10.000 kr.
────────────────────────────────────────────────
Fordelingsgrundlag                      90.000 kr.

Samlet hensættelse, 5 %                 -4.500 kr.
Direkte socialt bidrag, 2 %             -1.800 kr.
────────────────────────────────────────────────
Til individuel fordeling                83.700 kr.
```

Hvis 10 % af hensættelsen går til sociale formål:

```text
Samlet hensættelse                       4.500 kr.
Social andel af hensættelsen               450 kr.
Ren kravshensættelse                     4.050 kr.
```

De 450 kr. trækkes ikke fra den individuelle fordeling igen. De er allerede en del af de 4.500 kr., der blev tilbageholdt.

En lovbestemt kollektiv andel vises og registreres separat fra organisationens almindelige sociale, kulturelle og uddannelsesmæssige midler. Procentsatsen indtastes centralt i stamdata på den relevante rettighedskildes policy og kan derfor være forskellig for eksempelvis Verdens TV og KulturPlus.

## 6. Fordeling til værker

Ved kollektive puljer får hvert værk point. Pointene bestemmer værkets andel af det beløb, der kan fordeles.

```text
Værkets point / alle værkers point
× beløb til individuel fordeling
= værkets beløb
```

Systemet skal vise beregningen og bevare de anvendte vægte. Hvis vægtene ændres næste år, ændres en gammel fordelingsrunde ikke.

SVOD springer dette trin over, fordi beløbet allerede er knyttet til et bestemt værk.

## 7. Fordeling på værket

Værkets beløb fordeles efter den godkendte procentfordeling i værkdatabasen.

Eksempel:

```text
Værkets beløb             20.000 kr.
Klipper A, 60 %           12.000 kr.
Klipper B, 40 %            8.000 kr.
```

Samme princip gælder på episodeniveau. Systemet må ikke automatisk dele lige mellem krediterede personer, hvis der findes en godkendt fordelingsnøgle.

Organisationen bestemmer, hvilke faggrupper den forvalter. En organisation kan eksempelvis forvalte klippere, mens en anden organisation forvalter andre faggrupper. Reglerne må ikke flyde mellem organisationerne.

## 8. Fuld gennemsigtighed for rettighedshaveren

Rettighedshaveren skal kunne se både den samlede pulje og sin egen andel.

Eksempel på personlig specifikation:

```text
Rettighedskasse: Netflix/SVOD
Værk: Eksempelværket
Udnyttelse: Primær
Periode: 2026

Din bruttomæssige andel                  1.000 kr.
Din andel af administration               -150 kr.
Din andel af hensættelse                   -85 kr.
Din andel af direkte sociale midler        -15 kr.
────────────────────────────────────────────────
Tildelt som rettighedsmidler               750 kr.
```

Brutto, administration, hensættelse, sociale formål og nettobeløb skal altid kunne forklares særskilt.

## 9. Tilbageholdt position eller generel hensættelse?

Dette er en central designbeslutning.

### Tilbageholdt modtagerandel

Vi ved, at en bestemt rettighedsposition findes, men vi kan endnu ikke betale den rette modtager.

Eksempel:

```text
A                               50 %
B                               30 %
Afdød C / arvinger søges        20 %
```

De 20 % bliver på værket. Når arvingerne findes, betales positionen derfra.

### Generel hensættelse

En helt ny person viser senere, at vedkommende også havde rettigheder på værket. Der var ikke reserveret en kendt position til personen. Kravet betales derfor af organisationens generelle hensættelse.

Hvis hensættelsen ikke rækker, hæfter organisationen. Rettighedshaverne kan aldrig komme til at skylde penge.

## 10. Nye krav efter en fordeling

Eksempel:

```text
Oprindeligt:
A 50 %
B 50 %

Senere godkendt:
A 33⅓ %
B 33⅓ %
C 33⅓ %
```

C får sit historiske krav fra hensættelsen eller organisationen. A og B beholder det, de allerede har fået. Fremtidige kørsler anvender den nye tredeling.

Systemet reducerer ikke A og B's fremtidige retmæssige andel for at hente den gamle overbetaling tilbage. Historikken viser situationen, men personen får ingen gæld.

## 11. Efterlysning, kravfrist og ufordelbare midler

Organisationen skal kunne offentliggøre efterlysninger af:

- ukendte rettighedshavere,
- personer uden kontaktoplysninger,
- arvinger,
- uklare rettighedsoverdragelser.

Efterlysningen gentages og dokumenteres efter organisationens politik. Systemet gemmer, hvad der blev offentliggjort, hvornår og af hvem.

For DFKS løber treårsperioden fra udgangen af det kalenderår, hvor udnyttelsen fandt sted.

Eksempel:

```text
Udnyttelsen fandt sted i 2024
Udnyttelsesåret slutter 31.12.2024
Treårsperioden løber til og med 31.12.2027
Beløbet kan tidligst vurderes som ufordelbart 01.01.2028
```

Hvis en fordelingsrunde indeholder udnyttelser fra flere år, skal systemet holde fristerne adskilt efter udnyttelsesår. Andre rettighedskasser og udenlandske organisationer kan have andre perioder eller startregler, så disse regler konfigureres pr. organisation og rettighedskilde.

Hvis et krav indsendes rettidigt, kan hensættelsen ikke behandles som ufordelbar eller omfordeles, før alle rettidige krav er færdigbehandlet.

Når systemets deadline nås, betyder det ikke automatisk, at et muligt juridisk krav er forældet. Systemet markerer i stedet beløbet som muligt ufordelbart. En særskilt, dokumenteret godkendelse afgør derefter, om og hvordan beløbet skal behandles.

## 12. Behandling af resterende hensættelse

Organisationens policy afgør, hvad der sker med ufordelbare midler. En policy kan eksempelvis vælge:

- genfordeling efter den oprindelige fordelingsnøgle,
- overførsel til kollektive midler,
- en anden individuel genfordeling,
- manuel beslutning.

DFKS' aktuelt aftalte model er genfordeling efter den oprindelige fordeling. Når deadline er nået, alle rettidige krav er afsluttet, og behandlingen er godkendt:

1. Restbeløbet føres tilbage til værkerne efter den oprindelige point-/værkfordeling.
2. På hvert værk fordeles beløbet efter den endeligt godkendte personfordeling for runden.
3. Nye rettighedshavere, der har fået godkendt krav inden fristen, indgår på lige fod.
4. Døde rettighedshaveres beløb går til deres registrerede arvinger.

Der oprettes nye tildelinger. Gamle beløb omskrives ikke.

## 13. Arvinger

Rettigheder følger værket og kan gå i arv. De er ikke afhængige af medlemskab.

Arvinger får egne lette modtagerprofiler. De dokumenterer deres relation til den afdøde og angiver eller får godkendt en intern fordeling, som samlet giver 100 %.

Når der senere kommer penge på den afdødes værker, fordeles de direkte til arvingerne efter den godkendte arvefordeling. Hver arving skal have eget CPR for at kunne få udbetalt og indberettet sin andel.

## 14. Til gode og udbetalingsgrænse

Hver organisation vælger sin egen udbetalingsgrænse i stamdata.

Grænsen gælder nettobeløbet efter alle fradrag. Når personen når grænsen, medtages alle disponible tildelinger frem til afregningens skæringsdato.

Eksempel:

```text
Copydan til gode                  310 kr.
Netflix/SVOD til gode             240 kr.
────────────────────────────────────────
I alt hos samme organisation      550 kr.
Udbetalingsgrænse                 500 kr.
Klar til afregning                550 kr.
```

Beløb fra andre organisationer må aldrig indgå.

## 15. Hvad kan blokere en udbetaling?

En person kan være over grænsen uden at være klar til udbetaling.

Mulige årsager:

- CPR mangler eller er ugyldigt.
- Identiteten er ikke endeligt verificeret.
- Arveforholdet er ikke afklaret.
- DataLøn-oplysninger mangler.
- Den nødvendige skatteklassifikation mangler.
- Der er sat et administrativt stop.
- Beløbene er allerede reserveret i en igangværende afregning.

Portalen skal vise den konkrete årsag og den nødvendige handling.

Eksempel:

```text
Rettighedsmidler til gode: 2.450 kr.
Status: Kan ikke afregnes endnu
Årsag: CPR-nummer mangler
Handling: Udfyld CPR under Profil
```

## 16. Afregning og DataLøn

Når en person er klar:

```text
Afregning oprettes
→ beløbene reserveres
→ afregningen kontrolleres
→ en anden administrator godkender
→ DataLøn-fil genereres
→ lønkørsel behandles
→ bankudbetaling bekræftes
```

En genereret eller downloadet fil betyder ikke, at pengene er udbetalt. Systemet markerer først en payout som udbetalt, når bankudbetalingen er dokumenteret.

Den konkrete DataLøn-konfiguration for B-indkomst og metoden til bankbekræftelse afventer svar.

## 17. Fire øjne

Ved følsomme eller store handlinger skal én person forberede, og en anden godkende.

Det kan blandt andet gælde:

- fordelingsrunder,
- ændrede fordelingsnøgler,
- større krav,
- omfordeling af hensættelser,
- frigivelse til DataLøn,
- bekræftelse af bankudbetaling,
- ændring af fordelingspolitik.

Organisationen skal kunne fastsætte relevante beløbsgrænser.

## 18. E-mail og portalbeskeder

Når en fordelingsrunde bogføres, får hver berørt rettighedshaver én samlet besked – ikke én mail pr. værk.

Systemet kan sende besked, når:

1. Nye rettighedsmidler er tildelt.
2. En afregning er sendt til udbetaling.
3. Udbetalingen er bekræftet gennemført.

Mailen indeholder ikke CPR eller bankoplysninger. Den henviser til den sikre portal, hvor brugeren kan se specifikationen.

Eksempel:

> DFKS har opgjort nye rettighedsmidler, som du har til gode. Log ind i portalen for at se de omfattede værker, beregningen og beløbet.

Hvis mailen fejler, forsvinder tildelingen ikke. Administrationen får i stedet mulighed for at genfremsende beskeden.

## 19. Valuta og international anvendelse

Hver organisation vælger én basisvaluta, eksempelvis DKK eller SEK. Tilgodehavender, tærskler og udbetalinger føres i denne valuta.

Organisationen kan modtage en opgørelse i eksempelvis EUR. Systemet gemmer originalt beløb, valuta, kurs og kursdato, men bogfører i organisationens basisvaluta.

Det gør det muligt at sælge portalen til udenlandske organisationer uden at blande flere valutaer i samme tilgodehavende.

## 20. Hvad systemet altid skal kunne forklare

For enhver rettighedshaver og enhver udbetaling skal systemet kunne svare på:

- Hvilken organisation forvaltede beløbet?
- Hvilken rettighedskasse kom det fra?
- Var det primær eller sekundær udnyttelse?
- Hvilket værk og hvilken periode vedrørte det?
- Hvad var bruttobeløbet?
- Hvor meget gik til administration?
- Hvor meget blev hensat til krav?
- Hvor meget gik til sociale formål?
- Hvor meget gik til en eventuel lovbestemt kollektiv andel?
- Hvilken fordelingsprocent blev brugt?
- Hvor stort et nettobeløb blev tildelt personen?
- Hvem godkendte beregningen?
- Hvornår blev beløbet afregnet og bankudbetalt?

## 21. Centrale designbeslutninger – kort fortalt

| Beslutning | Begrundelse |
|---|---|
| Lukkede organisationer | Forhindrer data- og pengestrømme på tværs af organisationer |
| Rettighedstildelinger frem for konto | Portalen dokumenterer tilgodehavender og er ikke en wallet |
| Separate rettighedskasser | Copydan, SVOD og royalty skal kunne forstås og vises særskilt |
| Centrale, kildespecifikke policies i stamdata | Organisationen får ét administrationssted uden at gøre satser globale |
| Komponentbaseret beregning | SKU, hensættelse og kollektiv andel kan have forskellige lovlige beregningsgrundlag |
| Lovbestemt kollektiv andel vises separat | Den må ikke forveksles med organisationens almindelige SKU-midler |
| Ufordelbar er ikke automatisk forældet | Deadline fører til vurdering og godkendelse, ikke automatisk juridisk konklusion |
| Historiske snapshots | Gamle beregninger må ikke ændres, når politikker ændres |
| Uforanderlig historik | Korrektioner og krav skal kunne revideres |
| Personer kan ikke skylde | Organisationen bærer risikoen for historiske fejl |
| Hensættelse kan blive negativ | Godkendte krav skal kunne honoreres, selv hvis reserven er utilstrækkelig |
| Tærskel på nettobeløb | Kun det reelle beløb til udbetaling afgør afregningen |
| Fire øjne | Reducerer risikoen ved store og følsomme dispositioner |
| DataLøn adskilt fra beregning | Portalen bevarer ejerskab over grundlag, historik og forklaring |
| Udbetalt først ved bankbekræftelse | En eksportfil er ikke bevis for modtaget betaling |

## 22. Afklaringer, der fortsat mangler

1. DFKS' konkrete DataLøn-opsætning for B-indkomst.
2. Administratorens beskrivelse af, hvordan bankudbetaling bekræftes i dag.

Disse punkter er bevidst markeret som åbne og skal ikke udfyldes med tekniske antagelser.
