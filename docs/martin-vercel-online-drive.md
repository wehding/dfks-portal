# Besked til Martin — Vercel og online-drev

Hej Martin

Jeg har implementeret skrivebeskyttede forbindelser til Google Drive, Microsoft OneDrive og Dropbox for både organisationen og det enkelte medlem. OAuth-tokens gemmes krypteret server-side og må ikke sendes i mail/chat eller lægges i Git.

## 1. Opret krypteringsnøglen

Generér værdien lokalt i Terminal (kommandoen viser én ny hemmelig værdi):

```bash
openssl rand -base64 48
```

Kopiér resultatet direkte til din password manager. Brug den samme værdi i Preview og Production, hvis de to miljøer bruger samme Supabase-database. Send ikke værdien tilbage i chat.

I Vercel: **martin-wehdings-projects → dfks-portal → Settings → Environment Variables → Add**:

- navn: `INTEGRATION_ENCRYPTION_KEY`
- værdi: resultatet fra kommandoen
- miljøer: `Preview` og `Production`
- markér `Sensitive`

Nøglen må ikke ændres efter konti er forbundet; ellers kan eksisterende OAuth-tokens ikke dekrypteres.

## 2. Google Drive

I Google Cloud-projektet:

1. Aktivér **Google Drive API**.
2. Åbn **APIs & Services → OAuth consent screen** og udfyld appnavn, supportmail, domæne og privacy policy.
3. Tilføj scopet `https://www.googleapis.com/auth/drive.readonly`.
4. Bemærk: Google klassificerer scopet som restricted; offentlig produktion kan kræve app-verifikation.
5. Gå til **Credentials → Create credentials → OAuth client ID → Web application**.
6. Tilføj redirect URI:
   `https://dfks-portal-hazel.vercel.app/api/admin/import-connections/google_drive/callback`
7. Kopiér Client ID og Client secret direkte til Vercel som Sensitive:
   - `GOOGLE_DRIVE_CLIENT_ID`
   - `GOOGLE_DRIVE_CLIENT_SECRET`

## 3. Microsoft OneDrive

I Microsoft Entra admin center:

1. Gå til **Identity → Applications → App registrations → New registration**.
2. Vælg kontotyper, der tillader både arbejds-/skolekonti og personlige Microsoft-konti.
3. Under **Authentication → Add a platform → Web** tilføjes:
   `https://dfks-portal-hazel.vercel.app/api/admin/import-connections/onedrive/callback`
4. Under **API permissions → Microsoft Graph → Delegated permissions** tilføjes `Files.Read`, `User.Read` og `offline_access`.
5. Under **Certificates & secrets → New client secret** kopieres **Value** med det samme.
6. Tilføj i Vercel som Sensitive:
   - `MICROSOFT_GRAPH_CLIENT_ID` = Application (client) ID
   - `MICROSOFT_GRAPH_CLIENT_SECRET` = secret Value (ikke Secret ID)
   - `MICROSOFT_GRAPH_TENANT_ID` = `common`

## 4. Dropbox

I Dropbox App Console:

1. Vælg **Create app → Scoped access → Full Dropbox**.
2. Under **Permissions** aktiveres kun `account_info.read`, `files.metadata.read` og `files.content.read`.
3. Under OAuth 2 tilføjes redirect URI:
   `https://dfks-portal-hazel.vercel.app/api/admin/import-connections/dropbox/callback`
4. Kopiér App key og App secret til Vercel som Sensitive:
   - `DROPBOX_APP_KEY`
   - `DROPBOX_APP_SECRET`

## 5. Kontrollér øvrige Vercel-variable

De eksisterende servervariable skal fortsat være sat for Preview og Production:

- `INTERNAL_API_SECRET`
- `NEXT_PUBLIC_SITE_URL=https://dfks-portal-hazel.vercel.app`
- Supabase URL, anon key og service-role key

Der bruges ikke `NEXT_PUBLIC_` på OAuth-client-secrets eller krypteringsnøglen.

## 6. Redeploy og test

1. Gå til **Deployments** i Vercel.
2. Åbn nyeste deployment fra featurebranchen/PR'en.
3. Vælg **⋯ → Redeploy** og slå eventuelt build-cache fra.
4. Når deploymentet er `Ready`, test én forbindelse fra **Min profil → Online-drev**.
5. Test derefter **Mine kontrakter → Upload kontrakt → Vælg fra online-drev** med en ufarlig test-PDF.
6. Kontrollér, at dubletter afvises, og at forbindelsen kan fjernes fra Min profil.

## Ved nyt domæne

Før `NEXT_PUBLIC_SITE_URL` ændres, tilføjes de samme tre callback-stier med det nye domæne hos Google, Microsoft og Dropbox. Behold de gamle callbacks under overgangen, deploy, test og fjern først de gamle efter en stabil overgang.
