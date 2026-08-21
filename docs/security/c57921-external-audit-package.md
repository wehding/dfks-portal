# C-579/21 ekstern revisionspakke

Dette indeks skelner mellem implementerede kontroller og produktionsbeviser, som først kan foreligge efter deployment.

| Bevis | Kilde | Status før cloud-rollout |
|---|---|---|
| Databasekæde, append-only og RLS | `supabase/tests/audit_c57921.sql` | Automatiseret test |
| Fireøjnebeslutning | Logsiden → Governance | Kræver to navngivne godkendere i produktion |
| Logdækningsmatrix | `docs/security/c57921-logdaekningsmatrix.md` | Genereret og CI-kontrolleret |
| Cloud Run-revision/image-digest | Cloud evidence JSON | Kræver deployment |
| IAM uden offentlig invoker | Terraform + Cloud evidence JSON | Kodekontrol; runtimebevis kræver deployment |
| KMS-algoritme/public key | Terraform + Cloud evidence JSON | Kodekontrol; runtimebevis kræver deployment |
| Scheduler-konfiguration/kørsler | Terraform + Cloud evidence JSON | Kræver aktivering |
| GCS-retention, lifecycle og lock | Terraform + Cloud evidence JSON | Lock kræver godkendt produktionsbeslutning |
| Signeret canarybatch og GCS-kvittering | `audit_siem_receipts` + WORM-object | Kræver staging/produktion |
| Signeret slettecertifikat | `audit_retention_signatures` + WORM-object | Kræver retentionkørsel |
| Alarmregler og alarmtest | Cloud Monitoring + testjournal | Kræver stagingtest |
| 72-timers observation | Driftsjournal | Kræver faktisk 72-timers periode |
| Art. 15 privat lager/link/cleanup | Applikation, Storage-metadata og auditevents | Implementeret; runtimebevis kræver deployment |

En ekstern auditpakke må ikke markeres “fuldstændig”, hvis et af felterne med runtimekrav mangler. Bucket Lock må aldrig bruges som erstatning for den dokumenterede fireøjnebeslutning.
