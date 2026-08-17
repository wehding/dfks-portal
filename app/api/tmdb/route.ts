import { NextRequest, NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/api-auth";
import { consumeRateLimit } from "@/lib/server/rate-limit";

// GET /api/tmdb?q=<query>&type=search|person|details&id=<tmdb_id>&media=movie|tv
export async function GET(req: NextRequest) {
  const auth = await requireSessionApi();
  if (!auth.ok) return auth.response;
  const { searchParams } = req.nextUrl;
  const query = searchParams.get("q");
  const type = searchParams.get("type") || "search";
  const id = searchParams.get("id");
  const media = searchParams.get("media") || "movie";
  if (query && (query.trim().length < 2 || query.length > 120)) {
    return NextResponse.json({ error: "Søgeteksten skal være mellem 2 og 120 tegn" }, { status: 400 });
  }
  if (!new Set(["search", "person", "details"]).has(type) || !new Set(["movie", "tv"]).has(media)) {
    return NextResponse.json({ error: "Ugyldige parametre" }, { status: 400 });
  }
  if (id && !/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "Ugyldigt TMDB-id" }, { status: 400 });
  const rateLimit = await consumeRateLimit({ bucket: "tmdb-lookup", identifier: auth.userId, limit: 120, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return NextResponse.json({ error: "For mange opslag. Prøv igen senere." }, { status: 429 });

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "TMDB_API_KEY mangler" }, { status: 500 });
  }

  const isV3 = apiKey.length === 32;
  const headers: Record<string, string> = { accept: "application/json" };
  if (!isV3) headers.Authorization = `Bearer ${apiKey}`;

  function buildUrl(path: string) {
    const sep = path.includes("?") ? "&" : "?";
    return isV3
      ? `https://api.themoviedb.org/3${path}${sep}api_key=${apiKey}`
      : `https://api.themoviedb.org/3${path}`;
  }

  try {
    let endpoint = "";
    if (type === "search" && query) {
      endpoint = `/search/multi?query=${encodeURIComponent(query)}&language=da-DK`;
    } else if (type === "person" && query) {
      endpoint = `/search/person?query=${encodeURIComponent(query)}&language=da-DK`;
    } else if (type === "details" && id) {
      endpoint = `/${media === "tv" ? "tv" : "movie"}/${id}?language=da-DK`;
    } else {
      return NextResponse.json({ error: "Ugyldige parametre" }, { status: 400 });
    }

    const res = await fetch(buildUrl(endpoint), { headers });
    if (!res.ok) {
      console.error("[tmdb] provider failed", res.status);
      return NextResponse.json({ error: "TMDB-opslaget fejlede" }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error("[tmdb] lookup failed", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "TMDB-opslaget fejlede" }, { status: 502 });
  }
}
