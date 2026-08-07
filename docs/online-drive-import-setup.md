# Opsæt online-drev til filimport

Portalen understøtter både organisationsforbindelser under Opsætning og personlige forbindelser under Min profil. Alle forbindelser er skrivebeskyttede. OAuth-tokens krypteres server-side og må aldrig gemmes i Git, browserkode eller logs.

## Fælles miljøvariabler

Tilføj disse server-only variabler i `.env.local` og i Vercel for de miljøer, hvor forbindelserne skal virke:

```text
INTEGRATION_ENCRYPTION_KEY=<mindst 32 tilfældige bytes>
```

Variablen må ikke have `NEXT_PUBLIC_`-prefix. En ændring af `INTEGRATION_ENCRYPTION_KEY` gør eksisterende forbindelser ulæselige og kræver, at kontiene forbindes igen. OAuth-state er one-time og gemmes som en hash i databasen; der bruges derfor ikke længere en separat state-secret.

## Google Drive

Opret en OAuth 2.0 Web application i Google Cloud og aktivér Google Drive API. Tilføj callback-adressen:

```text
https://<portalens-domæne>/api/admin/import-connections/google_drive/callback
```

Tilføj derefter:

```text
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
```

Portalen anmoder kun om `https://www.googleapis.com/auth/drive.readonly`. Google klassificerer dette som et restricted scope. OAuth consent screen skal derfor være korrekt udfyldt, og en offentlig produktion kan kræve Googles app-verifikation. Brugeren vælger selv de kontraktfiler, der importeres; portalen ændrer aldrig filer på drevet.

## Microsoft OneDrive

Opret en app registration i Microsoft Entra ID og tilføj callback-adressen:

```text
https://<portalens-domæne>/api/admin/import-connections/onedrive/callback
```

Tilføj:

```text
MICROSOFT_GRAPH_CLIENT_ID=...
MICROSOFT_GRAPH_CLIENT_SECRET=...
MICROSOFT_GRAPH_TENANT_ID=common
```

De delegerede scopes er `Files.Read`, `User.Read` og `offline_access`. Brug `common`, når både private Microsoft-konti og arbejds-/skolekonti skal kunne forbindes. Brug organisationens tenant-id i stedet, hvis kun jeres egen Microsoft-tenant må logge ind.

## Dropbox

Opret en scoped Dropbox-app med read-only filadgang og callback-adressen:

```text
https://<portalens-domæne>/api/admin/import-connections/dropbox/callback
```

Tilføj:

```text
DROPBOX_APP_KEY=...
DROPBOX_APP_SECRET=...
```

Scopes er `account_info.read`, `files.metadata.read` og `files.content.read`.

## Vercel

Opret variablerne under **Project → Settings → Environment Variables** for både Preview og Production, markér hemmeligheder som Sensitive, og lav en ny deployment. Brug ikke Vercels skiftende deployment-URL som callback. Tilføj i stedet projektets stabile domæne og eventuelt et fast preview-/stagingdomæne hos alle tre udbydere.

Når portalen senere flyttes til eget domæne, tilføjes de tre callback-adresser med det nye domæne hos Google, Microsoft og Dropbox, før `NEXT_PUBLIC_SITE_URL` ændres og Vercel redeployes. Behold de gamle callback-adresser under overgangen; klient-id og klient-secret behøver normalt ikke at blive ændret.

Når en konto er forbundet, oprettes importmapper under **Opsætning → Organisation → Importforbindelser**. Google Drive og OneDrive bruger mappens ID fra URL'en; Dropbox bruger stien, fx `/Kontrakter`.

Automatisk tidsplan er ikke aktiveret af denne ændring. Den kræver en særskilt driftsbeslutning om frekvens og belastning. Indtil da bruges knappen **Synkroniser**; hver kørsel tager næste bid på op til 20 nye filer.

## Personlige forbindelser

Medlemmer forbinder og fjerner konti under **Min profil → Online-drev**. Under **Mine kontrakter → Upload kontrakt** kan medlemmet åbne en forbundet konto, markere PDF-/Word-filer og sende dem til den eksisterende dubletkontrol og analysekø. Admin kan ikke browse medlemsforbindelser, og medlemmet kan ikke oprette automatiske synkroniseringsmapper.
