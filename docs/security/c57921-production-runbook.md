# C-579/21 produktionsrunbook

## Sikker standard

Cloud Logging og Monitoring betegnes **Google-native sikkerhedslogning og overvågning**. Det er ikke et fuldt kommercielt SIEM. Eventbatches og slettecertifikater arkiveres i GCS med kryptografisk signatur og syv års retention.

Supabase-bucketen `subject-access-exports` er privat. Supabase leverer managed kryptering i hvile og TLS i transit; løsningen påstår ikke kundestyret CMEK. Rapportlinks lever i 10 minutter, og rapportobjekter slettes efter 24 timer af det timebaserede oprydningsjob.

## Forudsætninger

1. Opret Secret Manager-secrets `dfks-audit-supabase-url` og `dfks-audit-supabase-service-role` uden at lægge værdier i Terraform state.
2. Opret en Cloud Monitoring-notifikationskanal og angiv dens fulde resource-id.
3. Byg worker-image, push det til Artifact Registry, og brug altid adressen med `@sha256:<digest>`.
4. Anvend først Terraform med `environment=staging`, `enable_scheduler=false` og `lock_worm_retention=false`.
5. Cloud Run, KMS og WORM placeres i `europe-north1`. Cloud Scheduler placeres i `europe-west1`, fordi Scheduler ikke understøtter `europe-north1`.

## Kontrolleret staging-rollout

1. Kør migrationer og database/RLS-test.
2. Deploy privat Cloud Run med Scheduler pauset.
3. Opret et canary-event og kald `/run` med en autoriseret OIDC-identitet.
4. Kontrollér outbox, KMS-signatur, GCS-object/generation/checksum og immutable kvittering.
5. Kald `/verify`, eksportér KMS-public key, og verificér signaturen uafhængigt.
6. Genlevér samme eventmængde. Den deterministiske objektsti og `ifGenerationMatch=0` skal forhindre et nyt objekt.
7. Simulér sekvensbrud, ugyldig signatur, manglende WORM-objekt, dead-letter, køalder og usigneret slettecertifikat; gem alarmkvitteringer.
8. Aktivér Scheduler og observer minimum 72 timer. Registrér start/slut, antal kørsler, fejl og afvigelser.

## Fire øjne og Bucket Lock

En jurist indstiller retention på syv år i fanen Governance. En anden bruger med superadminrolle godkender, hvorefter beslutningen effektueres. Gem beslutnings-id og hash i revisionspakken. Først derefter må `lock_worm_retention=true` anvendes i produktion.

Bucket Lock er irreversibel og indgår ikke i rollback. Gamle KMS-versioner må ikke destrueres, mens de signerer materiale inden for retentionperioden.

## Revisionsbeviser

Kør efter deployment:

```bash
node scripts/generate-audit-cloud-evidence.mjs --project=<PROJECT> --region=europe-north1 --scheduler-region=europe-west1
```

Rapporten indeholder Cloud Run-revision og image, IAM, KMS, Scheduler, bucket retention/lifecycle og alarmregler. Supplér med canarykvittering, alarmtest, 72-timers observationsjournal, governancebeslutning og CI-resultater. Rapporten indeholder ikke secret-værdier.

## Rollback

- Scheduler kan pauses, og SIEM-levering kan deaktiveres uden at stoppe append-only logning.
- En fejlet Cloud Run-revision kan erstattes af en tidligere image-digest.
- WORM-objekter og en låst retention kan ikke rulles tilbage eller slettes før udløb.
- Eksportfiler kan slettes; revisionsmetadata bevares.
