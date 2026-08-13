# Engangsimport af DFKS' kontraktarkiv

Dette værktøj er kun lavet til den aftalte engangsimport. Det opretter ikke en permanent synkronisering, gemmer ikke et link til regnearket og tilføjer ingen ny importknap i portalen.

## Hvad importen gør

- gennemgår den valgte Google Drive-mappe og alle undermapper, også på et fællesdrev;
- accepterer PDF, Word, tekst og JPG;
- samler nummererede JPG-sider, kontrollerer rækkefølge og indhold og konverterer dem lokalt til en søgbar PDF;
- bruger den samme 25 MB-filgrænse, hashbaserede dubletkontrol, kladdestatus, AI-kø og 90 %-matchregler som den almindelige kontraktupload;
- opretter ikke-validerede kontraktkladder;
- genbruger eksisterende rettighedshavere globalt og knytter dem til DFKS som ikke-medlemmer, når et sikkert match findes;
- kan efter analysen oprette en ny ikke-medlems-rettighedshaver, når kontrakten eller en sikkert matchet regnearksrække entydigt identificerer en person;
- søger først i den fælles værksdatabase og derefter sikkert i DFI og TMDb. Et sikkert eksternt match kan oprette værket med den eksterne databases titel som hovedtitel;
- markerer kontrakter uden sikker ejer som `missing_owner`, uden sikkert værk som `missing_work` og serier som `awaiting_episode_confirmation`;
- validerer aldrig automatisk en kontrakt.

## Regnearket er kun supplerende

Regnearket eksporteres midlertidigt under kørslen og gemmes ikke i databasen. En række bruges kun ved et entydigt match: mindst 95 point og mindst 15 points afstand til næstbedste kandidat. Ubrugelige URL'er accepteres derfor ikke som bevis; titel, navn, producent og år kan understøtte et match.

AI-/kontraktdata vinder ved modstrid. Regnearket udfylder kun tomme felter, bortset fra titelreglen:

- en sikkert fundet DFI-/TMDb-titel bliver værkets hovedtitel;
- en afvigende titel aflæst i kontrakten bevares som arbejdstitel/alias;
- regnearkstitlen bruges til søgning og som fallback, ikke til at overskrive en autoritativ ekstern titel.

Supplerende felter er premiereår, produktionstype, produktionsselskab, distributør, producentforeningsoplysning, krediteret funktion, organisation, overenskomst, rettigheder, løntekst, annonceringsvilkår, fotograf, arkivets modtagelsesdato og note. Krediteringen bruges i værktilknytningen, når den ellers er tom. Noten tilføjes til den eksisterende note med præfikset `Arkivimport:`. Den oprindelige regnearksrække, regnearks-URL og modstridende ekstraværdier gemmes ikke.

## Sikkerhed

- Scriptet bruger en eksisterende organisations-ejet Google Drive-forbindelse; der ligger ingen OAuth-token i koden.
- JPG-OCR kører lokalt med macOS Vision. JPG-indhold sendes ikke til en ny OCR-tjeneste.
- Almindelig kontraktanalysering udføres af portalens eksisterende worker, som maskerer persondata efter de samme regler som almindelig upload.
- Rapporter oprettes lokalt med filrettighed `0600`. De indeholder status, filnavn og interne id'er, men ikke kontrakttekst, adgangstokens eller regnearksindhold.
- Kør ikke scriptet på en delt maskine, og commit aldrig rapporterne.

## Forberedelse

1. Merge og deploy koden samt migrationen, der tilføjer `contracts.archive_received_at`.
2. Kontrollér, at `.env.local` indeholder den sædvanlige Supabase-konfiguration. Vis eller kopiér ikke værdierne til terminaloutput.
3. Find UUID for DFKS-organisationen, en aktiv admin/superadmin-bruger og den aktive organisations-ejede Google Drive-forbindelse.
4. Kontrollér at forbindelsen har adgang til både arkivmappen og regnearket.
5. Brug altid folder- og spreadsheet-id som kommandoparametre; de er bevidst ikke hardkodet.

## Sikker kørselsrækkefølge

Kommandoeksemplerne bruger pladsholdere. Erstat dem lokalt uden at gemme dem i Git.

### 1. Kun inventar og matchrapport

```sh
npm run one-off:import-contract-archive -- dry-run \
  --org-id=<DFKS_ORG_UUID> \
  --actor-user-id=<ADMIN_USER_UUID> \
  --connection-id=<GOOGLE_CONNECTION_UUID> \
  --folder-id=<ARKIVMAPPE_ID> \
  --spreadsheet-id=<REGNEARK_ID> \
  --report-path=tmp/contract-archive-dry-run.json
```

Gennemgå især ekskluderede filer, JPG-grupper og tvetydige regnearksmatches. Dry-run skriver ikke til databasen.

### 2. Pilot med 10 kontrakter

```sh
npm run one-off:import-contract-archive -- execute \
  --org-id=<DFKS_ORG_UUID> \
  --actor-user-id=<ADMIN_USER_UUID> \
  --connection-id=<GOOGLE_CONNECTION_UUID> \
  --folder-id=<ARKIVMAPPE_ID> \
  --spreadsheet-id=<REGNEARK_ID> \
  --limit=10 \
  --report-path=tmp/contract-archive-pilot-10.json
```

Notér `batchId` fra svaret. `execute` downloader, dubletkontrollerer, konverterer JPG og lægger filerne i den eksisterende AI-kø. Scriptet starter ikke en separat AI-kæde.

### 3. Lad den normale worker færdiggøre analysen

Kontrollér i AI-kontrolrummet/importstatus, at pilotens jobs ikke længere står som `queued`, `analysing` eller `matching`. Workerens almindelige retry- og fejlregler gælder.

### 4. Supplér efter analysen

```sh
npm run one-off:import-contract-archive -- resume \
  --org-id=<DFKS_ORG_UUID> \
  --actor-user-id=<ADMIN_USER_UUID> \
  --connection-id=<GOOGLE_CONNECTION_UUID> \
  --folder-id=<ARKIVMAPPE_ID> \
  --spreadsheet-id=<REGNEARK_ID> \
  --batch-id=<BATCH_UUID> \
  --limit=10 \
  --report-path=tmp/contract-archive-pilot-10-resume.json
```

`resume` er idempotent og kan køres igen. Filer, som stadig analyseres, rapporteres som `awaiting_analysis`.

### 5. Kontrolpunkter før næste trin

- Alle kontrakter er kladder og ingen er automatisk valideret.
- Dubletter har ikke oprettet nye kontrakter.
- Usikre ejere står uden ejer; sikre ejermatch er mindst 90 %.
- Nye personer er ikke-medlemmer og har ikke portalbruger.
- Værktitler fra DFI/TMDb er bevaret som hovedtitler.
- Serier venter på medlemmets afsnitsbekræftelse.
- Regnearksdata har ikke overskrevet AI-data.
- Rapporten indeholder ingen kontrakttekst eller hemmeligheder.

Fortsæt derefter med en pilot på 50 og til sidst hele arkivet. Brug en ny batch til hver pilot/full run; dubletfingeraftrykkene forhindrer genimport af de allerede indlæste filer.

## Statusrapport uden Drive-læsning

```sh
npm run one-off:import-contract-archive -- report \
  --org-id=<DFKS_ORG_UUID> \
  --actor-user-id=<ADMIN_USER_UUID> \
  --connection-id=<GOOGLE_CONNECTION_UUID> \
  --batch-id=<BATCH_UUID> \
  --report-path=tmp/contract-archive-status.json
```

## Afbrydelse og rollback

- Stop før `execute`, hvis dry-run viser uventet filantal, usikre JPG-grupper eller mange ukendte filtyper.
- Stop mellem pilotfaser ved forkert ejer/værk, fejlende analyse eller uventede databaseændringer.
- Slet ikke en hel batch automatisk efter upload: kontrakter, filer, fingeraftryk og eventuelle nye ikke-medlemmer skal gennemgås samlet. En rollback skal udføres som en særskilt, godkendt databaseoperation ud fra batch-id.
- Gem batch-id og de lokale rapporter indtil importen er godkendt; slet derefter rapporterne fra den lokale maskine.
