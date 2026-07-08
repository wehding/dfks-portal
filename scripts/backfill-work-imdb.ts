/**
 * scripts/backfill-work-imdb.ts
 *
 * Udfylder imdb_id på alle works der mangler det — hvis muligt.
 * Rækkefølge pr. værk:
 *   1. Har tmdb_id  → TMDB /external_ids
 *   2. Intet tmdb_id → TMDB titel/år-søgning → external_ids
 *   3. Fallback     → Wikidata (CC0) via tmdb_id
 *
 * imdb_id hentes udelukkende via TMDB + Wikidata — IMDb's egne datasæt/API
 * er kun ikke-kommercielle og bruges IKKE.
 *
 * Kør: npx tsx scripts/backfill-work-imdb.ts [--dry]
 * Kræver env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TMDB_API_KEY
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import { createClient } from "@supabase/supabase-js";

const envPath = ".env.local";
dotenv.config({ path: fs.existsSync(envPath) ? envPath : ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const DRY = process.argv.includes("--dry");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Mangler NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!TMDB_API_KEY) {
  console.error("Mangler TMDB_API_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

type JsonObject = Record<string, unknown>;
type TmdbSearchResult = {
  id?: number;
  release_date?: string;
  first_air_date?: string;
};
type WikidataResponse = {
  results?: {
    bindings?: Array<{
      imdb?: { value?: string };
    }>;
  };
};

function tmdbUrl(path: string): { url: string; headers: Record<string, string> } {
  const isV3 = TMDB_API_KEY!.length === 32;
  const sep = path.includes("?") ? "&" : "?";
  const url = isV3
    ? `https://api.themoviedb.org/3${path}${sep}api_key=${TMDB_API_KEY}`
    : `https://api.themoviedb.org/3${path}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (!isV3) headers.Authorization = `Bearer ${TMDB_API_KEY}`;
  return { url, headers };
}

async function tmdbGet(path: string): Promise<unknown | null> {
  const { url, headers } = tmdbUrl(path);
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function externalIds(tmdbId: number, mediaType: string): Promise<string | null> {
  const data = await tmdbGet(`/${mediaType === "tv" ? "tv" : "movie"}/${tmdbId}/external_ids`) as JsonObject | null;
  const v = data?.imdb_id;
  return typeof v === "string" && v.startsWith("tt") ? v : null;
}

async function findTmdb(title: string, year: number | null): Promise<{ tmdb_id: number; media_type: string } | null> {
  const q = encodeURIComponent(title.trim());
  const [mv, tv] = await Promise.all([
    tmdbGet(`/search/movie?query=${q}${year ? `&year=${year}` : ""}`),
    tmdbGet(`/search/tv?query=${q}${year ? `&first_air_date_year=${year}` : ""}`),
  ]);
  const cand: { tmdb_id: number; media_type: string; date: string }[] = [];
  const movieResults = ((mv as JsonObject | null)?.results ?? []) as TmdbSearchResult[];
  const tvResults = ((tv as JsonObject | null)?.results ?? []) as TmdbSearchResult[];
  for (const r of movieResults) if (typeof r.id === "number") cand.push({ tmdb_id: r.id, media_type: "movie", date: r.release_date ?? "" });
  for (const r of tvResults) if (typeof r.id === "number") cand.push({ tmdb_id: r.id, media_type: "tv", date: r.first_air_date ?? "" });
  if (!cand.length) return null;
  if (year) {
    const exact = cand.find(c => c.date.startsWith(String(year)));
    if (exact) return { tmdb_id: exact.tmdb_id, media_type: exact.media_type };
  }
  return { tmdb_id: cand[0].tmdb_id, media_type: cand[0].media_type };
}

async function wikidataImdb(tmdbId: number, mediaType: string): Promise<string | null> {
  const prop = mediaType === "tv" ? "P4983" : "P4947";
  const sparql = `SELECT ?imdb WHERE { ?item wdt:${prop} "${tmdbId}". ?item wdt:P345 ?imdb. } LIMIT 1`;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": "DFKS-Kontraktportal/1.0 (dfks.dk)" },
    });
    if (!res.ok) return null;
    const data = await res.json() as WikidataResponse;
    const v = data?.results?.bindings?.[0]?.imdb?.value;
    return typeof v === "string" && v.startsWith("tt") ? v : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const { data: works, error } = await db
    .from("works")
    .select("id, title, year, type, tmdb_id, imdb_id")
    .is("imdb_id", null);

  if (error) {
    console.error("Kunne ikke hente works:", error.message);
    process.exit(1);
  }

  console.log(`${works?.length ?? 0} værker uden imdb_id${DRY ? " (dry-run)" : ""}`);
  let filled = 0, skipped = 0;

  for (const w of works ?? []) {
    const isSeries = w.type === "tv-serie" || w.type === "dokumentar-serie";
    let tmdbId: number | null = w.tmdb_id ?? null;
    let mediaType: string | null = isSeries ? "tv" : null;

    if (!tmdbId) {
      const match = await findTmdb(w.title, w.year);
      if (match) { tmdbId = match.tmdb_id; mediaType = match.media_type; }
      await sleep(120);
    }

    if (!tmdbId) { skipped++; continue; }

    let imdb: string | null = null;
    if (mediaType) imdb = await externalIds(tmdbId, mediaType);
    if (!imdb) imdb = await externalIds(tmdbId, mediaType === "tv" ? "movie" : "tv");
    if (!imdb) imdb = await wikidataImdb(tmdbId, mediaType ?? "movie");

    if (!imdb) { skipped++; await sleep(120); continue; }

    if (DRY) {
      console.log(`[dry] ${w.title} → ${imdb}`);
    } else {
      const updates: Record<string, unknown> = { imdb_id: imdb };
      if (!w.tmdb_id && tmdbId) updates.tmdb_id = tmdbId;
      const { error: upErr } = await db.from("works").update(updates).eq("id", w.id);
      if (upErr) { console.error(`Fejl ved ${w.title}:`, upErr.message); skipped++; continue; }
      console.log(`✓ ${w.title} → ${imdb}`);
    }
    filled++;
    await sleep(120);
  }

  console.log(`Færdig. Udfyldt: ${filled}, sprunget over: ${skipped}`);
}

main().catch(err => { console.error(err); process.exit(1); });
