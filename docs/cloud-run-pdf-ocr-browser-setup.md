# Cloud Run: privat PDF-normalisering og OCR

Denne opsætning udføres i den indloggede Google Cloud Console i browseren. Der
bruges ikke `gcloud` til oprettelse eller ændring af Cloud Run, IAM eller Scheduler.

## Datastrøm

1. Portalen gemmer originalen uændret i den private Supabase Storage-bucket.
2. En server-only databasekø indeholder kun interne id'er og storage-stier.
3. Cloud Scheduler kalder den private Cloud Run-service med Google OIDC.
4. Cloud Run identificerer sig over for portalen med sin egen Google-signatur.
5. Portalen udsteder et downloadlink med ti minutters levetid og et Supabase
   upload-token, begrænset til én tilfældig outputsti for netop det pågældende job.
   Supabase-upload-tokenet er gyldigt i to timer, men kan ikke overskrive en allerede
   færdig upload. Ved et kontrolleret genforsøg slettes kun den afledte outputfil først.
6. Cloud Run rasteriserer billedbaserede PDF'er i RAM og sender hver side til Google
   Sensitive Data Protection `image:redact` i EU. Google maskerer CPR, personnavne og
   bankdata inklusive IBAN og SWIFT i de faktiske pixels.
7. Kun de maskerede sider sendes til Google Vision EU. En søgbar PDF genopbygges af
   disse sider og Visions ordkoordinater, så kilder senere kan markeres præcist.
8. Den behandlede kopi og et privat geometrisk artefakt uploades til separate stier.
   Originalen overskrives aldrig.
9. Først efter afsluttet behandling oprettes AI-jobbet. AI bruger den behandlede kopi.

Cloud Run modtager aldrig Supabase service-role, refresh-tokens eller AI-nøgler.

## Browserplan i Google Cloud Console

### 1. Vælg eksisterende organisation og projekt

- Log ind med DFKS' Google Cloud-administratorkonto.
- Vælg Google Cloud-projektet `DFKS Portal` (`dfks-portal`) med aktiv fakturering.
- Vælg EU-regionen `europe-north1` konsekvent for Artifact Registry og Cloud Run.
- Accept af prøveperiode, betalingskonto og juridiske vilkår foretages af den
  ansvarlige bruger, ikke automatisk af Codex.

### 2. Aktivér API'er

I **APIs & Services → Library** aktiveres:

- Cloud Run Admin API
- Cloud Build API
- Artifact Registry API
- Cloud Scheduler API
- IAM Service Account Credentials API
- Sensitive Data Protection (DLP) API
- Cloud Vision API

### 3. Opret servicekonti

I **IAM & Admin → Service Accounts**:

- `dfks-pdf-worker`: identitet for selve containeren. Tildel kun de nødvendige roller
  til at kalde Sensitive Data Protection og Vision. Kontoen får ingen Storage-adgang.
- `dfks-pdf-scheduler`: må kun få `Cloud Run Invoker` på den konkrete service.

Der oprettes ingen JSON-nøgler. Identitet leveres af Cloud Run og Scheduler.

### 4. Byg containeren i browseren

I **Cloud Run → Create service → Continuously deploy** eller Cloud Builds browserflow
vælges repository og mappen `cloud-run/contract-document-worker` med dens Dockerfile.
Artifact Registry placeres i `europe-north1`. Buildlogs må ikke indeholde kontrakter,
miljøvariabler eller filnavne.

Den eksisterende produktionsservice bruger Cloud Build-konfigurationen
`cloudbuild.contract-document-worker.yaml`. Triggeren skal kun køre ved push til
`master`, når filer under `cloud-run/contract-document-worker/**` eller selve
Cloud Build-konfigurationen er ændret. Build-servicekontoen skal være en separat,
brugerstyret servicekonto med mindst mulige roller til build, Artifact Registry og
deploy af den konkrete Cloud Run-service. Runtime-identiteten forbliver
`dfks-pdf-worker`; den må ikke bruges som build-servicekonto.

### 5. Opret privat Cloud Run-service

Anbefalede indstillinger:

- Navn: `dfks-contract-document-worker`
- Region: `europe-north1`
- Authentication: **Require authentication**
- Ingress: **Internal and Cloud Load Balancing** hvis Scheduler kan nå servicen i den
  valgte projektopsætning; ellers **All** med IAM-godkendelse stadig påkrævet.
- Service account: `dfks-pdf-worker`
- Minimum instances: 0
- Maximum instances: 1 til første driftstest, derefter højst et bevidst valgt lavt tal
- Concurrency: 1
- Memory: 2 GiB
- CPU: 2
- Request timeout: 15 minutter
- Execution environment: anden generation

Tilføj aldrig `allUsers` eller `allAuthenticatedUsers` som invoker.

Miljøvariabler:

- `PORTAL_BASE_URL=https://dfks-portal-hazel.vercel.app`
- `OCR_CLOUD_RUN_AUDIENCE=<fast audience, identisk med Vercel>`
- `SUPABASE_URL=<projektets offentlige URL>`
- `SUPABASE_ANON_KEY=<projektets offentlige anon/publishable key>`
- `GOOGLE_CLOUD_PROJECT=dfks-portal`
- `GOOGLE_VISION_LOCATION=eu`
- `GOOGLE_DLP_LOCATION=eu`
- `OCR_TMP_DIR=/mnt/ramdisk`

Montér `/mnt/ramdisk` som en memory volume. Dokumentbytes må ikke skrives til et
vedvarende containerfilsystem.

Ingen af disse er en service-role. Den faste audience er ikke en hemmelighed.

### 6. Tilføj Vercel-konfiguration

Portalen skal have:

- `OCR_CLOUD_RUN_AUDIENCE` med samme værdi som Cloud Run
- `OCR_CLOUD_RUN_SERVICE_ACCOUNT` med den fulde mail på `dfks-pdf-worker`

En ny deployment er nødvendig. Der må ikke tilføjes en Google service-account JSON-nøgle.

### 7. Opret Scheduler-job

I **Cloud Scheduler → Create job**:

- Region: `europe-north1`
- Frekvens: hvert minut under indkøring, senere efter den ønskede kapacitet
- Target: HTTP
- URL: Cloud Run-servicens `/run`
- Method: POST
- Auth header: OIDC token
- Service account: `dfks-pdf-scheduler`
- Audience: Cloud Run-servicens origin

Tildel derefter kun Scheduler-kontoen rollen **Cloud Run Invoker** på denne service.

### 8. Logning, overvågning og sletning

- Aktivér Data Access-auditlogs for Cloud Run/IAM-ændringer.
- Logbaseret alarm ved gentagne `document_job_failed`, men uden PDF-indhold, stier,
  personnavne eller tokenværdier i alarmteksten.
- Cloud Run-logretention sættes efter DFKS' dokumenterede databevaringspolitik.
- Containerens midlertidige filsystem betragtes som flygtigt; oprydning sker efter
  hvert job og altid ved fejl.

## Accepttest

- Uautoriseret HTTP-kald til Cloud Run afvises.
- En anden Google-servicekonto afvises af portalens claim- og complete-endpoints.
- Browserroller kan ikke læse `contract_document_jobs`.
- Et udløbet download-token kan ikke genbruges, og upload-tokenet kan ikke bruges til
  andre stier eller til at overskrive en allerede færdig upload.
- Originalens hash og storage-sti er uændret efter behandling.
- 90°, 180° og 270° testsider vises korrekt i portalen.
- En billedbaseret PDF får tekstlag; en PDF med tekst bevarer eksisterende tekst.
- Filer over 25 MB og ugyldige PDF'er får konkrete, sikre fejlbeskeder.
- Ingen kontrakt, filsti, token eller persondata findes i Cloud Run-loggen.

## Begrænsning af konsekvensen ved et sikkerhedsbrud

- Workerens servicekonto har ingen generelle projekt- eller Storage-roller. Selv ved
  overtagelse af en aktiv container giver identiteten derfor ikke adgang til at
  gennemse kontraktarkivet.
- Portalen udsteder kun et kortlivet downloadlink til den ene kontrakt, som jobbet
  har claimet, og et upload-token til netop jobbets afledte outputsti.
- Workeren accepterer kun downloadadresser fra DFKS' forventede Supabase-origin,
  følger ikke redirects og stopper downloadstrømmen ved 25 MB. Det begrænser både
  server-side request forgery og ressourceangreb, hvis en jobrække bliver manipuleret.
- Kommandoerne til OCR, PDF-info og tekstudtræk har faste argumenter og køres uden
  shell. Filnavne, kontrakttekst og databaseværdier kan derfor ikke blive fortolket
  som systemkommandoer.
- Midlertidige filer oprettes isoleret med begrænsede filrettigheder og slettes i
  alle afslutningsforløb. Originalfilen er uforanderlig; kun en reproducerbar kopi
  kan slettes og genskabes.
- Ved mistanke om brud kan Scheduler pauses, `Cloud Run Invoker` fjernes fra
  schedulerkontoen og Vercels forventede worker-identitet ændres. Det stopper nye
  dokumentudleveringer uden at slette kontrakterne.

Den resterende risiko er, at den aktive Cloud Run-instans nødvendigvis kan se den
ene kontrakt, som den behandler. Google Cloud er derfor en databehandler i dette
flow og skal være omfattet af DFKS' databehandleraftale, logpolitik og
hændelsesberedskab.
