# Privat PDF-normalisering på Cloud Run

Tjenesten må kun deployes som en privat Cloud Run-service. Cloud Scheduler får rollen
`Cloud Run Invoker`; `allUsers` og `allAuthenticatedUsers` må ikke tilføjes.

Miljøvariabler:

- `PORTAL_BASE_URL`: portalens production-origin.
- `OCR_CLOUD_RUN_AUDIENCE`: samme faste audience som portalen verificerer.
- `SUPABASE_URL` og `SUPABASE_ANON_KEY`: offentlige projektværdier; aldrig service-role.

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

Supabase er eneste kø. Tre Cloud Run-tasks kan arbejde parallelt, fordi portalens
claim-funktion bruger en atomisk `FOR UPDATE SKIP LOCKED`-claim. Workerens image må
kun få de offentlige Supabase-oplysninger; service-role, AI-nøgler og permanente
Google-nøgler må aldrig tilføjes.
