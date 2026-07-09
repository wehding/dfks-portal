"use server";

type WikidataEnrichment = {
  wikidata_id: string | null;
  imdb_id: string | null;
  original_title: string | null;
  director: string | null;
  genre: string | null;
  duration_minutes: number | null;
  release_year: number | null;
};

const USER_AGENT = "DFKS-portal/1.0 (https://dfks-portal.vercel.app; kontakt@dfks.dk)";

type SparqlBindingValue = { value?: string };
type SparqlResponse = {
  results?: {
    bindings?: Array<Record<string, SparqlBindingValue>>;
  };
};

async function wikidataFetch(url: string) {
  return fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    cache: "force-cache",
    next: { revalidate: 60 * 60 * 24 },
  });
}

function firstBindingValue(data: SparqlResponse, key: string) {
  return data?.results?.bindings?.[0]?.[key]?.value ?? null;
}

export async function imdbFromWikidataByTmdb(tmdbId: number, mediaType: string) {
  const prop = mediaType === "tv" ? "P4983" : "P4947";
  const query = `
    SELECT ?imdb WHERE {
      ?item wdt:${prop} "${tmdbId}".
      OPTIONAL { ?item wdt:P345 ?imdb. }
    }
    LIMIT 1
  `;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  try {
    const res = await wikidataFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return firstBindingValue(data, "imdb");
  } catch {
    return null;
  }
}

export async function enrichFromWikidata(input: { imdbId?: string | null; title?: string | null; year?: number | null }) {
  const empty: WikidataEnrichment = {
    wikidata_id: null,
    imdb_id: input.imdbId ?? null,
    original_title: null,
    director: null,
    genre: null,
    duration_minutes: null,
    release_year: null,
  };

  try {
    let itemId: string | null = null;
    if (input.imdbId) {
      const query = `SELECT ?item WHERE { ?item wdt:P345 "${input.imdbId}". } LIMIT 1`;
      const res = await wikidataFetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        const item = firstBindingValue(data, "item");
        itemId = typeof item === "string" ? item.split("/").pop() ?? null : null;
      }
    }

    if (!itemId && input.title) {
      const res = await wikidataFetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=da&uselang=da&type=item&search=${encodeURIComponent(input.title)}`);
      if (res.ok) {
        const data = await res.json();
        itemId = data?.search?.[0]?.id ?? null;
      }
    }

    if (!itemId) return empty;

    const query = `
      SELECT ?imdb ?originalTitle ?directorLabel ?genreLabel ?duration ?releaseDate WHERE {
        wd:${itemId} rdfs:label ?label.
        FILTER(LANG(?label) IN ("da", "en")).
        OPTIONAL { wd:${itemId} wdt:P345 ?imdb. }
        OPTIONAL { wd:${itemId} wdt:P1476 ?originalTitle. }
        OPTIONAL { wd:${itemId} wdt:P57 ?director. }
        OPTIONAL { wd:${itemId} wdt:P136 ?genre. }
        OPTIONAL { wd:${itemId} wdt:P2047 ?duration. }
        OPTIONAL { wd:${itemId} wdt:P577 ?releaseDate. }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "da,en". }
      }
      LIMIT 1
    `;
    const res = await wikidataFetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`);
    if (!res.ok) return { ...empty, wikidata_id: itemId };
    const data = await res.json();
    const releaseDate = firstBindingValue(data, "releaseDate");
    const releaseYear = typeof releaseDate === "string" ? Number.parseInt(releaseDate.substring(0, 4), 10) : null;
    const duration = Number(firstBindingValue(data, "duration"));

    return {
      wikidata_id: itemId,
      imdb_id: firstBindingValue(data, "imdb") ?? input.imdbId ?? null,
      original_title: firstBindingValue(data, "originalTitle"),
      director: firstBindingValue(data, "directorLabel"),
      genre: firstBindingValue(data, "genreLabel"),
      duration_minutes: Number.isFinite(duration) ? Math.round(duration / 60) : null,
      release_year: Number.isFinite(releaseYear) ? releaseYear : null,
    };
  } catch (error) {
    console.error("Wikidata enrichment error:", error);
    return empty;
  }
}

export async function resolveImdbId(input: {
  tmdbId?: number | null;
  mediaType?: string | null;
  imdbId?: string | null;
  title?: string | null;
  year?: number | null;
}) {
  if (input.imdbId) return input.imdbId;
  if (input.tmdbId) {
    const viaTmdb = await imdbFromWikidataByTmdb(input.tmdbId, input.mediaType === "tv" ? "tv" : "movie");
    if (viaTmdb) return viaTmdb;
  }
  const enriched = await enrichFromWikidata({ imdbId: null, title: input.title, year: input.year });
  return enriched.imdb_id;
}
