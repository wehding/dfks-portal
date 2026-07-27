# OMDb-opsætning til IMDb-resolveren

Resolveren bruger først DFI, TMDb og Wikidata. OMDb bruges kun som server-side fallback, især til konkrete serieafsnit. Uden en OMDb-nøgle virker de øvrige kilder fortsat, mens OMDb-opslag markeres som ikke konfigureret.

## Hent nøglen

1. Åbn [OMDb API Key](https://www.omdbapi.com/apikey.aspx).
2. Vælg den kontotype, som passer til DFKS' brug. Den gratis nøgle har en oplyst grænse på 1.000 kald pr. dag.
3. Angiv DFKS-portalen som anvendelse, og aktivér nøglen fra den modtagne e-mail.
4. Kontrollér før aktivering, at brugen fortsat er foreningsintern og kompatibel med OMDb's CC BY-NC 4.0-vilkår.

## Lokal udvikling

Tilføj følgende i repositoryets eksisterende `.env.local`:

```dotenv
OMDB_API_KEY=indsæt_nøglen_her
```

Variablen må ikke have `NEXT_PUBLIC_`-prefix. `.env.local`, API-nøglen og komplette OMDb-svar må ikke committes eller logges. Genstart udviklingsserveren efter ændringen.

## Vercel

1. Åbn Vercel-projektet `dfks-portal`.
2. Gå til **Settings → Environment Variables**.
3. Opret `OMDB_API_KEY`, indsæt nøglen og markér den som **Sensitive**.
4. Aktivér den for **Preview** og **Production**.
5. Gem variablen og lav en ny deployment; allerede byggede deployments får ikke den nye variabel automatisk.

Test først Preview med få værker. Kør derefter serien “Velkommen til frontlinjen” og afsnit S01E01 gennem **Opsætning → IMDb-kontrol**, før en større scanning startes.
