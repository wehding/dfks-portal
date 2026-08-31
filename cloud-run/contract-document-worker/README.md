# Privat PDF-normalisering på Cloud Run

PDF-filer med et fuldt brugbart tekstlag markeres som `not_required`. Hvis en PDF har
billedsider eller ulæselige sider, rasteriseres alle dens sider. Hver side sendes først
til regional Google Sensitive Data Protection (DLP) `image:redact`, som maskerer CPR,
personnavne og bankdata inklusive IBAN og SWIFT i selve billedets pixels. Kun Googles
maskerede retur-billede sendes derefter til synkron Google Cloud Vision OCR på
EU-endpointet. Den søgbare afledte PDF genopbygges udelukkende af de maskerede billeder
og Visions ordkoordinater; originalfilen overskrives aldrig.

Tjenesten må kun deployes som en privat Cloud Run-service. Cloud Scheduler får rollen
`Cloud Run Invoker`; `allUsers` og `allAuthenticatedUsers` må ikke tilføjes.

Miljøvariabler:

- `PORTAL_BASE_URL`: portalens production-origin.
- `OCR_CLOUD_RUN_AUDIENCE`: samme faste audience som portalen verificerer.
- `SUPABASE_URL` og `SUPABASE_ANON_KEY`: offentlige projektværdier; aldrig service-role.
- `GOOGLE_CLOUD_PROJECT`: Google Cloud-projektet.
- `GOOGLE_VISION_LOCATION=eu` og `GOOGLE_DLP_LOCATION=europe`. Vision bruger
  `eu` i ressourcevejen, mens Sensitive Data Protection bruger `europe` på
  `dlp.eu.rep.googleapis.com`.
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
kilde- og DLP-raster. Overskridelser sendes til manuel kontrol i stedet for at kunne
udtømme en 2 GiB-instans. Grænserne kan kun strammes i tests, aldrig hæves ved runtime.

Supabase er eneste kø. Tre Cloud Run-tasks kan arbejde parallelt, fordi portalens
claim-funktion bruger en atomisk `FOR UPDATE SKIP LOCKED`-claim. Workerens image må
kun få de offentlige Supabase-oplysninger; service-role, AI-nøgler og permanente
Google-nøgler må aldrig tilføjes. Produktionsprocessen afviser opstart, hvis
`OCR_TMP_DIR` ikke peger på den monterede memory volume `/mnt/ramdisk`.

Portalen accepterer kun output fra den konfigurerede Google-servicekonto og en aktiv
joblease. Output- og geometristier er deterministisk bundet til kontrakt, job og det
tilfældige lease-token. Workeren afleverer SHA-256 for begge artefakter; den særskilte
backfill-audit verificerer derefter de private bytes, PDF-sideantal og hele det
allowlistede geometriskema mod den låste originalbaseline før næste udrulningsfase.

Google-adgang sker med Cloud Run-servicens kortlivede metadata-token. Der bruges ingen
API-nøgle eller permanent service-account-fil. Vision og DLP kaldes synkront over TLS;
globale eller asynkrone endpoints afvises af klienten. Hvert råt sidebillede sendes kun
én gang til DLP. Workeren accepterer kun DLP's returnerede pixelmaskerede billede og
afviser et fund, hvis Google returnerer uændrede billedbytes. Kun fundtyper, antal og
ufølsomme regioner gemmes; fundet tekst og råbilleder gemmes aldrig i logs eller
databasen. Geometrien gemmes privat med skemaet `google-vision-spatial-v2`.
