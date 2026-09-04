# Insights: datakilder og aktivering

Insights-siden viser fem adskilte slags data. Auditaktivitet kommer fra DFKS' egen auditlog. Trafik og reelle browsermålinger kommer fra Vercel Analytics og Speed Insights. Tekniske produktionsfejl kommer fra Vercel Runtime Logs. Sammenlignelige hastighedstests kommer fra GitHub Actions.

Manglende data vises som **Mangler data**. Det betyder ikke nul fejl eller god hastighed.

## Aktivering efter merge og migration

1. Anvend migrationen `20260904062455_insights_observability.sql`.
2. Deploy appen, så `@vercel/analytics` og `@vercel/speed-insights` begynder at indsamle privatlivsfiltrerede målinger.
3. Opret to Vercel Drains til `/api/internal/observability/vercel-drain`: ét med skemaet `analytics/v1` og ét med `speed_insights/v1`. Vercel tillader kun én datatype pr. drain. Runtime Logs må ikke sendes til samme app via et drain, fordi det kan skabe en logsløjfe.
4. Brug den samme eksplicit valgte signaturhemmelighed for begge drains, og gem den som `VERCEL_DRAIN_SECRET` i Vercel.
5. Opret en begrænset Vercel API-token til læsning af deployments og runtime-logs. Gem den som `VERCEL_OBSERVABILITY_TOKEN`, og sæt `VERCEL_OBSERVABILITY_PROJECT_ID` og `VERCEL_OBSERVABILITY_TEAM_ID`.
6. Bekræft, at cron-ruten `/api/internal/observability/vercel-runtime` kaldes hvert 15. minut med `CRON_SECRET`.
7. Opret en tilfældig `PERFORMANCE_INGEST_SECRET` både i Vercel og GitHub Actions. Opret GitHub-secret `INSIGHTS_INGEST_URL` med den fulde URL til `/api/internal/observability/performance`.
8. Kør workflowet **Planlagt performance-skala** manuelt. PR-workflowet sender også resultater, når secrets er sat.

Ingen af ovenstående secrets må skrives i dokumentation, commits, workflow-output eller auditlog.

## Kontrol efter aktivering

- Åbn Insights som superadmin og kontrollér datakildestatusserne.
- Besøg udvalgte nøglesider og kontrollér senere, at sidevisninger og browsermålinger fremgår.
- Udløs ikke en rigtig produktionsfejl. Bekræft runtime-indsamlingen ved at se, at kilden får et aktuelt succes-tidspunkt; eksisterende fejl kan være nul.
- Kontrollér, at GitHub-resultatet viser både desktop og simuleret mobil samt datamængde ved skala-test.
- Kontrollér i databasen, at `route_template` aldrig indeholder `?`, `#`, UUID eller råt medlems-id.

Telemetry opbevares i 90 dage og kan kun læses og skrives af serverens service-rolle. Browserroller har ingen tabeladgang.
