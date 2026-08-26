# Handover: Visningsadmin, rettighedsforbehold og tilbageholdte positioner

## Formål

Dette dokument beskriver den aftalte forbindelse mellem Visningsadmins pointberegning, rettighedsbetalingsmodulet, kontraktvalideringen og brugerportalen.

Dokumentet er implementeringsgrundlag. Det beskriver forretningsregler og systemdesign, men er ikke i sig selv en juridisk vurdering.

## 1. Besluttede hovedregler

- Visningsadmin er kilden til godkendte visninger, værkmatch, værktype, varighed, genudsendelsesstatus og point.
- Rettighedsbetalingsmodulet er den autoritative økonomiske beregningsmotor.
- Administration, hensættelse, sociale formål og kollektiv andel må kun beregnes én gang.
- En rettighedsposition skal dokumenteres for den konkrete person, det konkrete værk og den relevante rettighedstype.
- En kontrakt er ikke den eneste tilladte dokumentation.
- Manglende eller tvetydig dokumentation tilbageholder positionen på værket.
- En tilbageholdt position tæller ikke med i personens udbetalingsklare beløb.
- Brugeren kan uploade dokumentation og kommunikere med administrator om den konkrete position.
- Administrator kan afslutte sagen manuelt med en begrundet og auditeret afgørelse.
- Allerede udbetalte personbeløb reduceres aldrig, og en rettighedshaver kan ikke komme til at skylde penge.
- Organisationerne er lukkede systemer. Data, dokumentation, kommunikation og beløb må ikke krydse organisationsgrænser.

## 2. Nuværende situation

### Visningsadmin

Visningsadmin kan allerede:

- importere og sortere visningsdata,
- matche visninger med værker og validerede kontrakter,
- fastlægge værktype og varighed,
- identificere genudsendelser,
- beregne point efter organisationens vægtkonfiguration,
- beregne værkernes andel af en pulje.

Den endelige overførsel ligger imidlertid fortsat i browserens `localStorage`. Den opretter ikke en rigtig beregningsrunde og rigtige værkbeløb i rettighedsmodulet.

### Rettighedsbetalingsmodulet

Modulet har allerede domænefelter til:

- kildebatch og kildereference,
- snapshot af vægtkonfiguration,
- point og puljeandel,
- værkets brutto- og nettobeløb,
- personfordeling,
- tilbageholdte positioner,
- afregning og efterfølgende udbetaling.

Der mangler en kontrolleret overgang fra den godkendte aftalelicensbatch til disse poster.

### Valideringsmodulet

Valideringsmodulet kan allerede identificere:

- Copydan-forbehold,
- SVOD-/streamingforbehold,
- royalty og royaltyprocent,
- kildeudsnit og dokumentationsgrundlag,
- om forholdet findes i kontrakten, følger af en regel eller kræver manuel vurdering.

Resultaterne anvendes endnu ikke som en adgangsbetingelse for rettighedstildeling.

### Kommunikation og bilag

Kontrakter har allerede:

- kontraktbundne beskeder gennem `contract_comments`,
- visning i brugerens og administratorens samlede indbakke,
- upload af kontraktbilag og allonger,
- efterfølgende dokumentanalyse.

Denne brugeroplevelse skal genbruges, men rettighedssagen skal også kunne eksistere uden en kontrakt.

## 3. Målflow

```text
Visningsdata importeres
→ visninger sorteres og godkendes
→ visninger matches med værker
→ værktype, varighed og genudsendelse fastlægges
→ point beregnes
→ pointberegningen godkendes og låses
→ rettighedsrunde oprettes
→ puljen fordeles til værker
→ værkets rettighedspositioner oprettes
→ kontraktforbehold og anden dokumentation kontrolleres
→ dokumenterede positioner tildeles personer
→ uafklarede positioner tilbageholdes på værket
→ afregning og udbetaling
```

## 4. Visningsadmin som pointkilde

En godkendt overførsel fra Visningsadmin skal levere:

- `org_id`,
- aftalelicensbatchens id,
- kildereferencer til de konkrete visningsrækker,
- værk og eventuel episode,
- udnyttelsesdato og udnyttelsesår,
- værktype,
- varighed,
- genudsendelsesstatus og anvendt faktor,
- point før og efter genudsendelsesfaktor,
- samlet antal point,
- værkets andel af pointpuljen,
- snapshot af samtlige anvendte vægte og grænseværdier.

Batchen må kun overføres én gang til samme rettighedsrunde. Genforsøg skal være idempotente.

Når en overførsel er godkendt, må senere ændringer i Visningsadmins stamdata ikke ændre den historiske runde.

## 5. Én autoritativ økonomisk beregning

Visningsadmin må gerne vise en prøveberegning, men rettighedsbetalingsmodulet beregner og bogfører de endelige beløb.

Muligheden for testberegninger på siden, hvor pointene beregnes, skal bevares. Administratoren skal fortsat kunne:

- indtaste et foreløbigt puljebeløb,
- afprøve administration, hensættelse og sociale procentsatser,
- se point og forventet beløb pr. titel, værk og episode,
- kontrollere summer og afrunding,
- ændre forudsætninger og beregne igen,
- eksportere eller dele en prøveberegning til kontrol.

En testberegning er ikke bogføring. Den må ikke oprette personlige tildelinger, ændre tilgodehavender, reservere beløb til afregning eller sende notifikationer. Brugerfladen skal tydeligt vise, om resultatet er en prøveberegning eller en godkendt og overført beregning.

Ved den endelige overførsel skal de godkendte point og beregningsforudsætninger sendes til rettighedsmodulet, som foretager den autoritative beregning og kontrollerer, at resultatet svarer til den viste prøveberegning inden for dokumenterede afrundingsregler. Afvigelser skal blokere overførslen og forklares for administratoren.

```text
Bruttobeløb
− administration
− hensættelse
− direkte sociale formål
− eventuel kollektiv andel
= individuelt fordelingsbeløb
```

Det individuelle fordelingsbeløb fordeles til værker efter point.

Et nettobeløb fra Visningsadmin må ikke sendes ind som brutto og få fradragene beregnet igen. Det ville medføre dobbelt fradrag.

Alle rundens økonomiske komponenter fordeles og afrundes kontrolleret, så summen af værkrækkerne stemmer præcist med rundens totaler i øre. En dokumenteret largest-remainder-metode eller tilsvarende deterministisk metode skal anvendes.

## 6. Rettighedspositionens identitet

Dokumentationen gælder den konkrete kombination:

```text
organisation
+ rettighedshaver
+ værk eller episode
+ rettighedstype
+ relevant kontrakt/dokumentation
+ relevant udnyttelsesperiode
```

En person kan derfor være dokumenteret for ét værk og uafklaret for et andet.

Rettighedstyperne er mindst:

- `copydan` — sekundær udnyttelse,
- `svod` — primær streamingudnyttelse,
- `royalty` — løbende royalty.

Organisationens tilladte faggrupper kontrolleres separat. Et dokumenteret forbehold gør ikke en faggruppe betalingsberettiget i en organisation, som ikke forvalter den.

## 7. Dokumentationsstatus

En rettighedssag følger som udgangspunkt dette forløb:

```text
missing_documentation
→ submitted
→ under_review
→ more_information_required
→ confirmed
eller
→ rejected
eller
→ administratively_closed
```

Danske visningsnavne:

- Mangler dokumentation.
- Dokumentation indsendt.
- Under behandling.
- Yderligere oplysninger ønskes.
- Godkendt.
- Afvist.
- Lukket administrativt.

AI-validering er beslutningsstøtte. Et automatisk fund må ikke alene frigive et beløb. Den økonomiske afgørelse skal baseres på en administratorgodkendt validering eller en særskilt manuel afgørelse.

## 8. Tilladt dokumentation

En rettighedshaver kan dokumentere positionen med:

- kontrakt,
- allonge eller kontrakttillæg,
- erklæring fra producenten om, at rettigheden er i behold,
- overdragelseserklæring,
- arvedokumentation,
- relevant korrespondance,
- anden dokumentation, som administratoren kan vurdere.

En dokumentationssag må ikke kræve `contract_id`. Det skal være muligt at dokumentere en rettighed uden at oprette en kunstig kontrakt.

Hvis en kontrakt findes, skal relevante bilag og rettighedssagen kunne vises fra både kontrakten og værket.

## 9. Brugerportal

Ved værket vises en tydelig status, når dokumentationen mangler:

> **Dokumentation for rettighedsforbehold mangler**  
> Din mulige rettighedsposition er tilbageholdt på værket, mens sagen afklares.

Brugeren skal kunne:

- se værk og eventuel episode,
- se rettighedstype,
- se sagens status,
- se hvilken dokumentation der mangler,
- åbne en eksisterende kontrakt,
- uploade dokumentation,
- skrive til administrator,
- læse administratorens svar,
- se den endelige afgørelse og begrundelse.

Et vist beløb skal betegnes som en mulig eller tilbageholdt rettighedsandel. Det må ikke indgå i “til udbetaling” eller brugerens udbetalingsgrænse.

## 10. Rettighedssag og kommunikation

Der indføres en selvstændig rettighedssag, eksempelvis `rights_entitlement_case`, med reference til:

- `org_id`,
- rettighedshaver,
- værk og eventuel episode,
- tilbageholdt position,
- rettighedstype,
- eventuel kontrakt,
- status og afgørelse.

Kommunikationen vises gennem den eksisterende samlede indbakke som en ny konteksttype. En rettighedstråd skal kunne åbnes fra:

- værket,
- kontrakten, hvis den findes,
- Mine rettighedsmidler,
- administratorens indbakke,
- administratorens oversigt over rettighedssager.

Tråden skal tydeligt vise værk, rettighedstype, eventuel kontrakt og sagsstatus.

## 11. Administratorens manuelle afgørelse

Administrator kan afslutte sagen med én af følgende årsager:

- Rettigheden er dokumenteret.
- Rettigheden er ikke dokumenteret.
- Personen har ikke rettigheden.
- Positionen er oprettet ved en fejl.
- Sagen er trukket tilbage.
- Anden begrundet afgørelse.

Afgørelsen gemmer mindst:

- administrator,
- tidspunkt,
- begrundelse,
- anvendt dokumentation,
- kontrakt- og valideringsversion,
- økonomisk konsekvens,
- eventuel anden godkender.

Hvis afgørelsen ændrer en økonomisk fordeling, skal den følge fire-øjne-princippet. Dokumenter, beskeder og historiske statusser slettes ikke ved lukning.

## 12. Økonomisk behandling mens sagen er åben

En uafklaret position:

- bliver på værket,
- er ikke en generel hensættelse,
- er ikke tildelt personen,
- tæller ikke med i udbetalingsgrænsen,
- kan ikke indgå i DataLøn-eksport,
- kan ikke markeres som udbetalt,
- reducerer ikke andre personers allerede bogførte eller udbetalte beløb.

## 13. Afgørelse før en betaling er kørt

En betaling er i denne sammenhæng ikke kørt, når rundens berørte beløb stadig kan trækkes sikkert ud af afregningsflowet. Beløb i en annullerbar kladde kan genberegnes. En frigivet løneksport behandles konservativt som kørt, også før bankens slutstatus foreligger.

### Andre dokumenterede klippere findes på værket

Den afviste andel fordeles straks mellem de resterende dokumenterede klippere på værket. Deres eksisterende fordelingsnøgle normaliseres forholdsmæssigt til 100 %.

```text
A: 50 % — dokumenteret
B: 30 % — dokumenteret
C: 20 % — afvist

Ny fordeling:
A: 62,5 %
B: 37,5 %
C:  0,0 %
```

### Ingen dokumenterede klippere findes på værket

Hvis værkets eneste position afvises før betalingen er kørt:

- værket udgår straks af den individuelle fordeling,
- værkets individuelle nettobeløb går tilbage til rundens individuelle pulje,
- beløbet fordeles mellem de øvrige værker efter deres oprindelige point,
- de øvrige værkers pointandele normaliseres til 100 %.

Administration, hensættelse, sociale formål og kollektiv andel beregnes ikke igen. Kun det individuelle nettobeløb returneres til den individuelle pulje.

## 14. Afgørelse efter en betaling er kørt

En betaling behandles som kørt, når de berørte beløb er frigivet til løn-/betalingsflowet og ikke længere sikkert kan ændres i den oprindelige afregning.

### Andre dokumenterede klippere findes på værket

Den tilbageholdte andel fordeles mellem de resterende dokumenterede klippere på værket som en supplerende tildeling eller efterbetaling.

Deres tidligere udbetalinger ændres ikke. Efterbetalingen refererer til den oprindelige runde, værket, den afviste position og afgørelsen.

### Ingen dokumenterede klippere findes på værket

Hvis den eneste position afvises efter betalingen er kørt:

- beløbet bliver stående på værket,
- andre rettighedshavere kan gøre krav gældende i kravsperioden,
- organisationens efterlysning fortsætter efter de gældende regler,
- beløbet følger treårsreglen, hvis ingen berettiget rettighedshaver findes.

Treårsfristen løber tre år efter udgangen af det år, hvor udnyttelsen fandt sted.

Efter fristen:

```text
positionen vurderes som mulig ufordelbar
→ alle rettidige krav færdigbehandles
→ særskilt og auditeret godkendelse
→ beløbet tilbageføres til den oprindelige fordelingsrunde
→ proportional fordeling efter værkernes beløb/oprindelige point
→ personfordeling efter de aktuelle godkendte fordelingsnøgler
```

Beløbet må ikke omfordeles, før alle rettidigt indsendte krav er afgjort.

## 15. Beregningsrevision og historik

Omfordeling før betaling må ikke overskrive den oprindelige beregning.

```text
Oprindelig beregning
→ rettighedssag afgjort
→ tilbageførsel registreret
→ ny beregningsrevision
→ ny godkendelse
→ afregning
```

Revisionen skal vise:

- den oprindelige position,
- afgørelsen og dokumentationen,
- beløbet, der blev tilbageført,
- den nye værk- eller personfordeling,
- afrundingsposter,
- forbereder og godkender.

Efterbetaling efter en kørt betaling oprettes som nye positive tildelinger. Historiske personbeløb bliver ikke negative og ændres ikke.

## 16. Foreslåede domæneobjekter

Navnene er konceptuelle og skal tilpasses migrationsstilen:

### `rights_entitlement_cases`

- `id`
- `org_id`
- `rights_holder_id`
- `work_id`
- `episode_id`
- `withheld_position_id`
- `contract_id`
- `right_type`
- `status`
- `opened_at`
- `resolved_at`
- `resolved_by`
- `resolution_type`
- `resolution_reason`
- `financial_effect`

### `rights_entitlement_evidence`

- `id`
- `org_id`
- `case_id`
- `contract_id`
- `attachment_type`
- `storage_path`
- `original_filename`
- `uploaded_by`
- `uploaded_at`
- `validation_id`
- `evidence_snapshot`
- `review_status`

### `rights_entitlement_case_messages`

- `id`
- `org_id`
- `case_id`
- `author_user_id`
- `author_role`
- `body`
- `created_at`
- læsemarkeringer for bruger og administrator

Alternativt kan den eksisterende indbakkemodel udvides med en organisationsbundet rettighedssagskontekst. Beskederne må ikke gemmes som almindelige kontraktkommentarer, når sagen ikke har en kontrakt.

### Beregningsrevision

Eksisterende beregnings- og justeringsobjekter skal udvides eller anvendes, så en revision kan referere til den oprindelige runde og den afgørelse, der udløste revisionen.

## 17. Sikkerhed og organisationsvægge

Alle nye objekter har obligatorisk `org_id`.

Databaseconstraints skal sikre, at:

- sag og rettighedshaver tilhører samme organisation,
- sag og værk/episode tilhører samme organisation,
- kontrakt og sag tilhører samme organisation,
- dokumentation og sag tilhører samme organisation,
- tilbageholdt position og sag tilhører samme organisation,
- beskeder og sag tilhører samme organisation.

Upload skal anvende private storage-stier med organisations- og sagsafgrænsning. Filnavne, CPR, kontrakttekst og dokumentindhold må ikke skrives i almindelige logs.

Serveroperationer skal udlede organisationen fra den autoriserede kontekst og må ikke stole på et klientleveret `org_id`.

## 18. Notifikationer

Følgende hændelser kan udløse portalbesked og e-mail:

- Dokumentation mangler.
- Dokumentation er modtaget.
- Yderligere oplysninger ønskes.
- Sagen er godkendt.
- Sagen er afvist eller lukket.
- En supplerende tildeling er bogført.

E-mailen må ikke indeholde kontrakttekst, CPR, bankoplysninger eller følsomme dokumenter. Den linker til sagen bag login.

Notifikationerne skal være idempotente pr. organisation, sag, hændelse, modtager og kanal.

## 19. Implementeringsrækkefølge

1. Bevar Visningsadmins testberegning, men fjern den økonomiske `localStorage`-overførsel som autoritativ bogføring.
2. Opret idempotent overførsel af godkendt pointgrundlag til en rettighedsrunde.
3. Indfør deterministisk fordeling og afrundingsafstemning mod rundens totaler.
4. Opret rettighedssag, dokumentationsstatus og organisationsbundne relationer.
5. Forbind godkendte kontraktvalideringer med rettighedssagen.
6. Genbrug uploadpipeline og udvid den til dokumentation uden kontrakt.
7. Tilføj portalvisning, upload og sagskommunikation.
8. Tilføj administratorafgørelse og fire-øjne-godkendelse.
9. Implementér omfordeling før kørt betaling.
10. Implementér efterbetaling og treårsflow efter kørt betaling.
11. Tilføj notifikationer, audit og administrative opgaver.
12. Gennemfør end-to-end-test i det isolerede testmiljø.

## 20. Acceptkriterier

Implementeringen er ikke færdig, før følgende er bevist:

- En godkendt aftalelicensbatch kan kun overføres én gang til samme runde.
- Pointberegningssiden kan fortsat lave gentagne prøveberegninger uden at oprette økonomiske posteringer.
- Det fremgår tydeligt, om en beregning er en prøve eller en godkendt overførsel.
- Den autoritative beregning afstemmes mod den seneste godkendte prøveberegning.
- Point, vægte og kildevisninger kan forklares fra runde til værk.
- Fradrag foretages præcist én gang.
- Værkbeløbene summerer i øre til rundens totaler.
- En person uden dokumentation får ingen udbetalingsklar tildeling.
- Brugeren kan indsende dokumentation uden at have en kontrakt.
- En producenterklæring kan godkendes som dokumentation.
- Kommunikation vises ved den konkrete rettighedssag i begge indbakker.
- En administrator kan ikke lukke en økonomisk sag uden begrundelse.
- Afvist position før betaling følger den korrekte værk-/puljeregel.
- Afvist position efter betaling følger efterbetalings-/treårsreglen.
- En frigivet eksport eller udbetalt post ændres aldrig bagudrettet.
- Alle rettidige krav er afgjort før ufordelbare midler omfordeles.
- Ingen person får negativt tilgodehavende.
- Organisation A kan ikke læse eller påvirke organisation B's sager, dokumenter, beskeder eller beløb.
- Auditsporet kan forklare hele forløbet fra visningsrække til endelig personbetaling eller omfordeling.

## 21. Afgrænsning

Denne handover ændrer ikke de fortsat åbne forhold omkring:

- konkret DataLøn-konfiguration for B-indkomst,
- den endelige tekniske bankbekræftelse,
- ekstern publiceringskanal for efterlysninger.

De punkter må ikke udfyldes med tekniske antagelser under implementeringen.
