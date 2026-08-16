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
