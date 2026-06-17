# DFKS Portal

DFKS Portal er en webportal for Dansk Filmklipperselskab. Projektet samler arbejdsgange omkring kontraktgennemgang, kontraktvalidering, rettighedshavere, vaerker, overenskomster og streamingrettigheder.

Portalen er bygget som en Next.js-app med Supabase som backend og AI-understoettede funktioner til blandt andet kontraktgennemgang og juridiske noter.

## Hovedfunktioner

- Kontraktgennemgang: AI-feedback paa kontraktudkast inden underskrift.
- Kontraktvalidering: udtraek af data fra underskrevne kontrakter.
- Adminportal: kontrakter, producenter, rettighedshavere, overenskomster, statistik og videnbase.
- Medlemsportal: profil, egne kontrakter og egne vaerker.
- Streamingrettigheder: administration af rettigheder, fordelingsnoegler og udbetalinger.
- RAG/videnbase: juridiske tekster, DFKS-regler og laerte moenstre.

## Teknologi

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase Auth, Postgres, Storage og pgvector
- Vercel
- AI-integrationer server-side
- PDF.js / react-pdf
- mammoth til DOCX-parsing

## Lokal opsaetning

Installer dependencies:

```bash
npm install
```

Hent miljoevariabler fra Vercel, hvis du har adgang:

```bash
npx vercel login
npx vercel link
npx vercel env pull .env.local
```

Start udviklingsserveren:

```bash
npm run dev
```

Aabn derefter:

```text
http://localhost:3000
```

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Projektstruktur

- `app/` - sider, layouts, API-routes og server actions.
- `components/` - UI-komponenter og feature-komponenter.
- `lib/` - databaseadgang, Supabase-klienter, AI-logik, RAG og hjaelpefunktioner.
- `supabase/migrations/` - database-migrationer.
- `data/knowledge-base/` - juridiske og faglige knowledge base-filer.
- `scripts/` - scripts til indexering og migrering.
- `docs/` - projektdokumentation.

Læs også:

- `CLAUDE.md` - agentguide, arkitektur, domæneregler og "rør ikke"-regler.
- `AGENTS.md` - faste Codex-regler for Git, commits og PR'er.
- `DESIGN.md` - designnoter.
- `docs/git-samarbejde.md` - begynderhåndbog til GitHub-samarbejde.
- `docs/codex-git-regler.md` - anbefalede Codex-indstillinger til samarbejde.
- `docs/ai-tilgang.md` - overblik over AI-tilgangen.

## GitHub-arbejdsgang

Projektets hovedbranch hedder i denne checkout `master`. Hvis teamet senere omdoeber den til `main`, skal kommandoerne nedenfor tilpasses.

Arbejd aldrig direkte paa hovedbranchen. Brug altid en sidebranch:

```bash
git fetch origin
git checkout master
git pull origin master
git checkout -b feat/kort-navn
```

Lav dine aendringer, test lokalt, commit og push sidebranchen:

```bash
git status
git add .
git commit -m "feat: kort beskrivelse"
git push origin feat/kort-navn
```

Opret derefter en Pull Request paa GitHub fra din branch ind i `master`.

## Pull Requests

En PR skal kort beskrive:

- hvad der er aendret
- hvorfor det er aendret
- hvordan det er testet
- om der er noget Martin eller andre skal vaere saerligt opmaerksomme paa

Direkte push til `master` er ikke tilladt. Hovedbranchen skal holdes stabil, og features skal reviewes via PR.

## Samarbejdsregler

- Brug branches som `feat/...`, `fix/...`, `refactor/...` eller `docs/...`.
- Hold commits smaa og beskrivende.
- Pull fra hovedbranchen, foer du starter nyt arbejde.
- Lav PR tidligt, hvis du vil have feedback undervejs.
- Spørg Martin ved domænespørgsmål eller ændringer i juridisk/faglig logik.
- Ændr ikke arkitekturbeslutninger eller domæneregler uden aftale.

Se den fulde begynderhåndbog i `docs/git-samarbejde.md`.

## Miljøvariabler

Miljøvariabler ligger ikke i Git. `.env*` er ignoreret i `.gitignore`.

Typisk hentes lokale variabler fra Vercel:

```bash
npx vercel env pull .env.local
```

Del aldrig `.env.local`, service keys eller API-nøgler i commits, chat eller PR-beskrivelser.

## Deployment

Projektet er sat op til Vercel. Deployment bør ske fra den stabile hovedbranch efter review og merge.

Features udvikles og testes på sidebranches, hvorefter de merges via Pull Request.

## Kontakt og ejerskab

Projektet udvikles i samarbejde mellem DFKS, Martin og øvrige bidragydere. Ved tvivl om domæne, juridiske regler, overenskomster eller faglig prioritering: spørg Martin før merge.
