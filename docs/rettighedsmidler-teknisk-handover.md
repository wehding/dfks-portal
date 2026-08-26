# Teknisk handover: Rettighedsmidler, fordeling og udbetaling

## Dokumentets formål

Dette dokument samler det aftalte systemdesign for DFKS Portals kommende modul til rettighedsmidler. Det er en teknisk og domænemæssig handover til udviklere, produktejere, administratorer, revisorer og juridiske rådgivere.

Dokumentet beskriver designet før implementering. Det er ikke en beskrivelse af færdig produktionsfunktionalitet og ikke en juridisk vurdering.

Det samlede testforløb og kravene til oprydning findes i [Testguide: Rettighedsmidler uden efterladte testdata](./rettighedsmidler-testforloeb.md).

Forbindelsen fra Visningsadmins pointgrundlag til rettighedsbetaling samt dokumentation af kontraktforbehold er beskrevet i [Handover: Visningsadmin, rettighedsforbehold og tilbageholdte positioner](./handover-visningsadmin-rettighedsforbehold.md).

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

1. Den konkrete DataLøn-konfiguration for B-indkomst.
2. Hvordan bekræftet bankudbetaling dokumenteres i praksis.

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

Politikker administreres centralt på organisationens stamdataside, men en sats er aldrig global for hele platformen. En politik er afgrænset til organisation, rettighedskilde og gyldighedsperiode. Stamdata skal eksempelvis kunne vise separate, versionerede politikker for Verdens TV, AVU, Arkiv og KulturPlus.

Politikken indeholder:

- administrationsfradrag,
- hensættelse til efterfølgende krav,
- en eller flere SKU-komponenter til sociale, kulturelle og uddannelsesmæssige formål,
- eventuel lovbestemt kollektiv andel,
- beregningsgrundlag og kontrolleret rækkefølge for hver komponent,
- kravperiodens længde og startregel,
- behandling af ufordelbare midler,
- godkendelsesorgan, dato og dokument-/beslutningsreference,
- fire-øjne- og øvrige godkendelsesregler.

Udbetalingsgrænsen administreres også på stamdatasiden, men er almindelig organisationsstamdata og ikke en del af den enkelte fordelingsberegning.

### Komponentbaseret beregningsmodel

Administration beregnes som udgangspunkt først:

```text
Bruttorettighedsbeløb
− administration beregnet af brutto
= fordelingsgrundlag
```

De efterfølgende fradrag og klassifikationer oprettes som begrænsede, validerede policykomponenter. Systemet er ikke en fri formelbygger. En komponent har mindst type, procentsats, beregningsgrundlag, rækkefølge og aktiv-status.

Tilladte komponenttyper omfatter:

- `CLAIM_RESERVE`,
- `SKU_DIRECT`,
- `SKU_FROM_RESERVE`,
- `STATUTORY_COLLECTIVE_SHARE`.

Tilladte beregningsgrundlag skal mindst kunne omfatte:

- bruttovederlag,
- beløb efter administration,
- kravshensættelsen,
- resterende individuelt fordelbart beløb.

Den tidligere aftalte model kan dermed udtrykkes som:

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

`SKU_FROM_RESERVE` beregnes altid af den oprindeligt beregnede, samlede hensættelse, før hensættelsen opdeles i SKU og ren kravshensættelse. Beregningsgrundlaget bør derfor navngives entydigt, eksempelvis `ORIGINAL_CLAIM_RESERVE`. Hvis flere SKU-komponenter beregnes af hensættelsen, bruger de samme oprindelige grundlag, og deres samlede procent må ikke overstige 100 % af hensættelsen. Rækkefølgen mellem disse interne SKU-komponenter må ikke ændre resultatet.

En lovbestemt kollektiv andel er en selvstændig komponent og må ikke bogføres eller rapporteres som almindelig SKU. Procentsatsen indtastes centralt i den relevante kildes fordelingspolitik på stamdatasiden. Den kan variere mellem organisationer, kilder og perioder og skal have gyldighedsdato, policyversion og godkendelsesreference.

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

Når en anvendt policy ændres, oprettes en ny version. En policyversion, der allerede er brugt af en fordelingsrunde, er read-only.

### Validering og afrunding

- Alle satser ligger mellem 0 og 100 %.
- Den samlede komponentberegning må ikke skabe et negativt individuelt fordelbart beløb.
- Komponentafhængigheder må ikke være cirkulære.
- Kildespecifikke minimumskrav skal ligge i policy-/regelmotoren og ikke som spredt frontendlogik.
- Beløb opbevares i mindste valutaenhed som heltal eller beregnes med sikker decimalaritmetik.
- Restører fordeles deterministisk, så der aldrig skabes eller mistes penge.

Stamdatasiden skal altid vise en beregningspreview, før en ny policyversion kan godkendes og aktiveres.

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
- udnyttelsesår og den afledte fristgruppe,
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

Fordelingsnøgler kan gælde på værk-, sæson- eller episodeniveau. Den effektive nøgle vælges med denne prioritet:

```text
eksplicit episodenøgle
→ ellers eksplicit sæsonnøgle
→ ellers værkets nøgle
```

En episode arver altså seriens eller værkets nøgle, medmindre den har en godkendt override. Den effektive nøgle og dens scope snapshot'es på tildelingen. En tilbageholdt modtagerposition følger samme scope; en episodeoverride må derfor have sin egen tilbageholdte position uden at ændre resten af sæsonen.

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

## 9. Kravfrist, efterlysning og ufordelbare midler

For DFKS løber treårsperioden fra udgangen af det kalenderår, hvor udnyttelsen fandt sted. En udnyttelse i 2024 har derfor deadline ved udgangen af 31. december 2027 og kan tidligst vurderes som ufordelbar fra 1. januar 2028.

```text
claim_period_start = 31. december i udnyttelsesåret
claim_deadline = claim_period_start + 3 år
eligible_for_undistributable_at = dagen efter claim_deadline
```

Udnyttelsesåret skal komme fra den konkrete udnyttelse/visning og snapshot'es på værktildelingen. En fordelingsrunde med udnyttelser fra flere kalenderår skal opdeles i fristgrupper, så midler fra forskellige udnyttelsesår ikke får samme deadline ved en fejl.

Modellen skal fortsat understøtte andre perioder og startregler pr. organisation og rettighedskilde, fordi andre ordninger eller lande kan have andre regler.

Gem mindst:

- fristgrundlag,
- startdato,
- deadline,
- juridisk note,
- status.

Et rettidigt indsendt krav blokerer behandling af restmidler, indtil alle rettidige krav er endeligt behandlet.

At nå en deadline er ikke det samme som, at et juridisk krav automatisk er forældet. Når deadline er nået, kan restbeløbet få status `eligible_for_undistributable`. En særskilt, auditeret og om nødvendigt fire-øjne-godkendt handling klassificerer det derefter som ufordelbart.

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
- publiceringskanal og eventuel offentlig URL,
- godkender,
- eventuel afpublicering,
- næste planlagte publicering.

Offentlig visning må ikke indeholde CPR, bankoplysninger eller unødvendige beløb.

Efterlysningen kan publiceres på en ekstern organisationsside, eksempelvis dfks.dk, eller på en særskilt offentligt tilgængelig side i portalen. Den almindelige brugerportal forbliver bag login. Publiceringsregistreringen skal derfor have en kanal, eksempelvis `external_url`, `portal_public_page` eller `other`, samt tekstsnapshot og en valgfri URL. Systemet må ikke antage, at alle organisationer hoster efterlysningen i portalen.

### Behandling af ufordelbare midler

Behandlingen konfigureres på fordelingspolitikken. Muligheder skal mindst kunne omfatte:

- genfordeling efter oprindelig værk-/fordelingsnøgle,
- overførsel til kollektive midler,
- anden individuel genfordeling,
- manuel beslutning.

DFKS' aktuelt aftalte standard er genfordeling efter den oprindelige værkfordeling. Når fristen er nået, alle rettidige krav er afsluttet, og behandlingen er godkendt:

1. Resterende generel hensættelse fordeles til værker efter den oprindelige point-/værkfordeling.
2. Inden for hvert værk anvendes den endeligt godkendte fordeling for runden.
3. Rettighedshavere, der har fået godkendt krav inden fristen, indgår på lige fod.
4. Døde rettighedshaveres andele går til deres registrerede arvinger.

Omfordeling opretter nye tildelinger. Historiske poster overskrives ikke.

### Hensættelsens livscyklus

Hensættelsen er et selvstændigt subsystem med eksplicitte bevægelser for oprettelse, godkendte krav, frigivelser, SKU fra hensættelsen og behandling af ufordelbare midler. Resterende beløb afledes af disse bevægelser og må ikke kun bero på et frit mutérbart saldofelt.

Relevante statusser omfatter:

```text
active
partially_used
deadline_reached
awaiting_open_claims
eligible_for_undistributable
undistributable
treatment_approved
redistributed / transferred_to_collective_funds
closed
```

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
Tilgodehavende i organisationens base currency
= tildelte rettighedsmidler bogført i base currency
+ positive korrektioner i base currency
− beløb reserveret i aktive afregninger i base currency
− udbetalte beløb i base currency
```

Beløbet kan aldrig være negativt for personen.

Udbetalingsgrænsen:

- konfigureres pr. organisation i stamdata,
- gælder nettobeløbet efter alle fradrag,
- vurderes kun inden for organisationen,
- anvender alle disponible tildelinger til og med en præcis skæringsdato,
- medfører, at hele tilgodehavendet afregnes, når grænsen nås.

Kasser kan samles i én afregning inden for samme organisation, men skal forblive særskilte linjer i specifikationen.

Skæringsdatoen gemmes som det immutable felt `settlement.cutoff_at` ved oprettelse af afregningen. Alle tildelinger med `available_at <= cutoff_at`, som opfylder de øvrige krav, kan medtages. Skæringsdatoen bestemmes enten af en organisationsspecifik afregningskalender eller af en autoriseret administrator ved en manuel kørsel. Standardkadence og tilladte regler kan administreres i Stamdata, men skæringsdatoen er ikke en del af fordelingspolitikken, fordi den styrer afregning og ikke beregningen af rettighedsbeløbet.

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
- behandling af hensættelser, der kan klassificeres som ufordelbare,
- DataLøn-eksport/frigivelse,
- manuel bekræftelse af bankudbetaling,
- ændring af fordelingspolitikker.

Beløbsgrænser og præcis anvendelse konfigureres pr. organisation.

## 15. Valuta

Hver organisation har én base currency. Tilgodehavender, tærskler og payouts føres i denne valuta.

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
- eventuel lovbestemt kollektiv andel,
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

Idempotens håndhæves med en unik nøgle pr. organisation, hændelse, forretningsobjekt, modtager og kanal:

```text
(org_id, event_type, subject_type, subject_id, rights_holder_id, channel)
```

`subject` er eksempelvis en fordelingsrunde ved besked om nye tildelinger og en payout ved besked om udbetaling. Nøglen ligger ikke på den enkelte rettighedstildeling, fordi én besked kan samle mange tildelinger fra samme runde. Genforsøg genbruger samme notifikationsrække og opretter ikke en ny besked.

## 18. Audit, sikkerhed og historik

- CPR og lønsystemcredentials krypteres og behandles server-side.
- CPR må ikke fremgå af almindelige logs eller auditmetadata.
- Alle godkendelser, eksporthandlinger, kravsafgørelser og statusændringer auditeres.
- Økonomisk historik slettes ikke ved udmeldelse eller deaktivering af login.
- Rettighedsbetaling afhænger af arbejdet på værket, ikke medlemskab.
- Historiske tildelinger og beregninger er immutable; rettelser sker gennem nye poster.
- Bogføring og reservation af tildelinger skal ske atomisk og idempotent.

### Registreret hærdningsopgave: skrivning uden generel `service_role`

Stamdatahandlingerne anvender aktuelt en server-side Supabase-klient med `service_role`. Rollen kan omgå RLS. Sikkerheden afhænger derfor både af, at service-nøglen aldrig sendes til browseren, og at hver serverhandling udleder `org_id` fra den autoriserede brugers aktive organisationskontekst. Klienten må aldrig acceptere et vilkårligt `org_id` fra formularen.

Den midlertidige tabeladgang skal følge princippet om mindst mulige rettigheder: kun navngivne tabeller og kun de nødvendige operationer. Der må ikke gives `GRANT ALL` til hele rettighedsmodulet. Ændringer i grants skal gennemgås som sikkerhedsændringer.

Før modulet håndterer endelige økonomiske posteringer eller udbetalinger, skal skrivninger hærdes med organisationskontrollerede databasefunktioner eller en tilsvarende databasehåndhævet mekanisme. Målet er, at databasen selv afviser en operation, hvis den autoriserede aktørs organisation, inputrækker og relaterede objekter ikke har samme `org_id`.

Hærdningen er først afsluttet, når:

- skrivefunktionerne har et fast `search_path` og mindst mulige `EXECUTE`-rettigheder,
- klientleveret `org_id` ignoreres eller kontrolleres mod en betroet serverkontekst,
- sammensatte fremmednøgler fortsat forhindrer relationer på tværs af organisationer,
- automatiske tests beviser, at læsning, oprettelse og ændring på tværs af organisationer afvises,
- direkte tabelrettigheder for `service_role` tilbagekaldes, hvor de er erstattet af de kontrollerede funktioner,
- service-nøglen fortsat kun findes i servermiljøet og aldrig logges eller eksponeres til browseren.

Opgaven er en sikkerhedsmæssig forudsætning for produktionsklar bogføring og udbetaling, men blokerer ikke isoleret administration af rettighedskasser og fordelingspolitikker med de begrænsede grants.

## 19. Foreslåede domæneobjekter

Navnene er konceptuelle og skal tilpasses repositoryets migrationsstil:

- `rights_funds`
- `distribution_policies`
- `distribution_policy_versions`
- `distribution_policy_components`
- `rights_calculation_runs`
- `rights_work_allocations`
- `rights_allocations`
- `rights_adjustments`
- `withheld_beneficiary_positions`
- `reserve_entries`
- `undistributable_fund_actions`
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

### Forhold til eksisterende skema

Implementeringen forventes mindst at kræve:

- `organisations.base_currency`,
- udnyttelsesdato/-år og fristgruppe på den konkrete udnyttelse eller `rights_work_allocation`, ikke på det tidløse værk eller episoden,
- en mange-til-mange-arverelation med procentfordeling; ét `inherited_from_id` på rettighedshaveren er utilstrækkeligt, fordi én afdød kan have flere arvinger,
- de nye policy-, tildelings-, hensættelses-, afregnings- og notifikationstabeller.

Den eksisterende `agreement_percentage_rules` skal ikke genbruges som `distribution_policy_components`. Tabellen er knyttet til overenskomster og bruges som struktureret kontekst for kontrakt-/lønberegning; dens oprindelige migration angiver udtrykkeligt, at den ikke er automatisk fordelingsberegning. Royalty-, SVOD- og Copydan-labels i tabellen beskriver kontraktvilkår. Fordelingspolitikker beskriver derimod organisationens faktiske behandling af modtagne rettighedsvederlag. Modellerne skal holdes adskilt og kan senere forbindes gennem eksplicitte referencer, hvis et kontraktvilkår leverer input til en rettighedsberegning.

## 20. Anbefalet implementeringsrækkefølge

1. Domænetyper, pengearitmetik samt versionerede fordelingspolitikker og komponenter på stamdatasiden.
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

### DataLøn og skat

- Hvilken DataLøn-lønart/importklassifikation anvendes til B-indkomst?
- Hvilke obligatoriske felter og filformater gælder?

### Bankbekræftelse

- Hvordan sikrer DFKS i dag, at en bankudbetaling faktisk er gennemført?
- Skal første version bruge manuel bekræftelse, DataLøn-status eller bankafstemning?

Disse punkter må ikke udfyldes med antagelser i implementeringen.
