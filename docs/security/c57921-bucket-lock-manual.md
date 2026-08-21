# Manual: irreversibel Bucket Lock for C-579/21-bevislageret

Denne manual gælder produktionsbucketen `dfks-audit-worm-hip-orbit-498717-g8` i Google Cloud-projektet `hip-orbit-498717-g8`.

Bucket Lock må **ikke** udføres som en almindelig teknisk deployment. Når retention-politikken er låst, kan den ikke fjernes eller forkortes. Bucketen kan heller ikke slettes, før alle objekter har opfyldt retentionperioden. En låsning lægger desuden en lien på Google Cloud-projektet.

## Ansvar og adskillelse af roller

- En jurist eller DPO indstiller syv års retention i logsidens Governance-fane.
- En anden bruger med superadminrolle godkender indstillingen.
- En driftsansvarlig udfører den tekniske låsning efter godkendelsen.
- En anden person kontrollerer bucketstatus og revisionsbeviser efter låsningen.

Den samme bruger må ikke både indstille og godkende beslutningen. Codex eller en teknisk administrator må ikke oprette den juridiske beslutning på DPO'ens vegne.

## Stopkriterier

Stop uden at låse, hvis blot ét af følgende punkter ikke er opfyldt:

- 72-timers observationen er afsluttet uden uafklarede integritets-, signatur-, leverings- eller Scheduler-fejl.
- SIEM/WORM-køen er under kontrol, og den daglige verifikation er godkendt.
- Governance-beslutningen angiver præcis syv år, beslutnings-id, beslutningshash, begrundelse og retsgrundlag.
- Indstiller og godkender er to forskellige personer med de korrekte roller.
- Bucketnavn, projekt-id og retentionperiode er læst højt og kontrolleret af to personer.
- Terraform-planen indeholder ingen uventede ændringer.

## 1. Gem beslutningsbeviset

Fra Governance-fanen gemmes følgende i revisionspakken:

- beslutnings-id og beslutningshash;
- indstiller, godkender og tidspunkter;
- godkendt retention: syv år;
- begrundelse og retsgrundlag;
- reference til den afsluttede 72-timers observation.

Kontrollér, at beslutningen står som effektueret. Hvis der ikke findes en gyldig beslutning, må proceduren ikke fortsætte.

## 2. Kontrollér den aktuelle bucket

Kør fra den godkendte deployment-worktree og med Google Cloud-projektet valgt eksplicit:

```bash
gcloud config set project hip-orbit-498717-g8
gcloud storage buckets describe \
  gs://dfks-audit-worm-hip-orbit-498717-g8 \
  --format="yaml(name,location,public_access_prevention,uniform_bucket_level_access,retention_policy,lifecycle_config,soft_delete_policy,metageneration)"
```

To personer skal kontrollere, at:

- bucketen hedder præcis `dfks-audit-worm-hip-orbit-498717-g8`;
- placeringen er `EUROPE-NORTH1`;
- offentlig adgang er forhindret, og uniform bucket-adgang er aktiv;
- retentionperioden er `220752000` sekunder, svarende til syv Google Cloud-år á 365,25 dage;
- `isLocked`/`is_locked` fortsat er `false` før låsningen;
- lifecycle først flytter objekter til Archive og ikke forsøger at slette dem før retentionudløb.

Gem den fulde kommandooutput i revisionspakken. Den må ikke indeholde secrets.

## 3. Generér et før-bevis

```bash
node scripts/generate-audit-cloud-evidence.mjs \
  --project=hip-orbit-498717-g8 \
  --region=europe-north1 \
  --scheduler-region=europe-west1
```

Kontrollér desuden, at den aktive Cloud Run-revision bruger et image bundet til en SHA-256-digest, at Scheduler-jobbene er aktive, og at KMS-nøgleversionen er aktiveret. Gem rapporten sammen med governance-beslutningen.

## 4. Lav og godkend Terraform-planen

Kør i `infrastructure/google/audit-siem`. Brug den samme kontrollerede Terraform-state og de samme produktionsvariable som ved den aktive deployment. Hemmeligheder må fortsat kun henvises via Secret Manager.

Sæt:

```text
environment        = "production"
enable_scheduler   = true
lock_worm_retention = true
```

`worker_image` skal være den allerede godkendte, immutable `@sha256:`-adresse, og `notification_channel_id` skal være den aktive notifikationskanals fulde resource-id.

Kør først `terraform plan` og gem planfilen. Planen skal gennemgås af to personer. Hvis planen vil erstatte eller slette bucket, KMS-nøgle, Cloud Run-service eller andre driftsressourcer, skal den afvises.

## 5. Udfør låsningen

Når plan, governance-bevis og fireøjnekontrol er godkendt, anvendes den gemte Terraform-plan:

```bash
terraform apply <GODKENDT_PLANFIL>
```

Terraform-ressourcen sætter bucketens retention-politik til låst. Brug ikke en ny, uanmeldt plan ved selve godkendelsen.

Hvis Terraform undtagelsesvist ikke kan bruges, er Googles officielle direkte kommando:

```bash
gcloud storage buckets update \
  gs://dfks-audit-worm-hip-orbit-498717-g8 \
  --lock-retention-period
```

Den direkte kommando må kun anvendes via en særskilt godkendt nødprocedure, fordi den skaber drift uden for Terraform-state.

## 6. Bekræft låsningen

```bash
gcloud storage buckets describe \
  gs://dfks-audit-worm-hip-orbit-498717-g8 \
  --format="yaml(name,metageneration,retention_policy)"
```

Kontrollér og dokumentér:

- `isLocked`/`is_locked` er `true`;
- retentionperioden fortsat er `220752000` sekunder;
- policyens effektive tidspunkt og bucketens metageneration;
- projektets retention-lien;
- at næste workerbatch får GCS-generation, checksum og KMS-nøgleversion;
- at `/verify` godkender hashkæde, objekt og signatur;
- at Scheduler og alarmer fortsat er aktive.

Kør evidensscriptet igen og gem efter-beviset ved siden af før-beviset. Registrér operatør, kontrollant, UTC-tidspunkt, Terraform commit, planhash og Governance-beslutnings-id.

## 7. Kontroller uforanderligheden sikkert

Brug et nyt, ufarligt testobjekt med et unikt navn. Dokumentér, at et forsøg på at overskrive eller slette objektet afvises med `retentionPolicyNotMet`. Test aldrig med et rigtigt revisionsbevis, og vær opmærksom på, at testobjektet også bliver opbevaret i syv år.

## Rollback og hændelser

Der findes ingen rollback af Bucket Lock. Efter låsningen kan retentionperioden øges, men den kan aldrig forkortes eller fjernes. En forøgelse skal derfor gennemgå en ny governancebeslutning og konsekvensvurdering.

Cloud Run kan rulles tilbage, og Scheduler kan pauses ved driftsfejl, men det ændrer ikke den låste bucket. Ved forkert bucket, periode eller projekt efter låsningen eskaleres hændelsen straks til DPO, juridisk ansvarlig og Google Cloud-projektejer; forsøg ikke at omgå retentionen.

## Officielle Google-referencer

- [Bucket Lock: virkning og begrænsninger](https://cloud.google.com/storage/docs/bucket-lock)
- [Brug og lås en retention-politik](https://cloud.google.com/storage/docs/using-bucket-lock)
- [Cloud Storage API: lockRetentionPolicy](https://cloud.google.com/storage/docs/json_api/v1/buckets/lockRetentionPolicy)
