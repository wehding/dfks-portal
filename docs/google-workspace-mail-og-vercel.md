# Guide til Martin: Google Workspace-mail og Vercel

Denne guide samler opsætningen af DFKS-portalens Gmail-afsendelse, `INTERNAL_API_SECRET` og genstart af Vercel-deployments.

## Før du starter

- Åbn Vercel-teamet `martin-wehdings-projects` og projektet `dfks-portal`.
- Hemmeligheder må ikke sendes i almindelig chat, lægges i GitHub eller skrives ind i kildekoden.
- Markér alle hemmelige værdier som **Sensitive**, hvis Vercel viser valget.
- Den tidligere værdi til `INTERNAL_API_SECRET` har været delt i en chat og skal derfor erstattes af en ny tilfældig værdi.
- Servicekontoens komplette JSON-fil må aldrig uploades til GitHub eller Vercel som en fil. Kun de to nødvendige felter indsættes som separate miljøvariabler.

## 1. Opret en ny `INTERNAL_API_SECRET`

1. Generér en ny tilfældig værdi på din computer eller i en password manager. Fra Terminal kan du bruge:

   ```bash
   openssl rand -hex 32
   ```

2. Log ind på Vercel.
3. Vælg teamet/kontoen `martin-wehdings-projects`.
4. Åbn projektet `dfks-portal`.
5. Gå til **Settings → Environment Variables**.
6. Klik **Add Environment Variable**.
7. Skriv `INTERNAL_API_SECRET` som navn/key.
8. Indsæt den nygenererede værdi.
9. Aktivér variablen for både **Preview** og **Production**.
10. Aktivér **Sensitive**, hvis muligheden vises.
11. Klik **Save**.

Værdien må ikke genbruges fra den gamle guide. Preview og Production må gerne bruge samme værdi, fordi appens interne afsender og modtager læser den samme miljøvariabel inden for hvert miljø.

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

Kontrollér derefter, at alle fire variabler findes for begge miljøer:

- `INTERNAL_API_SECRET`
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

1. Kontrollér igen, at de tre Google-variabler og `INTERNAL_API_SECRET` er aktiveret for **Production**.
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
```

`.env.local` og servicekontoens JSON-nøgle er ignoreret lokalt og må aldrig committes. Genstart `npm run dev`, når variablerne ændres.
