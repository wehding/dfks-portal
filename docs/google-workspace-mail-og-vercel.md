# Guide til Martin: Google Workspace-mail og Vercel

Denne guide samler opsætningen af DFKS-portalens Gmail-afsendelse, separate jobnøgler og genstart af Vercel-deployments.

## Før du starter

- Åbn Vercel-teamet `martin-wehdings-projects` og projektet `dfks-portal`.
- Hemmeligheder må ikke sendes i almindelig chat, lægges i GitHub eller skrives ind i kildekoden.
- Markér alle hemmelige værdier som **Sensitive**, hvis Vercel viser valget.
- Genbrug ikke den gamle fælles `INTERNAL_API_SECRET` i produktion. Hver baggrundsfunktion har sin egen nøgle, så en lækket nøgle ikke åbner alle jobflows.
- Servicekontoens komplette JSON-fil må aldrig uploades til GitHub eller Vercel som en fil. Kun de to nødvendige felter indsættes som separate miljøvariabler.

## 1. Opret separate jobnøgler

1. Generér en ny tilfældig værdi på din computer eller i en password manager. Fra Terminal kan du bruge:

   ```bash
   openssl rand -hex 32
   ```

2. Log ind på Vercel.
3. Vælg teamet/kontoen `martin-wehdings-projects`.
4. Åbn projektet `dfks-portal`.
5. Gå til **Settings → Environment Variables**.
6. Klik **Add Environment Variable**.
7. Opret hver af disse variabler med sin egen nygenererede værdi:
   - `CONTRACT_AI_JOB_SECRET` — almindelig kontraktaflæsning;
   - `CONTRACT_REVIEW_JOB_SECRET` — kontraktgennemgang og Gmail-bilag;
   - `DRIVE_IMPORT_JOB_SECRET` — import fra Google Drive;
   - `ONBOARDING_IMPORT_JOB_SECRET` — værksimport under onboarding.
8. Aktivér variablerne for både **Preview** og **Production**.
9. Aktivér **Sensitive**, hvis muligheden vises.
10. Klik **Save** efter hver variabel.

Værdierne må ikke genbruges på tværs af de fire variabler. Preview og Production kan have hver deres sæt nøgler.

## 2. Opret Google Workspace-variablerne

Find servicekontoens JSON-nøgle i den sikre placering, hvor den er gemt. Brug kun felterne `client_email` og `private_key`.

Opret følgende tre variabler under **Settings → Environment Variables**:

### `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`

- Værdi: JSON-feltet `client_email`.
- Miljøer: **Preview** og **Production**.
- Markér som **Sensitive**.

### `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

- Værdi: Hele JSON-feltet `private_key`, inklusive linjerne `BEGIN PRIVATE KEY` og `END PRIVATE KEY`.
- Vercel accepterer både rigtige linjeskift og tekst med `\n`; appen understøtter begge formater.
- Miljøer: **Preview** og **Production**.
- Markér som **Sensitive**.
- Indsæt aldrig hele JSON-filen som værdi.

### `GOOGLE_GMAIL_SENDER`

- Værdi: `bestyrelsen@danskfilmklipperselskab.dk`
- Miljøer: **Preview** og **Production**.
- Markér gerne som **Sensitive**, selv om adressen ikke i sig selv er en hemmelighed.

Kontrollér derefter, at Google-variablerne og de relevante jobnøgler findes for begge miljøer:

- `CONTRACT_AI_JOB_SECRET`
- `CONTRACT_REVIEW_JOB_SECRET`
- `DRIVE_IMPORT_JOB_SECRET`
- `ONBOARDING_IMPORT_JOB_SECRET`
- `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GOOGLE_GMAIL_SENDER`

## 3. Start en ny deployment

Miljøvariabler gælder ikke automatisk for deployments, der allerede er bygget.

1. Gå til projektets **Deployments**.
2. Åbn den nyeste deployment for den relevante branch eller PR.
3. Klik på menuen med de tre prikker øverst til højre.
4. Vælg **Redeploy**.
5. Fjern markeringen i **Use existing Build Cache**, hvis valget vises.
6. Bekræft med **Redeploy**.
7. Vent, indtil deploymentet står som **Ready**.

PR #75 og branchen `codex/ux-features` er allerede flettet og er ikke længere den deployment, der skal genstartes. For Google-mailændringen skal den nyeste Preview-deployment for branchen `feat/google-workspace-mail` genstartes, når branchen senere har fået en PR/deployment.

Hvis deploymentet fejler, åbn **Build Logs** og send de første røde fejllinjer. Send aldrig linjer, der viser private keys, tokens eller andre miljøværdier.

## 4. Kontroller Preview

Når deploymentet er **Ready**:

1. Åbn Preview-linket.
2. Opret eller gensend en invitation til en kontrolleret ekstern testadresse.
3. Kontrollér, at mailen kommer fra `bestyrelsen@danskfilmklipperselskab.dk` med DFKS som vist afsendernavn.
4. Kontrollér, at invitationens link åbner siden til oprettelse af adgangskode.
5. Brug Gmail-funktionen **Vis original** hos modtageren og kontrollér `SPF=PASS` og `DKIM=PASS`.
6. Kontrollér, at svar går til organisationens valgte **Svaradresse (Reply-To)**.

## 5. Production og oprydning

Når Preview-testen er bestået:

1. Kontrollér igen, at Google-variablerne og de fire separate jobnøgler er aktiveret for **Production**.
2. Start eller afvent den nye Production-deployment.
3. Udfør én kontrolleret invitationstest i Production.
4. Kontrollér igen `SPF=PASS` og `DKIM=PASS`.
5. Fjern `RESEND_API_KEY` fra både Preview og Production, når Gmail-testen er godkendt. Koden har ingen fallback til Resend.

## Lokal udvikling

De samme Google-værdier kan sættes i den lokale `.env.local`:

```dotenv
GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL=servicekonto@projekt-id.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_GMAIL_SENDER=bestyrelsen@danskfilmklipperselskab.dk
CONTRACT_REVIEW_JOB_SECRET=<en unik tilfældig værdi>
```

`.env.local` og servicekontoens JSON-nøgle er ignoreret lokalt og må aldrig committes. Genstart `npm run dev`, når variablerne ændres.

## Import til kontraktgennemgang

Importen overvåger kun den primære postkasse `bestyrelsen@danskfilmklipperselskab.dk`. Adressen `kontrakt@danskfilmklipperselskab.dk` er et alias; systemet forsøger derfor ikke at identificere aliaset i mailens headers.

1. Opret et Gmail-filter i Google Workspace, som sætter labelen `kontrakter` på de mails, der skal importeres.
2. Giv servicekontoens domænedækkende delegation Gmail-scope `https://www.googleapis.com/auth/gmail.modify`. Dette scope bruges til at læse de labelmærkede mails og tilføje outputlabelen. Systemet fjerner aldrig labels, arkiverer ikke og markerer ikke mails som læst.
3. Opret et Google Cloud Pub/Sub-topic og giv Gmail mulighed for at publicere på det efter Googles officielle Gmail watch-vejledning.
4. Opret en verificeret Pub/Sub push-servicekonto, der kalder:

   `https://<portalens-domæne>/api/integrations/gmail/contracts/push`

5. Tilføj disse miljøvariabler i Vercel og lokalt:

   ```dotenv
   GOOGLE_GMAIL_CONTRACT_ORG_ID=<DFKS-organisationens UUID>
   GOOGLE_GMAIL_CONTRACT_TOPIC=projects/<google-cloud-project>/topics/<topic-navn>
   GOOGLE_PUBSUB_PUSH_AUDIENCE=https://<portalens-domæne>/api/integrations/gmail/contracts/push
   GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL=<pubsub-push-servicekontoens-email>
   ```

6. Kør watch-ruten én gang som superadmin eller via Vercels beskyttede cron. Den fornyes derefter dagligt. Inputlabelen `kontrakter` skal allerede findes; outputlabelen `kontrakt gennemgang` oprettes automatisk, hvis den mangler.

En mail får først outputlabelen `kontrakt gennemgang`, når alle understøttede bilag (`.pdf`, `.doc`, `.docx`) er oprettet som sager. Mailtekst og spørgsmål gemmes som reference. AI laver kun et lokalt svarudkast, som en jurist skal kontrollere. Portalen opretter ikke Gmail-kladder og sender aldrig svaret automatisk.
