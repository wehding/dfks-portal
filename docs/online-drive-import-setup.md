# Google Drive-import

Portalen bruger to adskilte OAuth-klienter med samme skrivebeskyttede scope:

- **Organisation/admin:** en intern Google Workspace-app, der forbindes til en særlig arbejdskonto med adgang til den valgte importmappe.
- **Medlem:** en ekstern app, hvor hvert medlem forbinder sit eget Google Drive og vælger konkrete filer.

OneDrive og Dropbox er ikke brugeraktiveret i denne version. Hjælpekode til en senere udvidelse findes fortsat, men ingen knapper eller autorisationsruter giver adgang til dem.

## Servervariabler

Følgende skal stå i `.env.local` ved lokal udvikling og som Sensitive Environment Variables i Vercel:

```text
INTEGRATION_ENCRYPTION_KEY=<mindst 32 tilfældige bytes>
GOOGLE_DRIVE_ADMIN_CLIENT_ID=<client-id fra dfks-portal-drive-admin>
GOOGLE_DRIVE_ADMIN_CLIENT_SECRET=<client-secret fra dfks-portal-drive-admin>
GOOGLE_DRIVE_MEMBER_CLIENT_ID=<client-id fra dfks-portal-drive-medlemmer>
GOOGLE_DRIVE_MEMBER_CLIENT_SECRET=<client-secret fra dfks-portal-drive-medlemmer>
INTERNAL_API_SECRET=<eksisterende intern arbejdskø-secret>
NEXT_PUBLIC_SITE_URL=https://dfks-portal-hazel.vercel.app
```

Client secrets og krypteringsnøglen må aldrig have `NEXT_PUBLIC_`-prefix. De må ikke committes, logges eller sendes til browseren. Skiftes `INTEGRATION_ENCRYPTION_KEY`, skal alle drevkonti forbindes igen.

## Fælles Google-indstillinger

I begge Google Cloud-projekter:

1. Aktivér **Google Drive API**.
2. Åbn **Google Auth Platform → Data Access**.
3. Tilføj kun `https://www.googleapis.com/auth/drive.readonly`.
4. Opret en **OAuth client ID → Web application**.
5. Tilføj disse redirect URI'er:
   - `http://localhost:3000/api/admin/import-connections/google_drive/callback`
   - `https://dfks-portal-hazel.vercel.app/api/admin/import-connections/google_drive/callback`
6. Når portalen får eget domæne, tilføjes den samme callback-sti på det nye domæne, før `NEXT_PUBLIC_SITE_URL` ændres. Den gamle URI beholdes under overgangen.

## Adminprojektet

I `dfks-portal-drive-admin` sættes **Audience** til **Internal**. Brug en særskilt Workspace-konto til importen og giv den kun adgang til de mapper, DFKS vil importere fra. Client ID og secret gemmes i variablerne med `ADMIN` i navnet.

Under **Opsætning → Organisation → Importforbindelser** forbinder en admin kontoen, vælger mappen visuelt og starter selv synkroniseringen. Der er ingen tidsplan eller cron. Når kørslen først er startet, fortsætter den server-side i genoptagelige bidder, også når browseren lukkes.

## Medlemsprojektet

I `dfks-portal-drive-medlemmer`:

1. Udfyld **Branding** med appnavn, supportmail og kontaktmail.
2. Vælg **Audience → External**.
3. Behold appen i **Testing**, mens opsætningen afprøves.
4. Tilføj de Google-konti, der skal teste, under **Test users**.
5. Opret webklienten og gem Client ID/secret i variablerne med `MEMBER` i navnet.

Medlemmer forbinder kontoen under **Min profil → Online-drev** eller fra **Mine kontrakter → Upload kontrakt**. Portalen viser mapper og filer sidevis; den scanner ikke hele drevet. Kun markerede PDF-, DOC- og DOCX-filer sættes i baggrundskø.

## Sikkerhed og drift

- OAuth-state kan kun bruges én gang, udløber efter ti minutter og er bundet til den indloggede bruger.
- Refresh tokens krypteres med AES-256-GCM i serverdatabasen.
- Drev-, kø- og token-tabeller er lukket for `anon` og `authenticated`; kun service role har direkte adgang.
- Filer valideres igen på serveren, har en grænse på 25 MB og går gennem den eksisterende dubletkontrol.
- Afbrydelse forsøger først at tilbagekalde Google-tokenet og fjerner derefter den krypterede forbindelse lokalt.
- En udløbet eller tilbagekaldt forbindelse markeres til ny godkendelse uden at vise tokens eller Google-fejldetaljer.
