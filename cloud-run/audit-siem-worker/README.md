# DFKS Audit SIEM Worker

Cloud Run-worker som henter atomisk reserverede audit-batches, signerer deres
kanoniske SHA-256-digest med Google Cloud KMS og leverer dem til et eksternt
SIEM/WORM-endpoint. Private signeringsnøgler forlader aldrig KMS.

## Miljøvariabler

- `SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLOUD_KMS_KEY_NAME`: fuldt navn på en asymmetrisk CryptoKeyVersion
- `SIEM_ENDPOINT`, `SIEM_ADAPTER` og valgfri `SIEM_AUTH_TOKEN`
- `WORKER_SHARED_SECRET`: påkrævet bearer-token til `POST /run`
- `SIEM_BATCH_SIZE`: 1–500, standard 100

Cloud Run-servicekontoen skal kun have `cloudkms.cryptoKeyVersions.useToSign`
på den valgte nøgleversion. Endpointet bør desuden beskyttes med Cloud Run IAM;
worker-tokenet er et ekstra lag.
