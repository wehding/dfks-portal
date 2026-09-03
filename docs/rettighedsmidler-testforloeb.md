# Testguide: Rettighedsmidler uden efterladte testdata

## Formål

Guiden beskriver et gentageligt testforløb for rettighedsmodulet fra stamdata til portalvisning, afregning, eksport og bekræftet udbetaling. Testen må ikke efterlade økonomiske testposter, falske rettighedshavere eller notifikationer i produktionssystemet.

## Hovedregel

Et fuldt end-to-end-forløb må kun gennemføres i et separat testmiljø med:

- egen Vercel test-/preview-deployment,
- egen Supabase testdatabase,
- testorganisationer, som ikke findes i produktion,
- e-mail-sandbox eller blokeret ekstern levering,
- testeksport, som aldrig sendes til DataLøn eller bank.

Rettighedsberegninger, tildelinger og afregninger er økonomisk historik og skal flere steder være immutable. De bør derfor ikke oprettes i produktion med en forventning om senere at kunne slettes. Den sikre oprydning er at nulstille den separate testdatabase til et kendt, rent udgangspunkt.

## 1. Miljøer og tilladte testtyper

| Miljø | Tilladt | Ikke tilladt |
|---|---|---|
| Produktion | Login, navigation, læsevisninger og en aftalt smoketest af ufarlige stamdata | Falske personer, beregningsrunder, tildelinger, krav, afregninger, eksport eller udbetaling |
| Isoleret testmiljø | Hele forløbet i denne guide | Rigtige CPR-numre, bankoplysninger, DataLøn-modtagere eller e-mail til virkelige personer |
| Lokal app mod produktionsdatabase | Samme begrænsning som produktion | Må ikke behandles som et testmiljø, blot fordi brugerfladen kører lokalt |

## 2. Forudsætninger før testen

Testansvarlig skal bekræfte følgende:

- Testdeploymenten peger på testdatabasen og ikke produktionsdatabasen.
- `SUPABASE_SERVICE_ROLE_KEY` tilhører testprojektet.
- E-maillevering bruger sandbox, sink eller en fast intern testadresse.
- DataLøn-/lønintegration er slået fra eller erstattet af en testadapter.
- Testens base currency er DKK.
- Der findes en dokumenteret nulstillingsmetode: database snapshot, seed eller komplet genopbygning fra migrationer.
- Den rene starttilstand er gemt, før første testpost oprettes.

Stop testen straks, hvis miljøets projekt-id, organisationsnavn eller URL ikke tydeligt viser, at det er et testmiljø.

## 3. Fast testdatasæt

Brug et entydigt test-id i alle fritekstfelter, eksempelvis `E2E-2026-08-25-A`. Brug aldrig navne eller identifikatorer fra virkelige personer.

Opret to organisationer for at teste de faste vægge:

```text
TEST-ORG-A
TEST-ORG-B
```

I `TEST-ORG-A` oprettes:

- rettighedskasse `e2e_copydan_a`, sekundær udnyttelse og puljefordeling,
- rettighedskasse `e2e_svod_a`, primær udnyttelse og individuelt værkbeløb,
- rettighedskasse `e2e_royalty_a`, royaltyberegning,
- tre fiktive rettighedshavere: Test A, Test B og Test C,
- to fiktive værker og eventuelt en serie med to episoder,
- én fiktiv afdød rettighedsposition og to fiktive arvinger.

I `TEST-ORG-B` oprettes kun én rettighedskasse og én fiktiv rettighedshaver. Genbrug gerne samme visningsnavn som i A, men aldrig samme database-id. Det gør en lækage mellem organisationerne synlig.

Brug små, let kontrollerbare beløb, eksempelvis:

```text
Bruttobeløb:                  10.000,00 kr.
Administration:                    10 %
Hensættelse:                        5 %
Direkte sociale formål:             2 %
Udbetalingsgrænse:                500 kr.
Værkfordeling:                     60/40
Personfordeling på værk 1:         60/40
Personfordeling på værk 2:        100/0
```

Beregn forventede resultater i et separat kontrolark før testen. Brug beløb i øre og noter den forventede afrundingsrest.

## 4. Testforløb

### Trin 1 — Stamdata og organisationsisolering

1. Log ind som administrator i `TEST-ORG-A`.
2. Opret de tre rettighedskasser.
3. Kontrollér navn, kode, valuta, udnyttelsestype og beregningsmetode.
4. Deaktivér og genaktivér én kasse.
5. Opret en fordelingspolitik med gyldighedsperiode og procentsatser.
6. Se prøveberegningen, og sammenhold den med kontrolarket.
7. Aktivér policyversionen efter fire-øjne-reglen med en anden administrator, hvis reglen er slået til.
8. Skift til `TEST-ORG-B`.
9. Kontrollér, at ingen kasser, politikker eller versioner fra A kan ses eller vælges.

Bestået når data fra A hverken vises, summeres eller kan tilgås via kopierede URL’er i B.

### Trin 2 — Værker, episoder og personfordeling

1. Knyt de fiktive rettighedshavere til værkerne i A.
2. Angiv en godkendt procentfordeling på 60/40.
3. Opret en episodefordeling, der afviger fra seriens fordeling.
4. Kontrollér arv fra episode til sæson og værk, hvor en lokal nøgle mangler.
5. Kontrollér, at summen er 100 %, og at en ugyldig sum afvises.
6. Kontrollér, at faggrupper fra B ikke kan vælges i A.

### Trin 3 — Copydan/puljefordeling

1. Opret en beregningsrunde for `e2e_copydan_a`.
2. Angiv udnyttelsesår og kontrollér kravsfristen: tre år efter udgangen af udnyttelsesåret.
3. Indlæs eller indtast værkernes point/vægte.
4. Kør preview og sammenhold brutto, administration, hensættelse, sociale formål, kollektiv andel og individuelt fordelingsbeløb med kontrolarket.
5. Kontrollér værkernes 60/40-fordeling og afrunding.
6. Bogfør først, når preview er godkendt.
7. Kontrollér, at bogførte værdier og policyversion ikke ændres, hvis stamdata bagefter redigeres.

### Trin 4 — SVOD og royalty

1. Opret en SVOD-runde med et individuelt beløb på et bestemt værk.
2. Kontrollér, at beløbet vises isoleret fra Copydan.
3. Opret to royaltyperioder på samme spillefilm.
4. Kontrollér producentgrundlag, royaltyprocent, periode og beregnet beløb.
5. Kontrollér, at periode to oprettes som ny historik og ikke overskriver periode et.

### Trin 5 — Tilbageholdt position, krav og arv

1. Fordel et værk mellem A, B og en kendt, men uafklaret position.
2. Kontrollér, at den uafklarede procent bliver på værket og ikke registreres som generel hensættelse.
3. Registrér arvingerne og deres interne fordeling.
4. Løs den tilbageholdte position direkte til arvingerne.
5. Opret derefter et krav fra en helt ny fjerde rettighedshaver.
6. Kontrollér, at dette krav finansieres af den generelle hensættelse og ikke reducerer allerede tildelte personbeløb.
7. Test et krav, der er indsendt rettidigt men ikke færdigbehandlet ved treårsfristen; hensættelsen må ikke omfordeles endnu.
8. Test et afvist eller for sent krav og kontrollér auditsporet.

### Trin 6 — Ufordelbare midler og treårsregel

1. Registrér en efterlysning med kanal, tekstsnapshot og test-URL.
2. Kontrollér, at publiceringshistorikken bevares.
3. Flyt testdatoen frem til efter fristen i testmiljøet.
4. Kontrollér, at midler kun markeres som mulige ufordelbare midler — ikke automatisk omfordeles.
5. Gennemfør den særskilte, auditerede godkendelse.
6. Kontrollér proportional omfordeling efter værkbeløb og de aktuelle fordelingsnøgler i den oprindelige runde.
7. Kontrollér, at rettighedshavere, som gjorde rettidigt krav i perioden, deltager.

### Trin 7 — Portal og gennemsigtighed

1. Log ind som hver fiktiv rettighedshaver.
2. Kontrollér adskilt visning af Copydan, SVOD og royalty.
3. Kontrollér personens andel af brutto, administration, hensættelse, sociale formål og netto.
4. Sammenhold portalbeløbene med administratorvisningen og kontrolarket.
5. Kontrollér, at ingen kaldes “konto” eller “saldo”, hvis teksten antyder bankfunktionalitet.
6. Kontrollér, at samme testperson i B kun ser B’s data.

### Trin 8 — Udbetalingsgrænse og afregning

1. Sæt organisationens grænse til 500 kr.
2. Giv Test A et nettotilgodehavende under 500 kr.; personen skal afvente.
3. Bogfør endnu en løbende royalty, så nettobeløbet samlet krydser 500 kr.
4. Opret en afregning med en fast skæringsdato.
5. Kontrollér, at kun disponible tildelinger til og med skæringsdatoen medtages.
6. Kontrollér og dokumentér alle blokeringer: CPR, lønreference, arv/bo, tvist, manglende bank-/DataLøn-oplysninger og beløb under grænsen.
7. Kontrollér fire-øjne-godkendelse, hvis den er aktiveret.
8. Kontrollér, at A og B aldrig kan indgå i samme afregning.

### Trin 9 — Eksport og bekræftet udbetaling

1. Generér kun preview af DataLøn-eksporten i testmiljøet.
2. Kontrollér organisations-id, modtagere, beløb, reference og summer.
3. Kontrollér idempotens ved at forsøge samme eksport igen.
4. Download testfilen, men upload den ikke til DataLøn.
5. Markér testudbetalingen gennem det valgte manuelle testflow.
6. Kontrollér, at status først bliver “udbetalt” efter bekræftet bankudbetaling.
7. Kontrollér, at mislykket eller ukendt slutstatus ikke reducerer personens tilgodehavende som en gennemført betaling.

### Trin 10 — Notifikationer

1. Bogfør nye tildelinger og kontrollér én samlet portalbesked pr. person og runde.
2. Kontrollér e-mailen i sandboxen; den må ikke indeholde CPR eller bankoplysninger.
3. Genkør samme hændelse og kontrollér, at idempotensnøglen forhindrer dubletter.
4. Simulér mailfejl og kontrollér, at bogføringen består, mens en administrativ opgave oprettes.
5. Kontrollér beskeder ved afregning og bekræftet udbetaling.

### Trin 11 — Audit og negative sikkerhedstests

1. Kontrollér audit for oprettelse, godkendelse, statusskift, krav, eksport og udbetalingsbekræftelse.
2. Kontrollér, at CPR, service-nøgler og bankoplysninger ikke findes i logs eller auditmetadata.
3. Forsøg med administrator A at tilgå kendte objekt-id’er fra B via URL eller serverhandling.
4. Kontrollér, at læsning, opdatering og oprettelse med relationer til B afvises.
5. Kontrollér, at en rettighedshaver aldrig får negativt tilgodehavende.
6. Kontrollér, at hensættelsen kan gå i minus uden at skabe gæld hos en person.

## 5. Oprydning uden rester

### Foretrukken metode: nulstil testdatabasen

1. Gem testbeviserne uden personhenførbare eller hemmelige data.
2. Nulstil testdatabasen fra snapshot eller byg den på ny fra migrationer og godkendt seed.
3. Kør en efterkontrol, der søger efter test-id’et i alle rettighedstabeller, organisationsdata, notifikationer og auditvisninger.
4. Kontrollen skal returnere nul forretningsrækker med test-id’et.
5. Gendan e-mail- og integrationsindstillinger til testmiljøets standard.

Auditdata i et testmiljø kan have en særskilt retentionpolitik. Produktionsaudit må aldrig slettes for at rydde en test.

### Hvis testmiljøet ikke kan nulstilles

Et fuldt forløb må ikke gennemføres. Begræns testen til de trin, der ikke skaber økonomisk historik. Manuel sletning i tabellerne er ikke en godkendt standardprocedure, fordi den kan omgå audit, fremmednøgler og immutabilitetsregler.

## 6. Afsluttende godkendelsesliste

Testen er først godkendt, når:

- alle forventede beløb stemmer i øre,
- organisation A og B er dokumenteret isoleret i både UI og serverhandlinger,
- alle blokeringer forklarer præcist, hvorfor en afregning ikke er klar,
- portal, administratorvisning og eksport viser samme nettobeløb,
- notifikationer er idempotente og uden følsomme oplysninger,
- ingen testfil er sendt til DataLøn eller bank,
- testdatabasen er nulstillet og efterkontrollen er ren,
- afvigelser er registreret med test-id, trin, forventet resultat og faktisk resultat.

## 7. Kendte forudsætninger og stopklodser

Guiden beskriver det samlede design. Et trin må kun markeres som bestået, hvis funktionen både findes i brugerfladen og har de nødvendige, mindst mulige databaseprivilegier. En synlig knap er ikke i sig selv bevis for, at flowet er produktionsklart.

Følgende åbne designpunkter skal fortsat behandles som testblokeringer og ikke udfyldes med antagelser:

- konkret DataLøn-konfiguration for B-indkomst,
- dokumentation for bankudbetaling og pålidelig slutstatus,
- juridisk fortolkning af eventuelle resterende beregningsgrundlag,
- endelig håndtering af ukendte arvingers bo-/skatteforhold.

Den registrerede sikkerhedsopgave om organisationskontrollerede databaseskrivninger i den tekniske handover skal være afsluttet før produktionsklar bogføring og udbetaling.
