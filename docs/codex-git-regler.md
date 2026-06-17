# Codex Git-regler

Brug disse indstillinger i Codex, så arbejdet følger projektets GitHub-flow.

## Branch-præfiks

Anbefalet:

```text
codex/
```

Det gør det tydeligt, hvilke branches der er oprettet af Codex.

Eksempel:

```text
codex/readme-git-flow
codex/login-redirect-fix
```

## Fletningsmetode for pull-anmodning

Anbefalet:

```text
Squash merge
```

Det holder `master` ren, fordi flere små commits i en feature branch samles til én tydelig commit ved merge.

## Gennemtving altid push

Anbefalet:

```text
Fra
```

Brug ikke automatisk force push i et samarbejdsprojekt. Force push kan omskrive historik og skabe forvirring, hvis flere arbejder på samme repository.

## Opret pullanmodninger som kladder

Anbefalet:

```text
Til
```

Draft PR'er passer godt til Codex-arbejde, fordi ændringer kan gennemgås, før de signalerer "klar til merge".

## Vis PR-ikoner i sidepanelet

Anbefalet:

```text
Til
```

Det giver bedre overblik over PR-status direkte i Codex.

## Slet automatisk gamle arbejdstræer

Anbefalet:

```text
Til
```

Grænse på `15` er fin for de fleste.

## Indsættelsesinstruktioner

Sæt denne tekst ind:

```text
Brug korte commit-beskeder med prefix: feat:, fix:, refactor:, docs: eller chore:. Beskriv hvad og hvorfor. Commit aldrig direkte til master. Arbejd altid på en sidebranch og push kun sidebranchen.
```

## Instruktioner til pull-anmodning

Sæt denne tekst ind:

```text
PR skal altid gå fra en sidebranch til master. Beskriv kort: hvad er ændret, hvorfor, hvordan det er testet, og om Martin skal reviewe domæne/jura/arkitektur. Opret gerne PR som kladde først. Direkte push eller PR fra master til master er ikke tilladt.
```

## Projektets faste regel

Codex skal følge `AGENTS.md` i roden af projektet.

Den vigtigste regel er:

```text
Arbejd aldrig direkte på master. Alt arbejde skal ske på en sidebranch og ind via Pull Request.
```

