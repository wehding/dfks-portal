# C-579/21 produktionsdeployment – 21. august 2026

## Status

- Google Cloud-projekt: `hip-orbit-498717-g8`.
- Cloud Run-region: `europe-north1`.
- Cloud Scheduler-region: `europe-west1` (Scheduler understøtter ikke `europe-north1`).
- Aktiv service/revision: `dfks-audit-siem-worker` / `dfks-audit-siem-worker-00002-txx`.
- Aktiv image-digest: `sha256:c04cdc10c05fe949d36dddd466f4705ba841e7d91be13dc276784e3de67c646d`.
- KMS: `audit-signing`, version 1, `EC_SIGN_P256_SHA256`, softwarebeskyttet og enabled.
- WORM-bucket: `dfks-audit-worm-hip-orbit-498717-g8`, offentlig adgang blokeret, uniform bucket-adgang og syv års retention.
- Bucket Lock: **ikke låst**. Låsning afventer en gyldig fireøjnegodkendelse.
- Scheduler-job: levering og retention-signering hvert femte minut; verifiering dagligt kl. 02:23 UTC. Alle tre blev aktiveret 21. august 2026 ca. 06:21 UTC.
- Observationsperiode: 21. august 2026 06:21 UTC til 24. august 2026 06:21 UTC.

## Første leveringsbevis

- Batch: `c190d97d-dc1e-4bde-8434-16e32cb3c24e`.
- Sekvens: 1–100, 100 events.
- GCS-generation: `1787293030007975`.
- CRC32C: `GQo4lA==`.
- Objekt: `v1/events/2026/07/27/1-100-70c604b39bd3dbc768c85a8f52c5e5c4aeac1a9b21160f1014082d2e12a07657.json`.
- KMS-nøgleversion: `projects/hip-orbit-498717-g8/locations/europe-north1/keyRings/dfks-audit/cryptoKeys/audit-signing/cryptoKeyVersions/1`.
- Workeren registrerede `audit_batch_delivery_success` med WORM-generationen.

Verifieringen afslørede først en kodefejl i ECDSA-kontrollen. Verifieringen blev rettet til at kontrollere SHA-256-signaturen over de kanoniske payload-bytes, dækket af en selvstændig kryptografisk test og deployet som revision `00002-txx`. Den efterfølgende verifiering behandlede kvitteringen med `verified=1` og `failures=[]`. Den samlede kørsel var fortsat markeret som fejl alene på grund af den forventede historiske kø.

## Canary og historisk kø

- Persondatafrit canary-event: `9054d67c-7fd6-4cd3-9c9d-429d4e015c9f`, sekvens 4313.
- Canary-eventet ligger efter den historiske kø og leveres sekvensordnet.
- Ved observationsstart resterede 4.213 ikke-leverede events.
- Køalarmen forventes at være aktiv under indhentningen. En integritetsfejl må derimod ikke forekomme med en ikke-tom `failures`-liste.

## Revisionsartefakt

Den maskinlæsbare cloud-evidens blev genereret med `complete=true`:

- Fil: `artifacts/audit-evidence/cloud-evidence-2026-08-21T06-22-35.907Z.json` (lokalt, ignoreret af Git).
- SHA-256: `5d332cce6315b90d006fa95ec19dbee1f88e004a95d333bca4fe9ae658b2ed54`.
- Cloud Build: `925e0d44-72a7-45c0-8028-cfae59503b70` for den aktive signaturrettelse.

Artefaktet indeholder Cloud Run, IAM, KMS, Scheduler, bucket og alarmkonfiguration uden secret-værdier.

## Uafsluttede kontroller

- 72-timers observation skal afsluttes og journalføres 24. august 2026 efter 06:21 UTC.
- Der findes endnu ingen `retention_change`-governancebeslutning i produktionsdatabasen.
- En jurist eller DPO skal indstille syv års retention, og en anden superadmin skal godkende og effektuere beslutningen.
- Først derefter må produktion skifte til `lock_worm_retention=true`. Bucket Lock er irreversibel.
