# Robust kontraktimport — drift og udrulning

Den normale kontraktimport bruger én fælles kø for computerupload, Google Drive,
OneDrive og Dropbox. Uploaden gemmer straks filen og en kladekontrakt. AI-læsning,
matching og færdiggørelse fortsætter derefter i baggrunden.

Worker-endpointet svarer straks på signerede cron-kald og udfører arbejdet via
Next.js `after()`. Dermed behøver Supabase `pg_net` ikke holde en lang HTTP-
forbindelse åben. Vercel-funktionen har `maxDuration = 300`, mens en 15-minutters
databaselease og heartbeat forhindrer, at samme job behandles parallelt under
lange AI-kald.

## Sikker udrulningsrækkefølge

1. Kør migrationen `robust_contract_import_pipeline` i Supabase.
2. Deploy applikationen med samme `CONTRACT_AI_JOB_SECRET` i Preview/Production.
3. Kontrollér en lille import på 5–10 kontrakter.
4. Sæt `NEXT_PUBLIC_SITE_URL` til den offentlige Production-adresse lokalt og kør
   `npm run db:configure-contract-import-cron` fra et sikkert administratormiljø.
   Kommandoen sender hemmeligheden direkte til den service-role-beskyttede RPC;
   den udskriver eller gemmer ikke hemmeligheden i Git.
5. Kontrollér i Supabase Dashboard → Integrations → Cron, at
   `contract-import-worker` kører hvert femte minut, og at HTTP-kaldene lykkes.
6. Når Cron er verificeret, kan det gamle daglige Vercel-cronjob for
   `/api/contracts/jobs/process` fjernes i en separat driftsrettelse.

## Fejl og genoptagelse

- `retry_wait`: midlertidig fejl eller rate limit; prøves automatisk igen.
- `blocked`: nøgle, modeladgang, betaling eller kredit kræver handling. Forsøget
  tæller ikke ned, mens køen er blokeret.
- `needs_ocr`: filen indeholder for lidt maskinlæsbar tekst.
- `dead`: maksimalt antal forsøg er brugt eller inputtet kan ikke behandles.
- `possible_duplicate`: filhashen var ny, men titel/dato/ejer/værk ligner en
  eksisterende kontrakt. Ingen kontrakt slettes automatisk.

Admin kan genoptage fejlede jobs fra importoversigten. `resume` fortsætter fra
det senest gemte trin, `rematch` genbruger AI-resultatet uden et nyt AI-kald, og
`reanalyze` sletter kun det gemte udtræksresultat og bruger den aktuelt valgte
model ved næste behandling.

For billedbaserede PDF'er sender OCR-workeren rå sider til Google Vision EU og gemmer
en privat, søgbar afledt PDF med koordinater. Før den efterfølgende AI-analyse maskeres
CPR-, bank- og kontaktoplysninger fortsat i den udtrukne tekst. Kildedokumentet og den
maskerede tekst gemmes ikke i AI-jobbet. Det strukturerede
udtræk gemmes kun som checkpoint, indtil jobbet er færdigt; derefter ligger de
godkendelige felter i kontraktvalideringen, og checkpointet slettes. Model,
prompt-/skemaversion, tokenforbrug, prisreference og provider request-id bevares
som driftsmetadata uden kontrakttekst. En senere `rematch` genbruger valideringens
strukturerede felter og sender derfor ikke dokumentet til AI igen.
