"use server";

type TMDBSearchItem = {
  id: number;
  title?: string;
  name?: string;
  media_type?: string;
  poster_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
};

type TMDBCrewMember = {
  job?: string;
  name?: string;
};

type TMDBSearchResponse = {
  results?: TMDBSearchItem[];
};

type TMDBCreditsResponse = {
  crew?: TMDBCrewMember[];
};

function tmdbFetch(endpointPath: string) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error("TMDB_API_KEY mangler");

  const isV3 = apiKey.length === 32;
  const sep = endpointPath.includes("?") ? "&" : "?";
  const url = isV3
    ? `https://api.themoviedb.org/3${endpointPath}${sep}api_key=${apiKey}`
    : `https://api.themoviedb.org/3${endpointPath}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (!isV3) headers.Authorization = `Bearer ${apiKey}`;

  return fetch(url, { headers });
}

export async function searchTMDB(query: string) {
  if (!process.env.TMDB_API_KEY) return [];
  try {
    const res = await tmdbFetch(`/search/multi?query=${encodeURIComponent(query)}&language=da-DK`);
    if (!res.ok) throw new Error(`TMDB API status ${res.status}`);
    const data = await res.json() as TMDBSearchResponse;
    return (data.results || [])
      .filter(item => item.media_type === "movie" || item.media_type === "tv")
      .sort((a, b) => yearFromTmdbItem(b) - yearFromTmdbItem(a));
  } catch (err) {
    console.error("TMDB search error:", err);
    return [];
  }
}

function yearFromTmdbItem(item: TMDBSearchItem) {
  const date = item.release_date || item.first_air_date || "";
  const year = Number.parseInt(date.substring(0, 4), 10);
  return Number.isFinite(year) ? year : 0;
}

export async function searchTMDBPerson(name: string) {
  try {
    const res = await tmdbFetch(`/search/person?query=${encodeURIComponent(name)}&language=da-DK`);
    const data = await res.json();
    return { success: true, results: data.results || [] };
  } catch (err) {
    console.error("TMDB person search error:", err);
    return { success: false, error: "Kunne ikke søge i TMDB", results: [] };
  }
}

export async function getTMDBWorkDetails(tmdbId: number, mediaType: string) {
  const type = mediaType === "tv" ? "tv" : "movie";
  try {
    const [detailRes, creditsRes] = await Promise.all([
      tmdbFetch(`/${type}/${tmdbId}?language=da-DK`),
      tmdbFetch(`/${type}/${tmdbId}/credits?language=da-DK`),
    ]);

    if (!detailRes.ok) {
      return { success: false, error: `TMDB returnerede status ${detailRes.status}` };
    }

    const details = await detailRes.json();
    let crew: TMDBCrewMember[] = [];
    if (creditsRes.ok) {
      const creditsData = await creditsRes.json() as TMDBCreditsResponse;
      crew = creditsData.crew || [];
    }

    return {
      success: true,
      details: {
        ...details,
        directors: crew.filter((c) => c.job === "Director").map((c) => c.name),
        producers: crew.filter((c) => c.job === "Producer").map((c) => c.name),
        editors: crew.filter((c) => c.job === "Editor" || c.job === "Edit").map((c) => c.name),
      },
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Kunne ikke hente detaljer fra TMDB" };
  }
}

export async function findTMDBPoster(title: string, year?: number | null) {
  if (!process.env.TMDB_API_KEY || !title.trim()) return null;

  const encodedTitle = encodeURIComponent(title.trim());
  const movieYear = year ? `&year=${year}` : "";
  const tvYear = year ? `&first_air_date_year=${year}` : "";

  try {
    const [movieRes, tvRes] = await Promise.all([
      tmdbFetch(`/search/movie?query=${encodedTitle}${movieYear}&language=da-DK`).catch(() => null),
      tmdbFetch(`/search/tv?query=${encodedTitle}${tvYear}&language=da-DK`).catch(() => null),
    ]);

    const results: TMDBSearchItem[] = [];
    if (movieRes?.ok) {
      const data = await movieRes.json() as TMDBSearchResponse;
      results.push(...(data.results ?? []));
    }
    if (tvRes?.ok) {
      const data = await tvRes.json() as TMDBSearchResponse;
      results.push(...(data.results ?? []));
    }

    const withPoster = results.filter(item => item.poster_path);
    if (!withPoster.length) return null;
    if (!year) return withPoster[0].poster_path as string;

    const exactYear = withPoster.find(item => {
      const date = typeof item.release_date === "string" ? item.release_date : item.first_air_date;
      return typeof date === "string" && date.startsWith(String(year));
    });
    return (exactYear ?? withPoster[0]).poster_path as string;
  } catch (err) {
    console.error("TMDB poster lookup error:", err);
    return null;
  }
}
