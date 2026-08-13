# Besked til Martin — Vercel og Google Drive

Google Drive-funktionen bruger nu to forskellige OAuth-klienter: én til DFKS' adminimport og én til medlemmernes personlige drev. Værdierne skal kopieres direkte fra Google Cloud til Vercel og må ikke sendes i mail/chat eller lægges i Git.

## 1. Åbn projektets miljøvariabler

1. Log ind på Vercel.
2. Vælg teamet **martin-wehdings-projects**.
3. Åbn projektet **dfks-portal**.
4. Gå til **Settings → Environment Variables**.

## 2. Tilføj de fem Google Drive-variable

Opret én variabel ad gangen, markér hver hemmelig værdi som **Sensitive**, og aktivér den for både **Preview** og **Production**:

- `INTEGRATION_ENCRYPTION_KEY` — den eksisterende krypteringsnøgle. Hvis den allerede findes, må værdien ikke ændres.
- `GOOGLE_DRIVE_ADMIN_CLIENT_ID` — Client ID fra webklienten i `dfks-portal-drive-admin`.
- `GOOGLE_DRIVE_ADMIN_CLIENT_SECRET` — Client secret fra samme admin-webklient.
- `GOOGLE_DRIVE_MEMBER_CLIENT_ID` — Client ID fra webklienten i `dfks-portal-drive-medlemmer`.
- `GOOGLE_DRIVE_MEMBER_CLIENT_SECRET` — Client secret fra samme medlems-webklient.

De gamle `GOOGLE_DRIVE_CLIENT_ID` og `GOOGLE_DRIVE_CLIENT_SECRET` bruges ikke længere og kan fjernes efter en vellykket test.

## 3. Kontrollér baggrundskøen

Kontrollér, at disse allerede findes for både Preview og Production:

- `DRIVE_IMPORT_JOB_SECRET` (unik nøgle, som ikke genbruges til andre jobs)
- `NEXT_PUBLIC_SITE_URL` med værdien `https://dfks-portal-hazel.vercel.app`
- projektets eksisterende Supabase URL, anon key og service-role key

Ingen Client secret, service-role key eller krypteringsnøgle må have `NEXT_PUBLIC_` foran navnet.

## 4. Lav en ny deployment

1. Åbn **Deployments** i Vercel.
2. Åbn den nyeste deployment af den relevante featurebranch/PR.
3. Tryk på menuen **…** øverst til højre.
4. Vælg **Redeploy**.
5. Fjern eventuelt **Use existing Build Cache**.
6. Bekræft **Redeploy**, og vent til status er **Ready**.

## 5. Test begge forbindelser

1. Som admin: gå til **Opsætning → Organisation → Importforbindelser**, forbind admin-Google-kontoen, vælg en mappe og start manuel import.
2. Kontrollér, at importen fortsætter, hvis siden forlades, og at samme fil ikke importeres igen.
3. Som testmedlem: gå til **Min profil → Online-drev**, forbind Google Drive, og vælg derefter enkelte testfiler via **Mine kontrakter → Upload kontrakt**.
4. Afbryd forbindelsen igen og kontrollér, at allerede importerede kontrakter bevares.

Hvis deployment eller forbindelse fejler, send kun den første røde fejllinje og navnet på den manglende variabel. Send aldrig værdien af en secret.
