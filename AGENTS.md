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
- Er der noget Martin skal reviewe?

PR'er bør som udgangspunkt oprettes som kladder, indtil brugeren siger, at de er klar til review.

## Martin-review

Spørg Martin eller markér tydeligt i PR'en, hvis ændringen berører:

- juridiske regler
- royaltysatser
- overenskomstlogik
- kontrakttyper
- AI-prompts med domæneviden
- databasearkitektur
- modulernes formål og adskillelse

## Før push

Før Codex foreslår eller udfører push:

1. Vis kort hvilke filer der er ændret.
2. Bekræft at arbejdet ligger på en sidebranch.
3. Undgå push direkte til `master`.
4. Foreslå PR mod `master`.

