# Codex-regler for DFKS Portal

Disse regler gælder for alt Codex-arbejde i dette repository.

## Git-samarbejde

- Arbejd aldrig direkte på `master`.
- Opret altid en sidebranch før ændringer.
- Brug branch-navne som `codex/...`, `feat/...`, `fix/...`, `docs/...`, `refactor/...` eller `chore/...`.
- Push altid sidebranchen til GitHub.
- Opret Pull Request fra sidebranchen til `master`.
- Direkte push til `master` er ikke tilladt.
- Brug ikke force push, medmindre brugeren eksplicit beder om det og forstår risikoen.

## Efter en gennemført Pull Request

- Når en ønsket Pull Request er oprettet og kontrolleret, må dens branch ikke bruges til nyt featurearbejde.
- Hent altid seneste remote-status, og opret straks en ny sidebranch til det efterfølgende arbejde.
- Hvis PR'en er merget, skal den nye branch oprettes fra opdateret `origin/master`.
- Hvis PR'en stadig er åben, skal nyt uafhængigt arbejde oprettes fra `origin/master`. Arbejde, der afhænger af den åbne PR, må kun oprettes fra PR-branchens tip som en tydeligt angivet stacked branch.
- Nye commits på den gamle PR-branch er kun tilladt, når de konkret retter den eksisterende PR, for eksempel reviewkommentarer, konflikter eller fejlede checks.
- Bekræft og oplys navnet på den nye branch, før arbejdet fortsætter.

## Lokal app efter ændringer

- Efter hver funktionel kodeændring skal udviklingsserveren genstartes fra præcis den branch og worktree, som indeholder ændringen.
- Bekræft aktiv branch og worktree før genstart. Start aldrig appen fra hovedarbejdsmappen, hvis ændringen ligger i en isoleret worktree.
- Stop kun en eksisterende udviklingsserver, når processen tilhører dette repository. Afslut aldrig en uvedkommende proces, som bruger den ønskede port.
- Start appen med `npm run dev -- --hostname 0.0.0.0`, så den kan tilgås lokalt og via Tailscale. Brug som udgangspunkt port 3000.
- Hvis worktreet mangler `.env.local`, skal den eksisterende lokale konfiguration bruges uden at kopiere, vise eller committe hemmeligheder.
- Kontrollér efter genstart, at appen svarer, og rapportér branch, worktree, port samt lokal og eventuel Tailscale-URL.
- Hvis genstarten fejler, skal fejlen rapporteres. Skift ikke til en anden branch for at skjule problemet.
- Dokumentationsændringer og andre ændringer uden runtime-effekt kræver ikke genstart.

## Commit-beskeder

Brug korte commit-beskeder med prefix:

- `feat:` ny funktion
- `fix:` fejlrettelse
- `refactor:` oprydning uden ny funktionalitet
- `docs:` dokumentation
- `chore:` teknisk vedligeholdelse

Skriv hvad og hvorfor, ikke kun at noget er ændret.

Gode eksempler:

```text
docs: tilføj GitHub-samarbejdsmanual
fix: ret redirect efter login
feat: tilføj upload af medlemskontrakter
chore: installer Vercel CLI
```

## Pull Requests

Når Codex laver en PR, skal beskrivelsen altid indeholde:

- Hvad er ændret?
- Hvorfor er det ændret?
- Hvordan er det testet?

Opret ALDRIG en Pull Request (inkl. draft/kladde-PR) uden at brugeren eksplicit beder dig om det.

## Før push

Før Codex foreslår eller udfører push:

1. Vis kort hvilke filer der er ændret.
2. Bekræft at arbejdet ligger på en sidebranch.
3. Undgå push direkte til `master`.
4. Foreslå ikke og opret ikke PR, før brugeren beder om det.
