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

type WikidataSearchResponse = {
  search?: Array<{ id?: string; label?: string; description?: string; aliases?: string[] }>;
};

export async function searchWikidataPeople(name: string) {
  try {
    const res = await wikidataFetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=da&uselang=da&type=item&limit=12&search=${encodeURIComponent(name)}`);
    if (!res.ok) return [];
    const data = await res.json() as WikidataSearchResponse;
    return (data.search ?? [])
      .filter(item => item.id && /^Q\d+$/.test(item.id) && item.label)
      .map(item => ({ qid: item.id!, name: item.label!, description: item.description ?? null, aliases: item.aliases ?? [] }));
  } catch {
    return [];
  }
}

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

function parseReleaseYear(value: string | null) {
  if (typeof value !== "string") return null;
  const year = Number.parseInt(value.substring(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function durationToMinutes(value: string | null, unit: string | null) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (unit?.endsWith("/Q11574")) return Math.round(amount / 60);
  return Math.round(amount);
}

async function findItemByTitleAndYear(title: string, year?: number | null) {
  const searchRes = await wikidataFetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=da&uselang=da&type=item&search=${encodeURIComponent(title)}`);
  if (!searchRes.ok) return null;

  const searchData = await searchRes.json() as WikidataSearchResponse;
  const ids = (searchData.search ?? [])
    .map(item => item.id)
    .filter((id): id is string => typeof id === "string" && /^Q\d+$/.test(id))
    .slice(0, 8);

  if (ids.length === 0) return null;
  if (!year) return ids[0];

  const values = ids.map(id => `wd:${id}`).join(" ");
  const query = `
    SELECT ?item ?releaseDate WHERE {
      VALUES ?item { ${values} }
      OPTIONAL { ?item wdt:P577 ?releaseDate. }
    }
  `;
  const res = await wikidataFetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`);
  if (!res.ok) return ids[0];

  const data = await res.json() as SparqlResponse;
  const bindings = data.results?.bindings ?? [];
  const exactYear = bindings.find(binding => parseReleaseYear(binding.releaseDate?.value ?? null) === year);
  const item = exactYear?.item?.value ?? bindings[0]?.item?.value;
  return typeof item === "string" ? item.split("/").pop() ?? ids[0] : ids[0];
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

    if (!itemId && input.title) itemId = await findItemByTitleAndYear(input.title, input.year);

    if (!itemId) return empty;

    const query = `
      SELECT ?imdb ?originalTitle ?directorLabel ?genreLabel ?duration ?durationUnit ?releaseDate WHERE {
        wd:${itemId} rdfs:label ?label.
        FILTER(LANG(?label) IN ("da", "en")).
        OPTIONAL { wd:${itemId} wdt:P345 ?imdb. }
        OPTIONAL { wd:${itemId} wdt:P1476 ?originalTitle. }
        OPTIONAL { wd:${itemId} wdt:P57 ?director. }
        OPTIONAL { wd:${itemId} wdt:P136 ?genre. }
        OPTIONAL {
          wd:${itemId} p:P2047 ?durationStatement.
          ?durationStatement psv:P2047 ?durationValue.
          ?durationValue wikibase:quantityAmount ?duration.
          ?durationValue wikibase:quantityUnit ?durationUnit.
        }
        OPTIONAL { wd:${itemId} wdt:P577 ?releaseDate. }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "da,en". }
      }
      LIMIT 1
    `;
    const res = await wikidataFetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`);
    if (!res.ok) return { ...empty, wikidata_id: itemId };
    const data = await res.json() as SparqlResponse;
    const releaseDate = firstBindingValue(data, "releaseDate");
    const releaseYear = parseReleaseYear(releaseDate);
    const durationMinutes = durationToMinutes(firstBindingValue(data, "duration"), firstBindingValue(data, "durationUnit"));

    return {
      wikidata_id: itemId,
      imdb_id: firstBindingValue(data, "imdb") ?? input.imdbId ?? null,
      original_title: firstBindingValue(data, "originalTitle"),
      director: firstBindingValue(data, "directorLabel"),
      genre: firstBindingValue(data, "genreLabel"),
      duration_minutes: durationMinutes,
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
