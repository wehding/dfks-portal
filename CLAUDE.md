# DFKS Kontraktportal — Agent Guide

> Læs denne fil **inden** du skriver en eneste linje kode.
> Den indeholder arkitekturbeslutninger, domæneviden og "rør ikke ved X"-regler.

---

## Hvad er dette projekt?

Et AI-drevet kontraktportal for **Dansk Filmklipperselskab (DFKS)** — en faglig organisation for filmklippere i Danmark.

Portalen har fire adskilte moduler:

| Modul | Formål | Bruger |
|---|---|---|
| **Kontraktgennemgang** | AI-feedback på udkast *inden* underskrift | Medlemmer + Admin |
| **Kontraktvalidering** | Dataudtræk fra *underskrevne* kontrakter til rettigheder/statistik | Admin |
| **Streaming-rettigheder** | Aftalelicens/kollektiv licensadministration og udbetalinger | Admin + Medlemmer |
| **Arkiv** | Opbevaring af validerede kontrakter, dokumentation for rettighedshaveres rettigheder, datagrundlag for løbende statistik | Admin |

**Kritisk:** Hold disse fire moduler skarpt adskilt. Scope-creep mellem dem skaber forvirring.

**Validering → Arkiv** er en envejsstrøm. En kontrakt lander i arkivet *efter* den er valideret — aldrig direkte.

### Allonger til egne kontrakter (medlemsportal)
Medlemmer kan selv uploade allonger (forlængelser, ekstra uger) til deres egne kontrakter i `/portal/mine-kontrakter` — i kontrakt-detalje-overlayet, uafhængigt af selve kontraktuploaden. Dette kan ske når som helst efter kontrakten er uploadet, uanset kontraktens status (kladde/valideret/arkiveret), fordi allonger typisk kommer senere og kan påvirke arbejdsuger/løn.

- `contract_attachments.type = 'allonge'` bruges til dette — til forskel fra `'bilag'`/`'andet'`.
- Server actions: `app/actions/member-attachments.ts` (`uploadMemberAttachment`, `deleteMemberAttachment`).
- **Medlem kan selv slette en allonge — men kun indtil admin har validereret den.** `deleteMemberAttachment` tjekker `contract_attachments.ai_status`: så længe den ikke er `'klar'` (dvs. admin ikke har kørt/gemt allonge-udtræk endnu, se nedenfor) kan medlemmet slette sin egen allonge. Når `ai_status = 'klar'`, afvises medlemmets sletning — herefter er det kun admin (`"Admins kan administrere bilag"`-policyen) der kan slette. Håndhæves både i `deleteMemberAttachment` (application-niveau, tolerant hvis `ai_status`-kolonnen mangler) og i RLS (`"Brugere kan slette egne allonger inden validering"`, migration `20260703224439`).
- UI: `app/portal/mine-kontrakter/AddAlongeDialog.tsx` + allonge-listen i `MineKontrakterClient.tsx`.
- Admin ser allonger i to steder: `app/admin/kontrakter/page.tsx` (kontraktliste + "Se kontrakt"-dialog, antal-badge + klikbare knapper der åbner via signeret URL) og `app/admin/validering/page.tsx` (se nedenfor, samme antal-badge i listen).

**AI-udtræk af allonger (`app/admin/validering/page.tsx`)** — hvert allonge-vedhæftning får sin egen fane i valideringsdialogen, ved siden af "Kontrakt"-fanen:
- Allonge-fanen kører et *separat, afgrænset* AI-udtræk via `/api/validate/extract-allonge` (bruger `lib/allonge-text.ts` til tekstudtræk af netop den ene fil) — kun tre felter: `salary`/`salaryUnit` (den NYE løn fremadrettet fra allongen), `workingWeeks` (EKSTRA arbejdsuger tilføjet af allongen — ikke det samlede antal), og `specialNotes`. De øvrige kontraktfelter (overenskomst, royalty, SVOD osv.) vises i samme fane som read-only "Baggrundsinformation" hentet fra kontraktens egen `extracted_data` — de bliver IKKE gen-udtrukket eller ændret af allonge-fanen.
- Løn erstatter ikke kontraktens oprindelige løn (den gjaldt jo frem til allongen) — i stedet gemmes begge: `extracted_data.salary`/`salaryUnit` er kontraktens egen (uændret), `extracted_data.currentSalary`/`currentSalaryUnit` er den nyeste gældende løn (fra seneste "klar"-allonge, falder tilbage til kontraktens egen hvis ingen allonger er behandlet endnu).
- Arbejdsuger lægges sammen: `extracted_data.contractWorkingWeeks` er kontraktens egne uger (det tal admin ser og redigerer i selve "Kontrakt"-fanen), `extracted_data.workingWeeks` bliver den SAMLEDE arbejdstid (kontrakt + alle "klar"-allonger) — genberegnes ved hvert allonge-gem OG ved almindeligt "Godkend" på kontrakten, så rækkefølgen ikke betyder noget. Det er `workingWeeks` (totalen) statistikmodulet (`app/admin/statistik/page.tsx`) allerede læser, så ingen ændringer var nødvendige der.
- Hver allonges egne udtrukne felter gemmes i `contract_attachments.ai_result` (`{ salary, salaryUnit, workingWeeks, specialNotes, extractedAt }`) med `ai_status = 'klar'` — disse felter var tidligere forberedt men ubrugte, og er nu i aktiv brug til netop dette formål.
- Ved flere allonger på samme kontrakt: én fane per allonge, hver med sit eget "klar"-udtræk; totalen summeres på tværs af alle.
- **En ny allonge genåbner kontrakten i valideringskøen.** Så snart en kontrakt har en allonge med `ai_status != 'klar'`, dukker den op i "Afventer"-fanen i `/admin/validering` — også selvom kontraktens egen `status` stadig er `valideret`/`arkiveret` (selve `status`-feltet røres ikke, kun visningen i køen). Den viser badgen "Allonge afventer" i listen for at gøre det tydeligt hvorfor en allerede godkendt kontrakt er tilbage i køen, og åbner direkte på den relevante allonge-fane. Sidemenuens tal ved "Kontrakter" og "Kontraktvalidering" (`app/admin/layout.tsx`) tæller nu foreningsmængden af `status = 'kladde'`-kontrakter og kontrakter med en ubehandlet allonge.

---

## Stack

```
Next.js (App Router) · TypeScript strict · Tailwind CSS · shadcn/ui
Supabase (postgres + pgvector til RAG) · projekt-ref: icxywdymyaxluaxxcpye (West EU / Irland)
Claude API (alle kald server-side — ingen direkte client-kald)
Vercel (deployment) · dfks-portal.vercel.app
mammoth (DOCX-parsing, server-side)
PDF.js / react-pdf (PDF-rendering)
Google text-embedding-004 (768 dim) — primær embedding-udbyder
```

**Repo:** `github.com/wehding/dfks-portal`

---

## Mappestruktur

```
/app
  /admin                      ← Admin-sider (rollebaseret menu via ROLE_MODULES i layout.tsx)
    /aftalelicens             ← Aftalelicens-modul (liste + [id]-detaljeside)
    /ai-kontrolrum            ← AI-nøglehåndtering
    /barselspulje             ← Barselspulje
    /brugere                  ← Brugeradministration
    /gennemsigtighed          ← Gennemsigtighed
    /helligdagsfond           ← Helligdagsfond
    /indbetalinger            ← Indbetalinger
    /kontrakter               ← Kontraktliste (koblet til DB)
    /kontraktgennemgang       ← AI-kontraktgennemgang (gemmer til contract_reviews)
    /krediteringer            ← Krediteringer
    /kvalitet                 ← Kvalitetsstyring
    /overenskomster           ← Section A (docs), B (ProF-liste), C (juridiske noter)
    /producenter              ← Producentliste
    /rettighedshavere         ← Rettighedshaver-administration
    /stamdata                 ← Stamdata
    /statistik                ← Statistik
    /streaming                ← Streaming-rettigheder modul (liste + [id]-detaljeside)
    /udbetalinger             ← Udbetalinger
    /vaerker                  ← Værk-administration
    /validering               ← Kontraktvalidering (AI-udtræk)
    /videnbase                ← RAG knowledge base admin
  /api
    /admin/ai-keys            ← AI-nøglehåndtering API
    /admin/user(s)            ← Brugeradmin API
    /aftalelicens/ai-soeg     ← AI-søgning i aftalelicens
    /aftalelicens/grovsorter  ← Grovsortering af aftalelicens
    /auth/invite              ← Invite-kode håndtering
    /contracts/extract        ← Kontraktudtræk (validering)
    /dfi/company              ← DFI firmadata opslag
    /gennemgang               ← AI-kontraktgennemgang (systempromt + API-route)
    /health/embeddings        ← Embedding-provider status (google/syv + aktiv)
    /knowledge/upsert         ← Upsert knowledge chunk
    /learned-patterns         ← Lærte mønstre
    /legal-notes              ← Juridiske noter
    /prof-sync                ← ProF-liste sync
    /screen                   ← Alle øvrige Claude API-kald går HER
    /tmdb                     ← TMDB filmdata
    /validate/extract         ← Validering udtræk
    /validate/extract-allonge ← Afgrænset AI-udtræk af allonge (løn/uger/kommentarer)
    /videnbase                ← Videnbase API
  /portal                     ← Medlemsportal
    /aftalelicens
    /min-profil
    /mine-kontrakter
    /mine-vaerker
    /okonomi
  /actions                    ← Server actions
    /dfi.ts · member-contracts.ts · member-attachments.ts · member-profile.ts · member-works.ts · tmdb.ts
  /indbetalinger              ← Indbetalinger (member)
  /invite                     ← Invite-side
/components
  /streaming                  ← Streaming-dialogs (se nedenfor)
  /ui                         ← shadcn/ui-komponenter
  language-toggle.tsx         ← Sprogs skift
  notering-guide.tsx          ← Guide til juridiske noteringer
  page-header.tsx             ← Sidehoved-komponent
  pdf-viewer.tsx + pdf-viewer-inner.tsx ← PDF-visning med highlights
  providers.tsx               ← Kontekst-providers
  source-btn.tsx              ← Kilde-knap
  theme-toggle.tsx            ← Mørk/lys tilstand
/lib
  ai.ts                       ← BASE_SYSTEM prompt, anonymizeContractText, LegalNote/ReferenceDoc types, _legalNotes singleton
  ai-client.ts                ← AI-klientabstraktion
  ai-feedback.ts              ← Feedback-loop hjælper
  ai-fields.ts                ← Feltregler (COLLECTIVE_AGREEMENT_RULE m.fl.)
  ai-history.ts               ← Samtalehistorik
  ai-key-store.ts             ← AI-nøglestyring
  ai-providers.ts             ← AI-udbyderabstraktion
  ai-sources.ts               ← SOURCES_SCHEMA_PROMPT
  contract-store.ts           ← Kontrakt state store
  de4-overenskomst-2022.ts    ← De4-overenskomst (hardcodet — se mangler)
  email.ts                    ← Resend-integration
  embedding-provider.ts       ← Google text-embedding-004 (768 dim) + syv.ai fallback
  encryption.ts               ← Kryptering
  few-shot-examples.ts        ← Few-shot eksempler til AI
  hooks.ts                    ← React hooks
  i18n.tsx                    ← Internationalisering
  mail-format-prompt.ts       ← [GUL]-mailformat til producent
  mask-text.ts                ← GDPR-maskning
  mock-data.ts                ← Testdata
  pdf-parse.ts                ← PDF-parsing
  resolveAnker.ts             ← PDF-tekst highlight-hjælper (fem-trins prioritering)
  retrieval.ts                ← hentRelevanteRegler(), upsertKnowledgeChunk(), deleteKnowledgeChunk()
  rettighedshaver-tjek.ts     ← Navnetjek mod kontraktforekomster + alternative navne
  streaming-types.ts          ← Type-definitioner for streaming-modulet
  types.ts                    ← Fælles typer
  utils.ts                    ← Hjælpefunktioner
  /db                         ← Database query-lag (én fil per modul)
    types.ts · organisations.ts · rettighedshavere.ts · contracts.ts
    validering.ts · gennemgang.ts · overenskomster.ts · vaerker.ts · employers.ts
  /supabase
    client.ts                 ← @supabase/ssr browser-klient
    server.ts                 ← @supabase/ssr server-klient
/supabase/migrations          ← Alle SQL-migrationer (kørt i produktion)
/data/knowledge-base          ← JSON-lovtekster klar til indexering (18 chunks)
/scripts
  index-knowledge-base.ts     ← Indexer JSON-filer + sagserfaringer + juridiske noter
  index-rules.ts              ← Regelindeksering
  migrate-cases.ts            ← Sagsmigrering
/docs                         ← Dokumentation
```

---

## Domæneviden — DFKS-specifikke regler

### Royaltysatser
- **1,5% er standard for dokumentarfilm** (FAF overenskomsten)
- **1,0% er standard for spillefilm** (De4 overenskomsten)
- **Under disse satser er ALTID kritisk** — flag altid, uanset kontekst
- Sats på 0% uden begrundelse = alvorlig advarsel

### Kontrakttyper
- **A-løn** = ansættelsesforhold → overenskomstforpligtelser gælder fuldt ud
- **Leverandør/B2B** = freelance → andre regler, men overenskomst kan stadig gælde

### Klausuler der IKKE skal flagges
- Begrænsninger på økonomisk rådighed (normal producerret)
- Manglende underskrifter på *udkast*
- 14-dages betalingsbetingelser (standard)
- Producentens økonomiske kontrol

### Streaming-rettigheder
- **Create Denmark** er en godkendt kollektiv forvaltningsorganisation
- Streaming-rettigheder **uden tidsbegrænsning** er et rødt flag
- Aftalelicens = kollektiv licens-administration

### Kollektive aftaler
FAF · De4 · Create Denmark (streaming) · Copydan

### FAF vs De4 standardkontrakt
- **De4 2022**: slutter med "...Copydan-forbehold og SVOD-aftale" — rettigheder eksplicit dækket
- **FAF 2025-2027**: slutter med "...Create Denmark rammeaftale" — INGEN eksplicit Copydan, SVOD eller royalties. Disse skal altid tilføjes separat ved FAF-kontrakter.

### Udbetalingsmodeller (streaming)
- **Model 1:** Værdistyret — navngivne værker med specificerede beløb
- **Model 2:** Kollektiv licenspulje — Copydan Verdens TV, Copydan Arkiv, TV2 Play

### Nøgleterminologi
`IRF` · `fordelingsnøgle` · `aftalelicens` · `genudsendelse` · `klump` · `NemKonto` · `DFI`

### Relevant lovgivning
**Kritisk:** Ophavsretsloven §1, §2, §3, §53, §65, §66 · Aftaleloven §36, §38a  
**Vigtig:** Funktionærloven · Ferieloven · Barselsloven (ansættelseskontrakter)

---

## Arkitekturbeslutninger — rør ikke uden at spørge

### 1. Admin fee placering
`StreamingPayout` (IKKE `StreamingProduction`) — satser ændrede sig historisk, fremtidige ændringer skal gælde per udbetaling, ikke per produktion.

### 2. Claude API-kald
**Alle** kald til Claude API går server-side. `/api/screen` er generel gateway. `/api/gennemgang` og `/api/contracts/extract` og `/api/validate/extract` er specialiserede routes. Ingen direkte kald fra client-komponenter.

### 3. JSON-parsing fra Claude
Udtræk indhold mellem første og sidste tuborg-parentes — håndterer prose-wrapping:
```typescript
const start = raw.indexOf('{');
const end = raw.lastIndexOf('}');
const json = JSON.parse(raw.slice(start, end + 1));
```

### 4. RAG over fine-tuning
RAG er den rigtige tilgang. `semantisk_beskrivelse` (plain dansk) embeddes — ikke juridisk råtekst.

### 5. Embedding-udbyder
**Google `text-embedding-004`** er primær og eneste produktionsudbyder (768 dim).
- syv.ai (`embed.syv.ai`) er implementeret som fallback via `EMBEDDING_PROVIDER=syv` men ustabil
- Voyage AI vurderet men fravalgt — ikke målbar gevinst for vores knowledge base-størrelse
- Supabase: `vector(768)` kolonne i `knowledge_chunks`

### 6. GDPR / databehandleraftale
Følsomme data **maskes** inden API-kald via `lib/mask-text.ts`: CPR · bankkonti · IBAN · telefonnumre · adressenumre. Se også `anonymizeContractText()` i `lib/ai.ts`.

### 7. Auth og roller
- Supabase Auth med `@supabase/ssr` — session-refresh i middleware
- Roller fra `raw_user_meta_data.role`: `admin`, `org-admin`, `superadmin` → `/admin/...`, ellers `/portal/...`
- Invite-kode gate i middleware
- Rolle sættes via SQL: `update auth.users set raw_user_meta_data = raw_user_meta_data || '{"role": "admin"}' where email = '...'`
- DFKS org_id: `3dfcad23-03ce-4de0-82f2-6566dfcd88a5`

---

## Database — kørt i produktion

Alle migrationer kørt i Supabase SQL Editor. Filer i `supabase/migrations/`.

| Migration | Tabeller |
|---|---|
| Modul 0 | `organisations`, `user_org_roles` |
| Modul 0b | `rettighedshavere`, `org_affiliations` (trigger ved ny auth-bruger) |
| Modul 1 | `employers`, `employer_registries`, `contracts`, `contract_attachments`, `contract_episodes` |
| Modul 2 | `contract_validations` |
| Modul 3 | `contract_reviews` |
| Modul 4 | `agreements`, `reference_docs`, `legal_notes`, `legal_note_history` |
| Modul 5 | `works`, `work_production_numbers`, `episodes`, `work_assignments` |
| 20260605 | Producentlister, reference_docs extensions |
| 20260605 | `case_learnings` |
| 20260609 | `knowledge_chunks` (vector(768)) |
| 20260611 | `contracts` member-felter, member onboarding |
| 20260703 | `contract_attachments` udvidet: `ai_status`, `ai_result` — bruges aktivt af allonge-udtræk i `/admin/validering`; ny RLS-policy så medlemmer selv kan uploade allonger til egne kontrakter (`20260703210149`) |
| 20260703 | Ny RLS delete-policy: medlemmer kan slette egne allonger indtil `ai_status = 'klar'` (`20260703224439`) |

---

## Design og UI-mønstre

### shadcn/ui-komponenter i brug
Avatar · Badge · Breadcrumb · Button · Calendar · Card · Collapsible · Dialog · DropdownMenu · Input · Label · Popover · Progress · Select · Separator · Sheet · Sidebar · Skeleton · Sonner (toast) · Switch

### Layout
- Admin: sidebar-navigation (`components/ui/sidebar.tsx`) med rollebaserede menupunkter defineret i `ROLE_MODULES` i `app/admin/layout.tsx`
- Portal: separat layout i `app/portal/layout.tsx`
- `page-header.tsx` bruges konsistent som sideoverskrift

### Farver og Tailwind
- Mørk/lys tilstand via `theme-toggle.tsx` og `providers.tsx`
- Tailwind standard utility-klasser — ingen custom design tokens observeret

### [GUL]-konvention i feedbackmails
- AI markerer producent-tekst med `[GUL]...[/GUL]`
- UI renderer det som gul highlight
- "Kopiér til producent"-knap udtrækker kun gule afsnit

### Juridiske noteringer (Section C på overenskomster-siden)
Tre prioriteter:
- `aktiv-indsats` (orange) — AI nævner eksplicit at DFKS prioriterer punktet
- `fast-regel`/`altid-tjek` (blå) — AI kommenterer altid, positivt eller negativt
- `orientering` (grå) — kun baggrundsviden, kommenteres ikke direkte

### Loading/error states
Sonner (`sonner.tsx`) bruges til toast-notifikationer. Skeleton-komponenter til loading.

---

## Komponenter — hvad de gør

### Streaming-dialogs (`components/streaming/`)
- `RegisterPayoutDialog` — registrer ny udbetaling
- `AddEditorDialog` — tilføj filmklipper
- `AddExploitationDialog` — tilføj exploitation
- `CreateDistributionKeyDialog` — opret fordelingsnøgle
- `NewProductionDialog` — opret ny produktion
- `UploadContractDialog` — upload kontrakt

### PDF-håndtering
- `pdf-viewer.tsx` — wrapper med lazy loading
- `pdf-viewer-inner.tsx` — selve PDF.js renderingen med highlight-logik
- `resolveAnker.ts` — fem-trins prioritering til at matche AI-citater til PDF-tekst

### resolveAnker.ts — fem-trins prioritering
1. Direkte normaliseret match
2. Tal/beløb-prioritering
3. `ANKER_OVERRIDES`-bibliotek
4. Korteste unikke substring
5. Fallback med advarsel

---

## PDF.js quirks — lær af vores fejl

- **Tekstfragmentering:** PDF.js splitter tekst uforudsigeligt. Brug robust normalisering.
- **Splittede tal:** `"1 7,6"` → `"17,6"` — kræver post-processing.
- **CSS til highlights:** Brug CSS data-attribute selectors injiceret i `document.head`. React overskriver inline styles.
- **Keyword anchors:** Virker bedre end AI-genererede lange strenge til sektionsmatch.

---

## RAG-system

- `lib/embedding-provider.ts` — Google text-embedding-004 default; syv.ai via `EMBEDDING_PROVIDER=syv`; automatisk fallback
- `lib/retrieval.ts` — `hentRelevanteRegler()`, `upsertKnowledgeChunk()`, `deleteKnowledgeChunk()`
- `app/api/health/embeddings/route.ts` — GET returnerer `{ google, syv, aktiv }` med ok/ms
- Admin-dashboard (`app/admin/page.tsx`) viser embedding-statusboks
- `data/knowledge-base/*.json` — lovtekster: ophavsretsloven, aftaleloven, funktionærloven, ferieloven, barselsloven (18 chunks)
- `scripts/index-knowledge-base.ts` — indekserer JSON-filer + sagserfaringer + juridiske noter
- Kør indexering: `npx tsx scripts/index-knowledge-base.ts`
- `app/api/admin/reindex/route.ts` — re-embedder alle chunks fra gemt `tekst`-felt
- `vercel.json` — cron job kører reindex hver mandag kl. 3
- Env: `GOOGLE_API_KEY` + `EMBEDDING_PROVIDER=google`

---

## Email

- `lib/email.ts`: Resend-integration med abstraktionslag (skift til Brevo: ~30 min)
- Env var: `RESEND_API_KEY`

---

## Kendte mangler

- **Overenskomsttekster hardcodet i `lib/de4-overenskomst-2022.ts`** — skal erstattes af Supabase-uploads:
  - De4-overenskomsten 2022 (fiktion) — VIGTIGST, inkl. Copydan + SVOD
  - FAF-overenskomsten 2025-2027 (fiktion)
  - FAF-dokumentaroverenskomsten
  - Lønskemaer for begge
- **retsinformation-api.dk integration** — næste RAG-opgave (se project_retsinformation_task.md i memory)

---

## Under opbygning (prioriteret rækkefølge)

1. ✅ RAG knowledge base — Google text-embedding-004 (768 dim), Supabase vector(768) klar
2. ✅ Kontraktgennemgang gemmer til `contract_reviews`
3. ✅ Rollebaseret admin-menu
4. ✅ Auth + invite-kode gate
5. ✅ Cron-job reindeksering (vercel.json)
6. retsinformation-api.dk integration — struktureret dansk lov med versionshistorik
7. Caching-lag til juridiske tekster
8. Aftalelicens databehandlingsmodul — Excel-import, DFI API-opslag, rettighedshaver-tilknytning
9. Admin-UI for rettighedshavere (liste, opret, skift medlemsstatus)
10. Validering — gem til `contract_validations` i stedet for mock

---

## Multi-faggruppe arkitektur (fremtidigt)

Se MEMORY.md for fuld beskrivelse. Kort:
- Én fælles Supabase-database (produktioner, producenter, ProF-liste, fælles juridiske noter)
- Separate org-databaser per faggruppe for personfølsomme data (GDPR)
- `org_id`-scopet skal designes fra dag 1 — meget dyrere at tilføje bagefter
- `org.features[]` styrer hvilke moduler der er aktive per faggruppe
- Superadmin-onboarding skal være selvbetjening

---

## Konventioner

- **TypeScript everywhere** — ingen løse JS-filer i nye komponenter
- **Server-side data fetching** — brug Next.js server components hvor muligt
- **Fejlhåndtering:** Wrap alle Claude API-kald i try/catch med brugervenlige fejlbeskeder på dansk
- **Commit-beskeder:** `feat:` / `fix:` / `refactor:` prefix — skriv *hvad og hvorfor*, ikke bare *hvad*
- **Branches:** Brug feature branches — `feat/rag-implementation`, `fix/pdf-highlight` osv.
- **JSON fra Claude:** Udtræk altid mellem første `{` og sidste `}` — håndterer prose-wrapping

---

## Når du er i tvivl

Spørg Martin. Han har dyb domæneviden om den danske filmindustri og ved præcis hvilke klausuler der er normale vs. kritiske.

### Hvad du IKKE må ændre uden Martins godkendelse
- Domæneviden (royaltysatser, kontrakttyper, lovgivning)
- "Rør ikke"-regler under Arkitekturbeslutninger
- Modulernes formål og adskillelse

---

## Git-samarbejde

Arbejd aldrig direkte på master.
Opret altid en sidebranch før ændringer: `feat/...`, `fix/...` eller `refactor/...`.
Push altid sidebranchen og lav Pull Request ind i master.
Direkte push til master er ikke tilladt.
Ved domæneændringer eller tvivl: spørg Martin før merge.
Lav altid PRs mod `wehding/dfks-portal` som base repository — aldrig mod upstream.
