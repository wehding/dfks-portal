# Privat PDF-normalisering på Cloud Run

PDF-filer med et fuldt brugbart tekstlag markeres som `not_required`. Hvis en PDF har
billedsider eller ulæselige sider, rasteriseres alle dens sider. De rå sider sendes
direkte til synkron Google Cloud Vision OCR på EU-endpointet. Den søgbare afledte PDF
genopbygges af kilderastrene og Visions ordkoordinater; originalfilen overskrives aldrig.
Tekstmaskeringen før den separate AI-kontraktanalyse er uændret og ligger i portalen.

Tjenesten må kun deployes som en privat Cloud Run-service. Cloud Scheduler får rollen
`Cloud Run Invoker`; `allUsers` og `allAuthenticatedUsers` må ikke tilføjes.

Miljøvariabler:

- `PORTAL_BASE_URL`: portalens production-origin.
- `OCR_CLOUD_RUN_AUDIENCE`: samme faste audience som portalen verificerer.
- `SUPABASE_URL` og `SUPABASE_ANON_KEY`: offentlige projektværdier; aldrig service-role.
- `GOOGLE_CLOUD_PROJECT`: Google Cloud-projektet.
- `GOOGLE_VISION_LOCATION=eu`: låser både ressourcevej og endpoint til EU.
- `OCR_TMP_DIR=/mnt/ramdisk`: anbefalet memory volume i Cloud Run.

Cloud Run-servicekontoens mail gemmes i portalen som `OCR_CLOUD_RUN_SERVICE_ACCOUNT`.
Tjenesten henter et Google-signatureret ID-token fra metadata-serveren. Den modtager
kun tidsbegrænset adgang til én inputfil og én outputsti ad gangen.

HTTP-servicen og batchjobbet bruger begge `processor.mjs`, så sikkerhedskontroller og
OCR-adfærd ikke kan drive fra hinanden.

Entrypoints:

- `node server.mjs`: privat HTTP-service med `POST /run` (ét dokument) og `GET /health`.
- `node backfill.mjs`: batchjob, der fortsætter til køen er tom eller taskens grænse nås.

`OCR_MAX_DOCUMENTS_PER_TASK` styrer batchgrænsen. `0` eller manglende værdi betyder
hele den claimbare kø; et positivt heltal sætter et maksimum pr. task. Pilotkørslen
bruger `4`, mens fuld backfill bruger `0`.

`OCR_MAX_CONSECUTIVE_FAILURES` styrer taskens driftsstop. Pilotkørslen bruger `1`, så
den første driftsfejl stopper piloten. Fuld backfill bruger `5`. Dokumenter, der
korrekt klassificeres som `needs_review`, tæller ikke som driftsfejl.

OCR-kvalitet har en separat, fail-closed stopregel. Et enkelt `needs_review` kan
fortsætte i et fuldt run, men kvalitetstasken stopper ved højst fem sammenhængende
`ocr_unreadable_page`, `ocr_spatial_quality` eller orienteringsfejl. Den stopper også,
når mere end 50 % af mindst ti senest behandlede dokumenter har en sådan fejl. Et
pilotrun med `OCR_MAX_DOCUMENTS_PER_TASK=4` stopper altid ved første kvalitetsfejl.
Følgende indstillinger kan kun gøre porten strammere eller ændre det rullende vindue:

- `OCR_MAX_CONSECUTIVE_QUALITY_FAILURES`: `1`–`5`, standard `5`.
- `OCR_QUALITY_FAILURE_WINDOW`: `10`–`100`, standard `10`.
- `OCR_MAX_QUALITY_FAILURE_RATE_PERCENT`: `1`–`50`, standard `50`; stop sker ved
  en andel, der er større end værdien.

Ugyldige værdier afvises ved taskstart. Diagnoserne bruges kun internt til
stopreglen; slutloggen indeholder fortsat kun sikre antal.

HTTP-servicen bruger som standard en intern tidsgrænse på 13 minutter
(`OCR_PROCESSING_DEADLINE_SECONDS=780`), så completion-callbacken kan nå at frigive
jobbet før Cloud Runs 15-minutters request-timeout. Backfill-jobbet bruger
`OCR_PROCESSING_DEADLINE_SECONDS=0`, fordi task-timeoutet er 12 timer.

Et dokument må højst have 200 sider, 64 MiB bevaret kilderaster og 128 MiB samlet
kilde- og Vision-transportraster. Overskridelser sendes til manuel kontrol i stedet for at kunne
udtømme en 2 GiB-instans. Grænserne kan kun strammes i tests, aldrig hæves ved runtime.

Supabase er eneste kø. Tre Cloud Run-tasks kan arbejde parallelt, fordi portalens
claim-funktion bruger en atomisk `FOR UPDATE SKIP LOCKED`-claim. Workerens image må
kun få de offentlige Supabase-oplysninger; service-role, AI-nøgler og permanente
Google-nøgler må aldrig tilføjes. Produktionsprocessen afviser opstart, hvis
`OCR_TMP_DIR` ikke peger på den monterede memory volume `/mnt/ramdisk`.

Det midlertidige DLP-erstatningsjob skal have `OCR_REPLACEMENT_ONLY=true`. Det får
workeren til at markere claim-kaldet, og portalen bruger derefter en separat
service-only databaseclaim, som kun kan tage jobs med `replacement_of_job_id`.
Tilstanden opretter aldrig automatiske recovery-generationer. Den almindelige
Scheduler-service må ikke have variablen, så fremtidige uploads fortsat bruger den
normale kø. Andre stavemåder end de eksakte værdier `true` og `false` afvises.

Den særskilte engangskørsel, der supplerer ældre kontrakter med direkte Vision-v3-
geometri, bruger i stedet `OCR_GEOMETRY_BACKFILL_RUN_ID=<uuid>`. Variablen bindes
til præcis én databasegodkendt kohorte og sender run-id'et med hvert claim. Den må
aldrig bruges sammen med `OCR_REPLACEMENT_ONLY`; workeren afviser kombinationen ved
opstart. Den almindelige Scheduler-service må heller ikke have run-id'et.

### Runbundet recovery af fem kendte støjende slutsider

De fem på forhånd undersøgte slutsider, hvor scannerstøj ellers giver et falsk
OCR-ord, kan kun behandles i en særskilt engangskørsel med et privat proof-manifest.
Dette er ikke en generel blank-side-undtagelse. Den eksisterende fire-variant-
Vision-kontrol og begge stramme rasterkontroller skal fortsat bestå.

Manifestet har et eksakt versionsstyret schema og binder hver tilladelse til:

- det konkrete geometri-run;
- originalfilens SHA-256;
- slutsidens nummer og dokumentets sideantal;
- SHA-256 af workerens faste kilderaster;
- SHA-256 af en separat, fast recovery-raster;
- et udløbstidspunkt på højst 48 timer.

Manifestet indeholder præcis de fem godkendte anvendelser til denne recovery. Det
opbevares som en konkret, nummereret Secret Manager-version (aldrig `latest`) og
monteres read-only **kun** på det midlertidige Cloud Run Job. Mountet bruger en
fast absolut filsti og Cloud Runs skrivebeskyttede secret-volume-mode. Jobbet får filstien i
`OCR_TAIL_BLANK_PROOF_FILE`. HTTP-servicen må hverken have secret-mountet eller
miljøvariablen; service-entrypointet afviser konfigurationen før filen læses.
Et almindeligt backfill uden det eksakte `OCR_GEOMETRY_BACKFILL_RUN_ID` kan heller
ikke bruge manifestet.

Selve geometriartefaktet gemmer kun recoveryprofil, manifestdigest og slutsidetal.
Rå original-, raster- og dokumenthashes, run-id, dokument-id, storage-stier og
kontraktindhold må ikke gemmes i artefakt, callback eller logs. Ingen database- eller
callback-undtagelse er nødvendig: den eksisterende lease-, run-, originalhash- og
artefakthashbinding forbliver autoritativ.

Slutauditten skal køres med en lokal, ejerbeskyttet kopi af manifestet (absolut sti,
mode `0600`). Den genrenderer originalen med workerens to faste Poppler-profiler og
kræver præcis fem unikke, matchende anvendelser; en manglende, ekstra, dubleret eller
ændret anvendelse blokerer kvalitetsgodkendelsen. Historiske jobs uden denne særlige
recoveryprofil kan fortsat auditeres uden manifestet.

Efter en godkendt zero-violation-audit skal driftsoperatøren:

1. fjerne `OCR_TAIL_BLANK_PROOF_FILE` og secret-mountet fra Cloud Run Jobbet;
2. deaktivere Secret Manager-versionen og fjerne Job-servicekontoens adgang;
3. kontrollere, at HTTP-servicen aldrig har fået secret, env-binding eller adgang;
4. beholde Scheduler pauset, indtil hele geometri-backfillens almindelige
   kvalitetsport er godkendt.

Før kølægning oprettes én ejerbeskyttet baselinefil med de præcise 251 kilder. Den
binder kontrakt, kildejob, originalhash, sideantal, hash af originalstien samt
kontraktens forretnings- og dokumentstatus. Hele kohorten genvælges og verificeres
umiddelbart før den atomiske kølægning. Den nye skemamigration skal være anvendt,
før baselinekommandoerne køres, men ingen jobs må være kølagt endnu:

```bash
OCR_GEOMETRY_BACKFILL_BASELINE_PATH=/private/tmp/dfks-vision-v3-geometry-baseline.json \
OCR_GEOMETRY_BACKFILL_EXPECTED_COUNT=251 \
  node scripts/audit-ocr-backfill.mjs capture-geometry-backfill-baseline

OCR_GEOMETRY_BACKFILL_BASELINE_PATH=/private/tmp/dfks-vision-v3-geometry-baseline.json \
OCR_GEOMETRY_BACKFILL_EXPECTED_COUNT=251 \
  node scripts/audit-ocr-backfill.mjs verify-geometry-backfill-baseline

OCR_GEOMETRY_BACKFILL_BASELINE_PATH=/private/tmp/dfks-vision-v3-geometry-baseline.json \
OCR_GEOMETRY_BACKFILL_EXPECTED_COUNT=251 \
  npm run one-off:vision-v3-geometry-backfill -- preview
```

Kølægning kræver desuden et stabilt `OCR_GEOMETRY_BACKFILL_RUN_ID` og den eksakte
bekræftelse `OCR_GEOMETRY_BACKFILL_CONFIRM=QUEUE_VISION_V3_GEOMETRY_BACKFILL`.
Kørslen opretter nye jobgenerationer ved siden af kilderne. Originalfil, `pdf_url`,
kontraktstatus og strukturerede AI-data ændres ikke; kun et godkendt derivat og dets
private v3-geometri promoveres. Der oprettes ingen sletteopgaver for denne kørsel.

```bash
OCR_GEOMETRY_BACKFILL_BASELINE_PATH=/private/tmp/dfks-vision-v3-geometry-baseline.json \
OCR_GEOMETRY_BACKFILL_EXPECTED_COUNT=251 \
OCR_GEOMETRY_BACKFILL_RUN_ID=<uuid> \
OCR_GEOMETRY_BACKFILL_CONFIRM=QUEUE_VISION_V3_GEOMETRY_BACKFILL \
  npm run one-off:vision-v3-geometry-backfill -- queue
```

Efter pilot og fuld kørsel kontrollerer slutauditten originalbytes, sideantal,
afledt PDF, ordkoordinater, lineage, status, fravær af nye AI-job og fravær af
automatiske valideringer. Kvalitetsporten er en separat, eksplicit handling:

```bash
OCR_GEOMETRY_BACKFILL_BASELINE_PATH=/private/tmp/dfks-vision-v3-geometry-baseline.json \
OCR_GEOMETRY_BACKFILL_RUN_ID=<uuid> \
OCR_GEOMETRY_BACKFILL_EXPECTED_COUNT=251 \
  node scripts/audit-ocr-backfill.mjs audit-geometry-backfill
```

Godkendelse kræver også
`OCR_GEOMETRY_BACKFILL_APPROVE=APPROVE_VISION_V3_GEOMETRY_BACKFILL`. Et run kan
først godkendes, når alle jobs er terminale og den deterministiske rapportdigest
matcher databasen. Scheduler forbliver pauset under hele engangskørslen.

Portalen accepterer kun output fra den konfigurerede Google-servicekonto og en aktiv
joblease. Output- og geometristier er deterministisk bundet til kontrakt, job og det
tilfældige lease-token. Workeren afleverer SHA-256 for begge artefakter; den særskilte
backfill-audit verificerer derefter de private bytes, PDF-sideantal og hele det
allowlistede geometriskema mod den låste originalbaseline før næste udrulningsfase.

Google-adgang sker med Cloud Run-servicens kortlivede metadata-token. Der bruges ingen
API-nøgle eller permanent service-account-fil. Vision kaldes synkront over TLS 1.3;
globale eller asynkrone endpoints afvises af klienten. Hvert råt sidebillede sendes
direkte til Vision EU. En stor side kan få en midlertidig, nedskaleret transportkopi,
mens den kanoniske kildeside fortsat bruges til PDF'en og koordinaterne mappes tilbage.
Dokumenttekst og råbilleder gemmes aldrig i logs eller databasen. Geometrien gemmes
privat med skemaet `google-vision-spatial-v3` og profilen `google-vision-direct-v1`.

Før DLP-erstatningskørslen oprettes en ejerbeskyttet v3-baseline med præcis de
aktive DLP-generationer. Udvælgelsen kræver, at kontraktens aktive original,
behandlede PDF og koordinatfil alle peger på samme færdige DLP-job:

```bash
OCR_BACKFILL_BASELINE_PATH=/private/tmp/dfks-direct-vision-active-dlp-baseline.json \
  node scripts/audit-ocr-backfill.mjs capture-direct-vision-baseline
```

Baselinefilen verificeres igen umiddelbart før pilot og fuld kølægning. Historiske,
superseded eller allerede direkte Vision-behandlede generationer medtages ikke.

```bash
OCR_BACKFILL_BASELINE_PATH=/private/tmp/dfks-direct-vision-active-dlp-baseline.json \
  node scripts/audit-ocr-backfill.mjs verify-direct-vision-baseline
```
