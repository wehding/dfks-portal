import { getTMDBExternalIds } from "@/app/actions/tmdb";

// Wikidata-property for IMDb-id
const P_IMDB = "P345";
// TMDB-id-properties: film = P4947, TV-serie = P4983
const P_TMDB_MOVIE = "P4947";
const P_TMDB_TV = "P4983";

// Slå imdb_id op i Wikidata ud fra et TMDB-id. Wikidata er CC0 og gratis at bruge,
// også kommercielt — modsat IMDb's egne datasæt. Fallback når TMDB ikke selv har imdb_id.
export async function imdbFromWikidataByTmdb(
  tmdbId: number,
  mediaType: string
): Promise<string | null> {
  const tmdbProp = mediaType === "tv" ? P_TMDB_TV : P_TMDB_MOVIE;
  const sparql = `SELECT ?imdb WHERE { ?item wdt:${tmdbProp} "${tmdbId}". ?item wdt:${P_IMDB} ?imdb. } LIMIT 1`;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/sparql-results+json",
        // Wikidata kræver en beskrivende User-Agent
        "User-Agent": "DFKS-Kontraktportal/1.0 (dfks.dk)",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const value = data?.results?.bindings?.[0]?.imdb?.value;
    return typeof value === "string" && value.startsWith("tt") ? value : null;
  } catch (err) {
    console.error("Wikidata imdb lookup error:", err);
    return null;
  }
}

// Samlet imdb_id-resolver: prøv TMDB /external_ids først (mest præcist), derefter
// Wikidata som fallback. Returnerer null hvis intet id kan findes.
export async function resolveImdbId(params: {
  tmdbId: number | null;
  mediaType: string | null;
}): Promise<string | null> {
  const { tmdbId, mediaType } = params;
  if (!tmdbId) return null;

  // TMDB kender ofte imdb_id direkte
  if (mediaType) {
    const ext = await getTMDBExternalIds(tmdbId, mediaType);
    if (ext.imdb_id) return ext.imdb_id;
  } else {
    // Ukendt medietype — prøv begge
    for (const mt of ["movie", "tv"]) {
      const ext = await getTMDBExternalIds(tmdbId, mt);
      if (ext.imdb_id) return ext.imdb_id;
    }
  }

  // Fallback: Wikidata
  if (mediaType) return imdbFromWikidataByTmdb(tmdbId, mediaType);
  for (const mt of ["movie", "tv"]) {
    const imdb = await imdbFromWikidataByTmdb(tmdbId, mt);
    if (imdb) return imdb;
  }
  return null;
}
