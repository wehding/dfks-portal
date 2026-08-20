# DFKS Audit WORM-worker

Privat Cloud Run-service til C-579/21-revisionsbeviser. Workeren kontrollerer
databasekæden, signerer kanoniske SHA-256-digests i Cloud KMS og arkiverer
signerede batches i et GCS-bucket med retention. Sanitiserede driftsfelter
skrives som strukturerede Cloud Logging-events.

## Endpoints

- `POST /run`: leverer næste eventbatch.
- `POST /sign-retention`: signerer og arkiverer næste slettecertifikat.
- `POST /verify`: daglig kontrol af sekvenser, hashes, KMS-signaturer og WORM-objekter.
- `GET /health`: processtatus. Servicen er stadig privat bag Cloud Run IAM.

Cloud Scheduler bruger OIDC og er den eneste `roles/run.invoker`. Hvis
`WORKER_SHARED_SECRET` konfigureres som ekstra kontrol, sendes den i
`x-worker-shared-secret`; den erstatter ikke Cloud Run IAM.

## Secrets og konfiguration

Secret Manager-referencer: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` og
eventuelt `SIEM_AUTH_TOKEN`. Almindelig konfiguration:

- `GOOGLE_CLOUD_KMS_KEY_NAME`: fuldt CryptoKeyVersion-navn.
- `AUDIT_WORM_BUCKET`: produktionsbucket til WORM-beviser.
- `SIEM_BATCH_SIZE`: 1–500, standard 100.
- `IMAGE_DIGEST`: digest fra deployment, som registreres i revisionssporet.
- `SIEM_ENDPOINT`: kun til de valgfrie kommercielle adaptere.

Google-native drift skal bruge adapteren `google_native`. Cloud Logging og
Monitoring beskrives som sikkerhedslogning og overvågning, ikke som et fuldt
kommercielt SIEM.
