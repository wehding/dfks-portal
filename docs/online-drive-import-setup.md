# Opsæt online-drev til filimport

Portalen understøtter organisationsafgrænsede, skrivebeskyttede forbindelser til Google Drive, Microsoft OneDrive og Dropbox. OAuth-tokens krypteres server-side og må aldrig gemmes i Git.

## Fælles miljøvariabler

Tilføj disse server-only variabler i `.env.local` og i Vercel for de miljøer, hvor forbindelserne skal virke:

```text
INTEGRATION_ENCRYPTION_KEY=<mindst 32 tilfældige bytes>
IMPORT_OAUTH_STATE_SECRET=<mindst 32 tilfældige bytes>
```

De må ikke have `NEXT_PUBLIC_`-prefix. En ændring af `INTEGRATION_ENCRYPTION_KEY` gør eksisterende forbindelser ulæselige og kræver, at kontiene forbindes igen.

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

Portalen anmoder kun om `https://www.googleapis.com/auth/drive.readonly`.

## Microsoft OneDrive

Opret en app registration i Microsoft Entra ID og tilføj callback-adressen:

```text
https://<portalens-domæne>/api/admin/import-connections/onedrive/callback
```

Tilføj:

```text
MICROSOFT_GRAPH_CLIENT_ID=...
MICROSOFT_GRAPH_CLIENT_SECRET=...
MICROSOFT_GRAPH_TENANT_ID=organizations
```

De delegerede scopes er `Files.Read`, `User.Read` og `offline_access`.

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

Opret variablerne under **Project → Settings → Environment Variables** for både Preview og Production, markér hemmeligheder som Sensitive, og lav en ny deployment. Callback-adresserne skal registreres særskilt for preview-domæner, hvis OAuth også skal testes i Preview.

Når en konto er forbundet, oprettes importmapper under **Opsætning → Organisation → Importforbindelser**. Google Drive og OneDrive bruger mappens ID fra URL'en; Dropbox bruger stien, fx `/Kontrakter`.

Automatisk tidsplan er ikke aktiveret af denne ændring. Den kræver en særskilt driftsbeslutning om frekvens og belastning. Indtil da bruges knappen **Synkroniser**; hver kørsel tager næste bid på op til 20 nye filer.
