# Teknisk handover: Rettighedsmidler, fordeling og udbetaling

## Dokumentets formål

Dette dokument samler det aftalte systemdesign for DFKS Portals kommende modul til rettighedsmidler. Det er en teknisk og domænemæssig handover til udviklere, produktejere, administratorer, revisorer og juridiske rådgivere.

Dokumentet beskriver designet før implementering. Det er ikke en beskrivelse af færdig produktionsfunktionalitet og ikke en juridisk vurdering.

## Status

Følgende er fastlagt:

- Organisationer fungerer som lukkede systemer.
- Rettighedsmidler, tilgodehavender og udbetalinger må aldrig deles eller summeres på tværs af organisationer.
- Rettighedsmidler registreres som tildelinger og tilgodehavender, ikke som penge på en intern bankkonto eller wallet.
- Systemet skal understøtte Copydan/sekundær udnyttelse, individuel SVOD-betaling og løbende royalty.
- Administration, hensættelse og sociale formål skal beregnes og vises særskilt.
- Udbetalingsgrænsen konfigureres pr. organisation og vurderes på nettobeløbet til gode.
- Rettighedshavere kan aldrig få negativt tilgodehavende eller komme til at skylde organisationen penge.
- Organisationens hensættelse kan gå i minus, hvis godkendte krav overstiger hensættelsen.
- Krav, arvinger, efterlysninger og omfordeling skal være revisionssikre.
- DataLøn er udbetalingskanal, ikke kilde til rettighedsberegningen.

Følgende afventer ekstern afklaring:

1. Hvilken begivenhed der starter forældelses-/kravfristen.
2. Den konkrete DataLøn-konfiguration for B-indkomst.
3. Hvordan bekræftet bankudbetaling dokumenteres i praksis.

## 1. Produktgrænse og terminologi

Portalen er et system til rettighedsforvaltning og afregning. Den er ikke en bank, wallet, betalingskonto eller generel betalingstjeneste.

Brugeren kan ikke:

- indsætte egne penge,
- overføre midler til andre brugere,
- betale tredjemand,
- bruge et tilgodehavende til køb,
- modtage vilkårlige tredjepartsbetalinger,
- hæve et selvvalgt beløb.

Den foretrukne domænemodel er:

```text
Rettighedshaver
→ rettighedstildelinger
→ rettighedsmidler til gode
→ afregning
→ udbetalingsproces
→ faktisk bankudbetaling
```

Brugerrettede termer:

| Undgå | Anvend |
|---|---|
| Min konto | Mine rettighedsmidler |
| Saldo | Rettighedsmidler til gode |
| Kontopostering | Rettighedstildeling |
| Indsat på konto | Tildelt som rettighedsmidler |
| Kontohistorik | Tildelings- og udbetalingshistorik |
| Hævning | Udbetaling |
| Disponibel saldo | Klar til afregning / til gode |

Tekniske termer:

- `RightsLedger`: revisionsregister over rettighedstildelinger og deres afregningsstatus.
- `RightsAllocation`: tildeling af et beløb til en rettighedshaver.
- `RightsAdjustment`: eksplicit korrektion uden overskrivning af historik.
- `AmountDue`: det afledte nettobeløb, som er til gode.
- `Settlement`: en afregning, der samler tildelinger.
- `Payout`: behandling og faktisk udbetaling af en afregning.

En rigtig ekstern bankkonto må fortsat hedde `bankAccount`. Login- og OAuth-konti berøres heller ikke af terminologireglen.

## 2. Ufravigelig organisationsisolering

Hver organisation er et selvstændigt lukket system:

```text
Organisation
├─ egne rettighedskasser
├─ egne fordelingspolitikker
├─ egne værker og fordelingsnøgler
├─ egne rettighedstildelinger
├─ egne hensættelser og sociale midler
├─ egne afregninger og udbetalinger
└─ egen DataLøn-/lønsystemforbindelse
```

En person kan eksistere i flere organisationer, men alle økonomiske relationer er separate. Den relevante økonomiske identitet er altid:

```text
organization_id + rights_holder_id + currency
```

Systeminvarianter:

- En rettighedstildeling tilhører præcis én organisation.
- Et tilgodehavende beregnes kun inden for én organisation.
- En afregning og en payout tilhører præcis én organisation.
- En payout må aldrig indeholde tildelinger fra flere organisationer.
- En eksportbatch til DataLøn må kun indeholde én organisation.
- En organisations hensættelse må ikke dække krav i en anden organisation.
- Roller og faggrupper er betalingsberettigede pr. organisation og rettighedskasse.

### Teknisk håndhævelse

Alle økonomiske tabeller skal have obligatorisk `org_id`, også hvor organisationen kan udledes indirekte.

Databaseconstraints og organisationsbundne fremmednøgler skal sikre, at relaterede rækker har samme `org_id`. Kontrol må ikke kun ligge i brugerfladen.

Alle serveroperationer skal afgrænse med både objekt-id og `org_id`. Service-role må ikke anvendes uden eksplicit organisationskontrol. Row Level Security skal som udgangspunkt afvise adgang og kun åbne for dokumenteret organisationsrelation.

## 3. Rettighedskasser og betalingsformer

Organisationen kan have flere adskilte rettighedskasser. De deler afregningsmotor, men må ikke miste deres identitet i historik eller portal.

Eksempler:

| Kasse | Udnyttelse | Beregningsmetode |
|---|---|---|
| Copydan Verdens TV | Sekundær | Pulje, point og vægte |
| Copydan Arkiv | Sekundær | Pulje, point og vægte |
| Netflix/SVOD | Primær | Individuelt beløb på konkret værk |
| Spillefilmsroyalty | Kontraktuel/primær | Procent af producentens indtjening |

En konceptuel `RightsFund` bør mindst indeholde:

- `org_id`,
- navn og kode,
- rettighedskategori,
- udnyttelsestype (`primary`/`secondary`),
- beregningsmetode,
- base currency,
- tilladte roller/faggrupper,
- aktiv/inaktiv status.

### Copydan og kollektive puljer

Den eksisterende vægtmodel fordeler et samlet beløb til værker eller konkrete udnyttelser. Værkets beløb fordeles derefter efter den godkendte personfordeling.

### Netflix/SVOD

SVOD-beløbet hæftes direkte på det konkrete værk eller den konkrete episode. Det må ikke gå gennem Copydan-vægte eller blandes med andre værker.

### Royalty

Royalty beregnes løbende på baggrund af producentens indtægtsopgørelser. Grundlaget skal bevare:

- producent og værk,
- afregningsperiode,
- indberettet indtjening,
- eventuelle godkendte fradrag,
- royaltygrundlag,
- royaltyprocent,
- valuta og kurs,
- kontrakt-/aftalereference,
- bilag og version,
- godkendelsesstatus.

Nye producentopgørelser opretter nye perioder eller korrektioner. Historiske opgørelser overskrives ikke.

## 4. Fordelingspolitik og fleksibel beregning

Satser må ikke hardkodes. En politik skal kunne gælde for:

```text
organisation + rettighedskasse/ordning + fordelingsår eller gyldighedsperiode
```

Politikken indeholder:

- administrationsprocent,
- hensættelsesprocent,
- direkte social procent,
- social procent af hensættelsen,
- kravfristens længde og senere dens startregel,
- udbetalingsgrænse eller reference til organisationens standard,
- godkendelsesregler.

### Kanonisk beregningsrækkefølge

```text
Bruttorettighedsbeløb
− administration beregnet af brutto
= fordelingsgrundlag
```

Fra fordelingsgrundlaget beregnes uafhængigt:

```text
Samlet hensættelse
= fordelingsgrundlag × hensættelsesprocent

Direkte socialt bidrag
= fordelingsgrundlag × direkte socialprocent

Social andel af hensættelsen
= samlet hensættelse × socialprocent af hensættelsen

Ren kravshensættelse
= samlet hensættelse − social andel af hensættelsen

Individuel fordeling
= fordelingsgrundlag − samlet hensættelse − direkte socialt bidrag
```

Den sociale andel af hensættelsen må ikke trækkes fra den individuelle fordeling igen. Den er en intern klassifikation af et allerede tilbageholdt beløb.

Invariant:

```text
Brutto
= administration
+ individuel fordeling
+ ren kravshensættelse
+ direkte sociale midler
+ sociale midler fra hensættelsen
```

Alle satser og faktiske beløb snapshot'es på den godkendte kørsel. Senere politikændringer må ikke ændre historiske beregninger.

### Validering og afrunding

- Alle satser ligger mellem 0 og 100 %.
- Hensættelsesprocent + direkte social procent må ikke overstige 100 % af fordelingsgrundlaget.
- Beløb opbevares i mindste valutaenhed som heltal eller beregnes med sikker decimalaritmetik.
- Restører fordeles deterministisk, så der aldrig skabes eller mistes penge.

## 5. Beregningsrunde og værkbeløb

En godkendt beregningsrunde skal bevare:

- organisation og rettighedskasse,
- kildebatch og periode,
- bruttobeløb og valuta,
- alle anvendte satser,
- alle beregnede summer,
- vægtkonfiguration som snapshot,
- status og versionsnummer,
- udarbejder og godkender,
- bogføringstidspunkt.

Beløb hæftes ikke blot som et felt på værket. De hæftes på en konkret kombination af værk og udnyttelse, fordi samme værk kan udnyttes flere gange.

En værktildeling skal derfor kunne pege på:

- `work_id`,
- episode/sæson,
- kilderække eller udnyttelsesreference,
- visningsdato eller periode,
- genudsendelse,
- point og andel,
- bruttoandel, fradragsandele og nettobeløb.

## 6. Personfordeling

Værkets individuelle nettobeløb fordeles til rettighedshavere gennem godkendte procentandele.

Før bogføring skal systemet kontrollere:

- værket tilhører organisationen,
- alle modtagere har en organisationsrelation,
- rollerne er betalingsberettigede i organisationen og kassen,
- fordelingsnøglen er afsluttet,
- personandele plus eventuel tilbageholdt position giver 100 %,
- fordelingen anvender faktiske `share_percent` også på episodeniveau,
- beløb summerer præcist efter afrunding.

Den anvendte fordelingsnøgle snapshot'es. Ændringer opretter nye versioner og overskriver ikke den historiske nøgle.

## 7. Tilbageholdt modtagerandel og generel hensættelse

Disse begreber må ikke sammenblandes.

### Tilbageholdt modtagerandel

En konkret andel af et værks nettobeløb, hvor rettighedspositionen findes, men modtageren ikke kan fastslås eller udbetales til endnu.

Eksempler:

- afdød rettighedshaver, hvor arvinger søges,
- kendt person uden endeligt identitetsmatch,
- dokumenteret rettighedsoverdragelse med uafklaret modtager.

Andelen bliver på værket og fordelingsrunden. Et godkendt krav på netop denne position finansieres herfra.

### Generel hensættelse

Organisationens risikopulje for krav, som ikke svarer til en allerede tilbageholdt position. En helt ny fjerde rettighedshaver finansieres eksempelvis af denne hensættelse.

Hvis godkendte krav overstiger hensættelsen:

- hensættelsen kan blive negativ,
- organisationen bærer underskuddet,
- rettighedshavere får aldrig gæld eller negativt tilgodehavende.

Finansieringsregel:

```text
Krav på konkret tilbageholdt position?
├─ Ja → finansier fra positionen
└─ Nej → finansier fra den generelle hensættelse
          └─ utilstrækkelig → organisationens hensættelse går i minus
```

## 8. Nye krav og ændrede fordelingsnøgler

Eksempel: A og B fik oprindeligt 50 % hver. C dokumenterer senere en lige ret, så den korrekte fremtidige fordeling er 33⅓ % til hver.

Regler:

- C's historiske krav betales af hensættelsen eller organisationen.
- A og B beholder tidligere tildelte og udbetalte beløb.
- A og B får ingen negativ korrektion.
- Fremtidige kørsler anvender den nye fordelingsnøgle.
- Historisk overbetaling registreres til revision, men bliver ikke personlig gæld.
- Fremtidige kørsler må ikke anvendes til indirekte tilbagebetaling ved at reducere A og B under deres nye retmæssige andel.

Den oprindelige fordeling og den senere godkendte fordeling bevares som separate versioner.

## 9. Kravfrist, efterlysning og omfordeling

Den normale forventning er tre år, men fristens start afventer juridisk fortolkning. Modellen skal understøtte forskellige perioder pr. rettighedskasse, da andre ordninger eller lande kan have andre frister.

Gem mindst:

- fristgrundlag,
- startdato,
- deadline,
- juridisk note,
- status.

Et rettidigt indsendt krav blokerer omfordeling, indtil alle rettidige krav er endeligt behandlet.

### Efterlysning

Systemet skal understøtte årlige efterlysninger af:

- ukendte rettighedshavere,
- personer uden kontaktoplysninger,
- arvinger,
- uklare rettighedsoverdragelser.

For hver publicering bevares:

- publiceringsdato,
- omfattede værker og positioner,
- tekstsnapshot,
- offentlig URL,
- godkender,
- eventuel afpublicering,
- næste planlagte publicering.

Offentlig visning må ikke indeholde CPR, bankoplysninger eller unødvendige beløb.

### Omfordeling

Når fristen er udløbet, og alle rettidige krav er afsluttet:

1. Resterende generel hensættelse fordeles til værker efter den oprindelige point-/værkfordeling.
2. Inden for hvert værk anvendes den endeligt godkendte fordeling for runden.
3. Rettighedshavere, der har fået godkendt krav inden fristen, indgår på lige fod.
4. Døde rettighedshaveres andele går til deres registrerede arvinger.

Omfordeling opretter nye tildelinger. Historiske poster overskrives ikke.

## 10. Arvinger

Rettigheder følger værket og kan gå i arv. De afhænger ikke af medlemskab.

Arvinger får lette modtagerprofiler med:

- egen identitet og CPR,
- dokumenteret relation til afdøde,
- godkendt intern arvefordeling,
- egen organisationsspecifik tildelingshistorik,
- egen udbetalingsstatus.

Den interne fordeling mellem arvinger skal give 100 %. Nye midler beregnes fortsat via afdødes rettighedsposition og fordeles derefter direkte til arvingerne. Den afdødes historik bevares.

## 11. Tilgodehavende og udbetalingstærskel

Tilgodehavendet afledes af rettighedstildelinger og afregninger. Der må ikke være et frit mutérbart globalt saldofelt.

```text
Tilgodehavende
= tildelte rettighedsmidler
+ positive korrektioner
− beløb reserveret i aktive afregninger
− udbetalte beløb
```

Beløbet kan aldrig være negativt for personen.

Udbetalingsgrænsen:

- konfigureres pr. organisation i stamdata,
- gælder nettobeløbet efter alle fradrag,
- vurderes kun inden for organisationen,
- anvender alle disponible tildelinger til og med en præcis skæringsdato,
- medfører, at hele tilgodehavendet afregnes, når grænsen nås.

Kasser kan samles i én afregning inden for samme organisation, men skal forblive særskilte linjer i specifikationen.

## 12. Udbetalingsklarhed

At være over tærsklen er ikke det samme som at være klar til udbetaling.

Mulige blokeringer:

- manglende eller ugyldigt CPR,
- uafklaret identitet eller arveforhold,
- manglende DataLøn-reference,
- manglende skatte-/betalingsklassifikation,
- administrativt stop,
- eksisterende aktiv afregning med de samme tildelinger.

Portalen skal vise konkret årsag og nødvendig handling.

## 13. Afregning, payout og DataLøn

En afregning samler konkrete tildelinger. Tildelingerne reserveres atomisk, så de ikke kan komme med i to afregninger.

Foreslået statusforløb:

```text
draft
→ calculated
→ awaiting_approval
→ approved
→ ready_for_payout
→ export_generated
→ submitted
→ payroll_processed
→ paid
```

Alternative slutstatusser: `failed` og `cancelled`.

`export_generated` betyder kun, at en fil er genereret. `paid` må først anvendes ved bekræftet bankudbetaling.

DataLøn er provider bag en lille lønsystemabstraktion. Kernedomænet må ikke kende DataLøn-felter eller lønarter. Første integration bør baseres på officiel importfil; direkte API kan tilføjes senere uden at ændre afregningsobjektet.

En ekstern modtagerreference identificeres med:

```text
org_id + rights_holder_id + provider
```

## 14. Fire-øjne-godkendelse

Systemet skal understøtte, at udarbejder og godkender er forskellige personer:

```text
prepared_by_user_id != approved_by_user_id
```

Det bør mindst kunne anvendes på:

- endelig bogføring af fordelingsrunde,
- ændring af godkendt fordelingsnøgle,
- større krav,
- omfordeling af udløbne hensættelser,
- DataLøn-eksport/frigivelse,
- manuel bekræftelse af bankudbetaling,
- ændring af fordelingspolitikker.

Beløbsgrænser og præcis anvendelse konfigureres pr. organisation.

## 15. Valuta

Hver organisation har én base currency. Saldi, tærskler og payouts føres i denne valuta.

Organisationen kan tillade input i eksempelvis lokal valuta og EUR. Originalt beløb, valuta, kurs, kursdato og konverteret beløb bevares. Bogføring og udbetaling sker i base currency, så tilgodehavendet ikke er en skjult blanding af valutaer.

## 16. Gennemsigtighed i portalen

For hver tildeling skal rettighedshaveren kunne se:

- organisation og rettighedskasse,
- primær eller sekundær udnyttelse,
- værk og episode,
- periode eller udnyttelsesdato,
- personens procent,
- bruttomæssig andel,
- andel af administration,
- andel af samlet hensættelse,
- direkte sociale midler,
- sociale midler fra hensættelsen,
- nettobeløb tildelt personen.

Portalvisningen skal kunne vise både den samlede puljeopgørelse og personens egen andel fra brutto til netto.

## 17. Notifikationer

Ved endelig bogføring oprettes én organisationsspecifik portalbesked og e-mail pr. berørt rettighedshaver, ikke én mail pr. værk.

Hændelser:

1. Nye rettighedsmidler er tildelt.
2. En afregning er sendt til udbetaling.
3. Bankudbetalingen er bekræftet gennemført.

Mailen må ikke indeholde CPR eller bankoplysninger. Den fulde specifikation ligger bag login.

Notifikationer skal være idempotente og have status, antal forsøg og fejl. Mailfejl må ikke rulle bogføringen tilbage. Manglende e-mail skal vises som administrativ opgave.

## 18. Audit, sikkerhed og historik

- CPR og lønsystemcredentials krypteres og behandles server-side.
- CPR må ikke fremgå af almindelige logs eller auditmetadata.
- Alle godkendelser, eksporthandlinger, kravsafgørelser og statusændringer auditeres.
- Økonomisk historik slettes ikke ved udmeldelse eller deaktivering af login.
- Rettighedsbetaling afhænger af arbejdet på værket, ikke medlemskab.
- Historiske tildelinger og beregninger er immutable; rettelser sker gennem nye poster.
- Bogføring og reservation af tildelinger skal ske atomisk og idempotent.

## 19. Foreslåede domæneobjekter

Navnene er konceptuelle og skal tilpasses repositoryets migrationsstil:

- `rights_funds`
- `distribution_policies`
- `rights_calculation_runs`
- `rights_work_allocations`
- `rights_allocations`
- `rights_adjustments`
- `withheld_beneficiary_positions`
- `reserve_entries`
- `royalty_statements`
- `rights_claims`
- `rights_holder_search_publications`
- `inheritance_relations`
- `settlements`
- `settlement_items`
- `payouts`
- `payroll_recipient_references`
- `payroll_export_batches`
- `payroll_export_batch_items`
- `rights_notifications`

Alle økonomiske objekter skal være organisationsbundne.

## 20. Anbefalet implementeringsrækkefølge

1. Domænetyper, pengearitmetik og fordelingspolitik.
2. Beregningsrunder og værkbeløb med snapshots.
3. Personfordeling og rettighedstildelinger.
4. Portalens rettighedsoversigt og gennemsigtighed.
5. Tilbageholdte positioner, hensættelsesregister og krav.
6. Efterlysninger og arvingeprofiler.
7. Afregning, tærskel, blokeringer og fire øjne.
8. Notifikationer.
9. DataLøn-importfil og eksporthistorik.
10. Senere DataLøn-API og statusintegration.

## 21. Åbne beslutninger

### Juridisk

- Hvilken begivenhed starter kravfristen?
- Skal enkelte rettighedskasser have andre frister?

### DataLøn og skat

- Hvilken DataLøn-lønart/importklassifikation anvendes til B-indkomst?
- Hvilke obligatoriske felter og filformater gælder?

### Bankbekræftelse

- Hvordan sikrer DFKS i dag, at en bankudbetaling faktisk er gennemført?
- Skal første version bruge manuel bekræftelse, DataLøn-status eller bankafstemning?

Disse punkter må ikke udfyldes med antagelser i implementeringen.

