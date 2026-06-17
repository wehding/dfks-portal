# GitHub-samarbejde for begyndere

Denne håndbog beskriver en enkel arbejdsgang for to eller flere personer, der arbejder på samme projekt via GitHub.

Formålet er at undgå, at nogen overskriver hinandens arbejde, og at hovedbranchen altid er stabil.

## Kort overblik

- Hovedbranchen er den stabile version af projektet.
- I denne checkout hedder hovedbranchen `master`.
- Nye features og rettelser laves på sidebranches.
- En sidebranch pushes til GitHub.
- Ændringer samles ind i hovedbranchen via Pull Request.
- Direkte push til hovedbranchen er ikke tilladt.

Hvis teamet senere omdøber `master` til `main`, skal kommandoerne i denne fil ændres tilsvarende.

## Begreber

- Branch: en arbejdsgren af projektet.
- Hovedbranch: den stabile branch, her `master`.
- Feature branch: en sidebranch til en konkret opgave.
- Commit: en gemt ændringspakke med en besked.
- Push: send dine lokale commits op til GitHub.
- Pull: hent seneste ændringer fra GitHub.
- Pull Request, PR: forslag om at merge en branch ind i hovedbranchen.
- Merge: saml ændringer fra en branch ind i en anden.

## Før du starter en ny opgave

Start altid med at hente den nyeste version af hovedbranchen:

```bash
git fetch origin
git checkout master
git pull origin master
```

Lav derefter en ny sidebranch:

```bash
git checkout -b feat/kort-navn
```

Eksempler:

```bash
git checkout -b feat/medlemsprofil
git checkout -b fix/login-fejl
git checkout -b docs/readme-git-flow
```

## Navngivning af branches

Brug korte og tydelige navne:

- `feat/...` til nye features.
- `fix/...` til fejlrettelser.
- `refactor/...` til oprydning uden ny funktionalitet.
- `docs/...` til dokumentation.
- `chore/...` til små tekniske vedligeholdelsesopgaver.

Eksempel:

```bash
git checkout -b feat/kontrakt-upload
```

## Mens du arbejder

Tjek løbende hvad du har ændret:

```bash
git status
```

Test projektet lokalt:

```bash
npm run dev
npm run lint
```

Hvis du vil hente nyeste ændringer fra hovedbranchen ind i din branch:

```bash
git fetch origin
git merge origin/master
```

Hvis der opstår konflikter, så løs dem lokalt, test igen og commit løsningen.

## Commit dine ændringer

Tilføj de filer, du vil have med:

```bash
git add .
```

Lav et commit:

```bash
git commit -m "feat: kort beskrivelse"
```

Gode commit-beskeder:

- `feat: tilfoej upload af medlemskontrakter`
- `fix: ret redirect efter login`
- `docs: tilfoej github-samarbejdsmanual`
- `refactor: forenkle kontraktliste`

Undgå beskeder som:

- `update`
- `fix`
- `changes`
- `wip`

## Push din branch

Når du har commits klar:

```bash
git push origin feat/kort-navn
```

Eksempel:

```bash
git push origin feat/kontrakt-upload
```

Push altid sidebranchen. Push aldrig direkte til `master`.

## Opret en Pull Request

Når din branch er pushed:

1. Gå til GitHub-repoet.
2. Vælg din branch.
3. Klik på "Compare & pull request".
4. Sørg for at base branch er `master`.
5. Skriv en kort PR-beskrivelse.
6. Tilføj reviewer, hvis relevant.
7. Opret PR.

## PR-beskrivelse

Brug denne skabelon:

```md
## Hvad er ændret?
- 

## Hvorfor?
- 

## Hvordan er det testet?
- 

## Særligt til review
- 
```

Eksempel:

```md
## Hvad er ændret?
- Tilføjet upload-flow for medlemskontrakter.
- Gemmer metadata på kontrakten i Supabase.

## Hvorfor?
- Medlemmer skal kunne uploade egne kontrakter fra portalen.

## Hvordan er det testet?
- Kørt lokalt med npm run dev.
- Testet upload med PDF.

## Særligt til review
- Martin bør tjekke formuleringerne i medlemsflowet.
```

## Review og merge

Før merge:

- Tjek at PR'en går fra din feature branch til `master`.
- Læs diffen igennem.
- Kør relevante tests eller `npm run lint`.
- Få review, hvis ændringen påvirker domæne, jura, data eller arkitektur.
- Ret feedback i samme branch og push igen.

Når PR'en er godkendt, kan den merges til `master`.

## Efter merge

Skift tilbage til hovedbranchen og hent seneste version:

```bash
git checkout master
git pull origin master
```

Du kan derefter slette den lokale feature branch:

```bash
git branch -d feat/kort-navn
```

## Hvis I arbejder samtidig

God praksis:

- Start altid fra opdateret `master`.
- Arbejd i små branches.
- Push ofte, så andre kan se arbejdet.
- Lav PR tidligt, hvis du ønsker feedback.
- Undgå at to personer ændrer samme store fil samtidig.
- Aftal større ændringer på forhånd.

Hvis Martin arbejder på samme område, så aftal hvem der ejer hvilke filer eller opgaver.

## Hvad må ikke ændres uden aftale

Spørg Martin før ændringer i:

- juridiske regler
- royaltysatser
- overenskomstlogik
- kontrakttyper
- AI-systemprompts med domæneviden
- databasearkitektur
- modulernes formål og adskillelse

## Hurtig huskeseddel

Ny opgave:

```bash
git fetch origin
git checkout master
git pull origin master
git checkout -b feat/kort-navn
```

Gem og push:

```bash
git status
git add .
git commit -m "feat: kort beskrivelse"
git push origin feat/kort-navn
```

Når feature er klar:

```text
Opret Pull Request på GitHub fra feat/kort-navn til master.
```

## Den vigtigste regel

Arbejd aldrig direkte på `master`.

Alt arbejde skal ske på en sidebranch og ind via Pull Request.

## Lokal sikkerhedsregel mod push til master

Projektet har en lokal Git hook, som kan blokere direkte push til `master`.

Installer den sådan:

```bash
sh scripts/setup-git-hooks.sh
```

Hooken gælder kun på den maskine, hvor den installeres. Martin skal derfor også køre kommandoen på sin maskine, hvis han vil have samme lokale sikkerhedsnet.

Den stærkeste beskyttelse bør stadig sættes på GitHub som branch protection rule for `master`.
