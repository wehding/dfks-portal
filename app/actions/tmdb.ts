"use server";

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
    const data = await res.json();
    return (data.results || []).filter(
      (item: any) => item.media_type === "movie" || item.media_type === "tv"
    );
  } catch (err) {
    console.error("TMDB search error:", err);
    return [];
  }
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
    let crew: any[] = [];
    if (creditsRes.ok) {
      const creditsData = await creditsRes.json();
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
  } catch (err: any) {
    return { success: false, error: err.message || "Kunne ikke hente detaljer fra TMDB" };
  }
}
