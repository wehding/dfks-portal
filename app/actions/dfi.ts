"use server";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { findTMDBMatch, searchTMDBPerson, getTMDBPersonCombinedCredits, getTMDBExternalIds, getTMDBSeasonEpisodes, getTMDBWorkDetails } from "@/app/actions/tmdb";
import { enrichFromWikidata } from "@/app/actions/wikidata";
import { cleanDfiTitle, extractDfiDirectors, extractDfiPersonPortraitUrl, extractDfiPersonPortraitUrls, extractDfiPosterUrl, extractDfiPremiereYear, mapDfiWorkType, parseDfiEpisodeCount, parseDfiEpisodeTitleInfo, parseSeasonNumberFromTitle, type DfiMetadata } from "@/lib/dfi-metadata";
import { errorMessage, logInfo, logWarn } from "@/lib/server-log";
import { buildCompleteEpisodeOptions, parseLocalEpisodeCode } from "@/lib/series-episodes";

// DFI org_id bruges ved import — DFKS default
import { requireOrgId } from "@/lib/org";
const MAX_DFI_POSTER_BYTES = 2 * 1024 * 1024;

type DfiCredit = {
  Id?: number | string | null;
  Title?: string | null;
  DanishTitle?: string | null;
  OriginalTitle?: string | null;
  ProductionYear?: number | null;
  ReleaseYear?: number | null;
  Year?: number | null;
  Description?: string | null;
  Type?: string | null;
  Category?: string | null;
  Parent?: { Id?: number | string | null } | null;
  Children?: DfiCredit[] | null;
  __episode_options?: Array<{ number: number; title: string }>;
  __selected_episodes?: number[] | null;
  __season_number?: number | null;
};

type EpisodeParentWork = {
  id: string;
  org_id: string;
  title: string;
  type: string;
  year: number | null;
  duration_minutes: number | null;
  season_count?: number | null;
  episode_count?: number | null;
  genre?: string | null;
  director?: string | null;
  description?: string | null;
  poster_url?: string | null;
  status: string;
  dfi_id?: string | null;
  tmdb_id?: number | null;
  imdb_id?: string | null;
  wikidata_id?: string | null;
};

type DfiSearchScore = {
  film: DfiCredit;
  score: number;
};

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|en|et|den|det)\b/g, " ")
    .replace(/[^a-z0-9æøå\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metadataTextList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(new Set(values.flatMap(item => {
    if (typeof item === "string") return item.split(/[;,]/).map(text => text.trim()).filter(Boolean);
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const text = row.Name ?? row.Title ?? row.CompanyName ?? row.CountryName;
      return typeof text === "string" && text.trim() ? [text.trim()] : [];
    }
    return [];
  })));
}

function creditTitle(credit: DfiCredit) {
  return String(credit.Title || credit.DanishTitle || "").trim();
}

function creditSearchText(credit: DfiCredit) {
  return [credit.Title, credit.DanishTitle, credit.OriginalTitle]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function creditYear(credit: DfiCredit) {
  return extractDfiPremiereYear(credit);
}

function creditRole(credit: DfiCredit) {
  return credit.Description || credit.Type || "Klipper";
}

async function currentRightsHolderAndOrg() {
  const supabase = await createClient();
  const db = createServiceClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) throw new Error("Du skal være logget ind for at importere værker.");

  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", authData.user.id)
    .single();
  if (!rh) throw new Error("Kunne ikke finde din rettighedshaver-profil.");

  const orgId = await requireOrgId(db, authData.user.id);

  return { db, userId: authData.user.id, rightsHolderId: rh.id as string, orgId };
}

async function rememberRightsHolderExternalIdentity(
  db: ReturnType<typeof createServiceClient>,
  rightsHolderId: string,
  source: "dfi" | "tmdb" | "wikidata" | "imdb",
  externalId: string | number | null | undefined,
  displayName?: string | null
) {
  if (externalId === null || externalId === undefined || externalId === "") return;
  const external_id = String(externalId);
  const { data: conflict, error: conflictError } = await db
    .from("rights_holder_external_identities")
    .select("rights_holder_id")
    .eq("source", source)
    .eq("external_id", external_id)
    .neq("rights_holder_id", rightsHolderId)
    .maybeSingle();
  if (conflictError) {
    logWarn("Personidentitet", "Kunne ikke tjekke ekstern identitet", { source, externalId: external_id, error: conflictError.message });
    return;
  }
  if (conflict) {
    logWarn("Personidentitet", "Ekstern identitet er allerede knyttet til en anden rettighedshaver", { source, externalId: external_id });
    return;
  }
  const { error } = await db.from("rights_holder_external_identities").upsert(
    {
      rights_holder_id: rightsHolderId,
      source,
      external_id,
      display_name: displayName ?? null,
      selected_automatically: true,
    },
    { onConflict: "rights_holder_id,source,external_id" }
  );
  if (error) logWarn("Personidentitet", "Ekstern identitet kunne ikke gemmes", { source, externalId: external_id, error: error.message });
}

async function findExistingWorkForDfiCredit(db: ReturnType<typeof createServiceClient>, credit: DfiCredit, orgId: string) {
  const filmId = credit.Id ? String(credit.Id) : null;
  if (filmId) {
    const { data } = await db
      .from("works")
      .select("id, title, year, duration_minutes, season_count, episode_count, genre, director, description, alternative_titles, production_countries, production_companies, poster_url, tmdb_id, imdb_id, wikidata_id, dfi_metadata")
      .eq("org_id", orgId)
      .eq("dfi_id", filmId)
      .maybeSingle();
    if (data) return data;
  }

  const title = creditTitle(credit);
  const year = creditYear(credit);
  if (!title || !year) return null;

  const { data } = await db
    .from("works")
    .select("id, title, year, duration_minutes, season_count, episode_count, genre, director, description, alternative_titles, production_countries, production_companies, poster_url, tmdb_id, imdb_id, wikidata_id, dfi_metadata")
    .eq("org_id", orgId)
    .eq("year", year)
    .limit(50);

  return (data ?? []).find(work => normalizeTitle(work.title ?? "") === normalizeTitle(title)) ?? null;
}

async function assignmentExists(db: ReturnType<typeof createServiceClient>, workId: string, rightsHolderId: string) {
  const { data } = await db
    .from("work_assignments")
    .select("id")
    .eq("work_id", workId)
    .eq("rights_holder_id", rightsHolderId)
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function ensureOnboardingEpisodes(params: {
  db: ReturnType<typeof createServiceClient>;
  parent: EpisodeParentWork;
  seasonNumber: number;
  selectedEpisodes: number[];
}) {
  const { db, parent, seasonNumber, selectedEpisodes } = params;
  const maxEpisode = Math.max(...selectedEpisodes, 1);
  const { data: existing } = await db
    .from("works")
    .select("id, episode_number")
    .eq("parent_work_id", parent.id)
    .eq("season_number", seasonNumber);

  const existingByNumber = new Map<number, string>();
  for (const episode of existing ?? []) {
    if (episode.episode_number != null) existingByNumber.set(episode.episode_number, episode.id);
  }

  const sStr = String(seasonNumber).padStart(2, "0");
  const toInsert = Array.from({ length: maxEpisode }, (_, index) => index + 1)
    .filter(episodeNumber => !existingByNumber.has(episodeNumber))
    .map(episodeNumber => {
      const eStr = String(episodeNumber).padStart(2, "0");
      return {
        org_id: parent.org_id,
        parent_work_id: parent.id,
        season_number: seasonNumber,
        episode_number: episodeNumber,
        title: `${parent.title} - S${sStr}E${eStr}`,
        type: parent.type,
        year: parent.year,
        duration_minutes: parent.duration_minutes,
        genre: parent.genre ?? null,
        director: parent.director ?? null,
        description: parent.description ?? null,
        poster_url: parent.poster_url ?? null,
        status: parent.status,
        dfi_id: parent.dfi_id ?? null,
        tmdb_id: parent.tmdb_id ?? null,
        imdb_id: parent.imdb_id ?? null,
        wikidata_id: parent.wikidata_id ?? null,
      };
    });

  if (toInsert.length > 0) {
    const { error } = await db.from("works").insert(toInsert);
    if (error) throw new Error(error.message);
  }

  const parentUpdates: Record<string, number> = {};
  if (!parent.season_count || parent.season_count < seasonNumber) parentUpdates.season_count = seasonNumber;
  if (!parent.episode_count || parent.episode_count < maxEpisode) parentUpdates.episode_count = maxEpisode;
  if (Object.keys(parentUpdates).length) await db.from("works").update(parentUpdates).eq("id", parent.id);

  const { data: episodeRows, error } = await db
    .from("works")
    .select("id, episode_number")
    .eq("parent_work_id", parent.id)
    .eq("season_number", seasonNumber)
    .in("episode_number", selectedEpisodes);
  if (error) throw new Error(error.message);
  return episodeRows ?? [];
}

async function fetchDFI(endpoint: string) {
  const username = process.env.DFI_API_USERNAME;
  const password = process.env.DFI_API_PASSWORD;
  if (!username || !password) {
    return { success: false, error: "DFI API-legitimationsoplysninger mangler i miljøvariabler" };
  }

  const url = `https://data.dfi.dk${endpoint}`;
  const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Accept-Language": "da-DK",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return { success: false, status: res.status, error: `DFI API returnerede status ${res.status}` };
    }

    const data = await res.json();
    return { success: true, data };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      return { success: false, error: "Tidsafbrydelse: DFI API svarede ikke inden for 15 sekunder." };
    }
    return { success: false, error: error instanceof Error ? error.message : "Netværksfejl ved DFI API-kald" };
  }
}

export async function downloadDfiPosterDataUrl(metadata: unknown) {
  const posterUrl = extractDfiPosterUrl(metadata);
  if (!posterUrl) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(posterUrl, {
      headers: { Accept: "image/avif,image/webp,image/*,*/*" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;

    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > MAX_DFI_POSTER_BYTES) return null;

    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_DFI_POSTER_BYTES) return null;

    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

export async function searchDFIPerson(
  firstName?: string,
  lastName?: string,
  fullName?: string
) {
  let query = "";
  if (fullName?.trim()) {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length > 1) {
      const last = parts.pop()!;
      const first = parts.join(" ");
      query = `?FirstName=${encodeURIComponent(first)}&LastName=${encodeURIComponent(last)}`;
    } else {
      query = `?Name=${encodeURIComponent(fullName.trim())}`;
    }
  } else if (firstName && lastName) {
    query = `?FirstName=${encodeURIComponent(firstName.trim())}&LastName=${encodeURIComponent(lastName.trim())}`;
  } else if (firstName) {
    query = `?Name=${encodeURIComponent(firstName.trim())}`;
  } else {
    return { success: false, error: "Angiv fornavn og efternavn eller fuldt navn." };
  }

  const result = await fetchDFI(`/v1/person${query}`);
  if (!result.success || !result.data) {
    return { success: false, error: result.error || "Ingen data fra DFI." };
  }

  return { success: true, results: result.data.PersonList || [] };
}

export async function getDFIPersonCredits(personId: number) {
  const result = await fetchDFI(`/v1/person/${personId}`);
  if (!result.success || !result.data) {
    return { success: false, error: result.error || "Kunne ikke hente person-detaljer." };
  }
  const portraitPath = extractDfiPersonPortraitUrl(result.data);
  const portraitPaths = extractDfiPersonPortraitUrls(result.data);
  const normalizePortraitPath = (path: string) => /^https?:\/\//i.test(path)
    ? path
    : `https://www.dfi.dk${path.startsWith("/") ? "" : "/"}${path}`;
  const portraitUrl = portraitPath
    ? normalizePortraitPath(portraitPath)
    : null;
  return {
    success: true,
    person: result.data,
    credits: result.data.FilmCredits || [],
    portraitUrl,
    portraitUrls: Array.from(new Set(portraitPaths.map(normalizePortraitPath))),
  };
}

export async function searchDFIFilms(title: string) {
  if (!title?.trim()) return { success: false, error: "Angiv en søgetitel." };

  const cleanedTitle = title.trim().replace(/^["'»«'"'""]/, "").replace(/["'»«'"'""]$/, "").trim();
  const hasSpaces = cleanedTitle.includes(" ");
  const searchQueries = [cleanedTitle];

  if (hasSpaces) {
    const words = cleanedTitle.split(/\s+/).map((w) => w.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ""));
    const distinctiveWords = words.filter((w) => w.length > 2);
    searchQueries.push(...(distinctiveWords.length > 0 ? distinctiveWords : words));
  }

  const results = await Promise.all(
    Array.from(new Set(searchQueries.filter(Boolean))).map(searchQuery =>
      fetchDFI(`/v1/film?Title=${encodeURIComponent(searchQuery)}`)
    )
  );

  const firstError = results.find(result => !result.success);
  const filmsById = new Map<string, DfiCredit>();
  for (const result of results) {
    if (!result.success || !result.data) continue;
    for (const film of (result.data.FilmList || []) as DfiCredit[]) {
      const key = String(film.Id ?? `${film.Title}-${film.ReleaseYear}-${film.ProductionYear}`);
      if (!filmsById.has(key)) filmsById.set(key, film);
    }
  }

  if (!filmsById.size) {
    return { success: false, error: firstError?.error || "Ingen film fundet." };
  }

  let filmList = Array.from(filmsById.values());

  if (hasSpaces && filmList.length > 0) {
    const originalLower = cleanedTitle.toLowerCase();
    const scored = filmList.map((film): DfiSearchScore => {
      const t = creditSearchText(film);
      let score = t === originalLower ? 100 : t.includes(originalLower) ? 50 : 0;
      originalLower.split(/\s+/).filter((w) => w.length > 1).forEach((w) => {
        if (t.includes(w)) score += 10;
      });
      return { film, score };
    });
    scored.sort((a, b) => b.score - a.score);
    filmList = scored.filter((i) => i.score > 0).map((i) => i.film);
  }

  filmList.sort((a: DfiCredit, b: DfiCredit) => {
    const bYear = extractDfiPremiereYear(b) ?? 0;
    const aYear = extractDfiPremiereYear(a) ?? 0;
    return bYear - aYear;
  });

  return { success: true, results: filmList };
}

export async function getDFIFilmDetails(filmId: number) {
  const result = await fetchDFI(`/v1/film/${filmId}`);
  if (!result.success || !result.data) {
    return { success: false, error: result.error || "Kunne ikke hente filmdetaljer." };
  }
  const posterDataUrl = await downloadDfiPosterDataUrl(result.data);
  return { success: true, film: result.data, posterDataUrl };
}

export async function prepareDFIImportCredits(personId: number, credits: DfiCredit[]) {
  try {
    const { db, rightsHolderId, orgId } = await currentRightsHolderAndOrg();

    await rememberRightsHolderExternalIdentity(db, rightsHolderId, "dfi", personId);

    const newCredits: DfiCredit[] = [];
    let linkedExistingCount = 0;
    let skippedAlreadyAssignedCount = 0;
    const errors: string[] = [];

    for (const credit of credits) {
      const existing = await findExistingWorkForDfiCredit(db, credit, orgId);
      if (!existing?.id) {
        newCredits.push(credit);
        continue;
      }

      if (await assignmentExists(db, existing.id, rightsHolderId)) {
        skippedAlreadyAssignedCount++;
        continue;
      }

      const { error } = await db
        .from("work_assignments")
        .upsert(
          {
            work_id: existing.id,
            org_id: orgId,
            rights_holder_id: rightsHolderId,
            role: creditRole(credit),
          },
          { onConflict: "work_id,rights_holder_id,role" }
        );

      if (error) {
        errors.push(`Fejl ved tilknytning af ${creditTitle(credit) || "værk"}: ${error.message}`);
        newCredits.push(credit);
      } else {
        linkedExistingCount++;
      }
    }

    revalidatePath("/portal/mine-vaerker");
    return { success: true, credits: newCredits, linkedExistingCount, skippedAlreadyAssignedCount, errors: errors.length ? errors : null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Kunne ikke forberede DFI-import.";
    return { success: false, error: message, credits, linkedExistingCount: 0, skippedAlreadyAssignedCount: 0 };
  }
}

export async function importApprovedDFIWorks(personId: number, selectedCredits: DfiCredit[]) {
  let context: Awaited<ReturnType<typeof currentRightsHolderAndOrg>>;
  try {
    context = await currentRightsHolderAndOrg();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Du skal være logget ind for at importere værker.";
    return { success: false, error: message };
  }
  const { db, rightsHolderId, orgId } = context;
  logInfo("DFI import", "Starter import", { credits: selectedCredits.length });

  await rememberRightsHolderExternalIdentity(db, rightsHolderId, "dfi", personId);

  let importedCount = 0;
  let linkedExistingCount = 0;
  const errors: string[] = [];

  // Hent alle filmdetaljer parallelt
  const detailResults = await Promise.all(
    selectedCredits.map(async (credit) => {
      const filmId = credit.Id;
      if (!filmId) return null;
      const res = await fetchDFI(`/v1/film/${filmId}`);
      if (res.success && res.data) return { credit, film: res.data };
      logWarn("DFI import", "Filmdetaljer kunne ikke hentes", { filmId: String(filmId), error: res.error });
      errors.push(`Film ID ${filmId}: ${res.error}`);
      return null;
    })
  );

  for (const item of detailResults.filter(Boolean) as { credit: DfiCredit; film: DfiMetadata }[]) {
    const { credit, film } = item;
    const filmId = credit.Id;

    const workType = mapDfiWorkType(film.Category, film.Type);

    const prodYear = extractDfiPremiereYear(film);
    const filmTitle = String(film.Title || film.DanishTitle || "Ukendt titel");

    const dfiPosterUrl = await downloadDfiPosterDataUrl(film) ?? extractDfiPosterUrl(film);
    let posterUrl = dfiPosterUrl;

    // Slå plakat og tmdb_id op i TMDB (stille fejl)
    let tmdbId: number | null = null;
    let imdbId: string | null = null;
    let wikidataId: string | null = null;
    let wikidataDirector: string | null = null;
    let wikidataGenre: string | null = null;
    let tmdbDetails: Record<string, any> | null = null;
    try {
      const match = await findTMDBMatch(filmTitle, prodYear);
      tmdbId = match.tmdb_id;
      if (!posterUrl) posterUrl = match.poster_url;
      if (tmdbId) {
        const externalIds = await getTMDBExternalIds(tmdbId, match.media_type ?? "movie");
        imdbId = externalIds.imdb_id;
        wikidataId = externalIds.wikidata_id;
        const detailsResult = await getTMDBWorkDetails(tmdbId, match.media_type ?? "movie");
        tmdbDetails = detailsResult.success && detailsResult.details ? detailsResult.details as Record<string, any> : null;
      }
    } catch { /* tmdbId/posterUrl forbliver som de er */ }

    try {
      const wiki = await enrichFromWikidata({ imdbId, title: filmTitle, year: prodYear });
      imdbId = imdbId ?? wiki.imdb_id;
      wikidataId = wikidataId ?? wiki.wikidata_id;
      wikidataDirector = wiki.director;
      wikidataGenre = wiki.genre;
    } catch { /* Wikidata er kun berigelse */ }

    try {
      const existing = await findExistingWorkForDfiCredit(db, { ...credit, Title: filmTitle, ProductionYear: prodYear }, orgId);
      let workId = existing?.id ?? null;

      const parsedChildren = (Array.isArray(film.Children) ? film.Children : []).map(child => parseDfiEpisodeTitleInfo(String((child as Record<string, unknown>).Title ?? ""))).filter(Boolean);
      const selectedEpisodeCount = (credit.__selected_episodes ?? []).length;
      const detectedEpisodeCount = Math.max(
        credit.__episode_options?.length ?? 0,
        parsedChildren.length,
        ...parsedChildren.map(item => item?.totalEpisodes ?? 0),
        parseDfiEpisodeCount(String(film.Comment ?? film.Synopsis ?? "")) ?? 0,
        Number(tmdbDetails?.number_of_episodes ?? 0),
        selectedEpisodeCount
      ) || null;
      const seasonNumber = credit.__season_number ?? parseSeasonNumberFromTitle(filmTitle) ?? 1;
      const detectedSeasonCount = workType === "tv-serie" || workType === "dokumentar-serie" ? Math.max(seasonNumber, Number(tmdbDetails?.number_of_seasons ?? 0), 1) : null;
      const durationMinutes = typeof film.Duration === "number" ? film.Duration : typeof film.LengthInMin === "number" ? film.LengthInMin : Number(tmdbDetails?.runtime ?? tmdbDetails?.episode_run_time?.[0] ?? 0) || null;
      const alternativeTitles = metadataTextList(film.AltTitle).concat(metadataTextList(film.ForeignTitles));
      const productionCountries = metadataTextList(film.ProductionCountries).concat(metadataTextList(tmdbDetails?.production_countries));
      const productionCompanies = metadataTextList(film.ProductionCompanies).concat(metadataTextList(tmdbDetails?.production_companies));

      const workData = {
        dfi_id: String(filmId),
        title: filmTitle,
        type: workType,
        year: prodYear,
        org_id: orgId,
        description: film.Synopsis || film.ShortSynopsis || null,
        duration_minutes: durationMinutes,
        season_count: detectedSeasonCount,
        episode_count: detectedEpisodeCount,
        director: extractDfiDirectors(film).join(", ") || wikidataDirector || null,
        genre: typeof film.Genre === "string" ? film.Genre : wikidataGenre,
        alternative_titles: Array.from(new Set(alternativeTitles)),
        production_countries: Array.from(new Set(productionCountries)),
        production_companies: Array.from(new Set(productionCompanies)),
        poster_url: posterUrl,
        tmdb_id: tmdbId,
        imdb_id: imdbId,
        wikidata_id: wikidataId,
        dfi_metadata: film,
        dfi_title: typeof film.Title === "string" ? film.Title : null,
        dfi_danish_title: typeof film.DanishTitle === "string" ? film.DanishTitle : null,
        dfi_original_title: typeof film.OriginalTitle === "string" ? film.OriginalTitle : null,
        dfi_category: typeof film.Category === "string" ? film.Category : null,
        dfi_type: typeof film.Type === "string" ? film.Type : null,
        field_sources: { title: "dfi", type: "dfi", year: "dfi", description: "dfi", poster_url: dfiPosterUrl ? "dfi" : posterUrl ? "tmdb" : null, tmdb_id: tmdbId ? "tmdb" : null, imdb_id: imdbId ? "tmdb/wikidata" : null, wikidata_id: wikidataId ? "tmdb/wikidata" : null, season_count: detectedSeasonCount ? "dfi/tmdb" : null, episode_count: detectedEpisodeCount ? "dfi/tmdb" : null },
      };

      const wasExisting = Boolean(workId);
      if (!workId) {
        const { data: newWork, error: insertErr } = await db
          .from("works")
          .insert(workData)
          .select("id")
          .single();

        if (insertErr || !newWork) {
          logWarn("DFI import", "Oprettelse af værk fejlede", { filmId: String(filmId), error: insertErr?.message });
          errors.push(`Fejl ved oprettelse af ${filmTitle}: ${insertErr?.message}`);
          continue;
        }
        workId = newWork.id;
      } else if (existing) {
        // Udfyld manglende felter uden at overskrive manuelt vedligeholdte værdier.
        const updates: Record<string, unknown> = {};
        if (!existing.poster_url && posterUrl) updates.poster_url = posterUrl;
        if (!existing.tmdb_id && tmdbId) updates.tmdb_id = tmdbId;
        if (!existing.imdb_id && imdbId) updates.imdb_id = imdbId;
        if (!existing.wikidata_id && wikidataId) updates.wikidata_id = wikidataId;
        for (const key of ["duration_minutes", "season_count", "episode_count", "genre", "director", "description", "alternative_titles", "production_countries", "production_companies"] as const) {
          const value = workData[key];
          if ((existing[key] == null || (Array.isArray(existing[key]) && existing[key].length === 0)) && value != null) updates[key] = value;
        }
        updates.field_sources = workData.field_sources;
        updates.dfi_metadata = film;
        if (Object.keys(updates).length > 0) {
          await db.from("works").update(updates).eq("id", workId);
        }
      }

      const selectedEpisodes = (credit.__selected_episodes ?? []).filter(Number.isFinite);
      let assignmentWorkIds = [workId];
      const isSeriesParent = (workType === "tv-serie" || workType === "dokumentar-serie") && selectedEpisodes.length > 0;

      if (isSeriesParent) {
        const episodes = await ensureOnboardingEpisodes({
          db,
          parent: {
            id: workId,
            org_id: orgId,
            title: filmTitle,
            type: workType,
            year: prodYear,
            duration_minutes: durationMinutes,
            season_count: detectedSeasonCount,
            episode_count: detectedEpisodeCount,
            genre: typeof film.Genre === "string" ? film.Genre : wikidataGenre,
            director: extractDfiDirectors(film).join(", ") || wikidataDirector || null,
            description: typeof film.Synopsis === "string" ? film.Synopsis : typeof film.ShortSynopsis === "string" ? film.ShortSynopsis : null,
            poster_url: posterUrl,
            status: "godkendt",
            dfi_id: String(filmId),
            tmdb_id: tmdbId,
            imdb_id: imdbId,
            wikidata_id: wikidataId,
          },
          seasonNumber,
          selectedEpisodes,
        });
        assignmentWorkIds = episodes.map(episode => episode.id);
      }

      // Tilføj work_assignment
      const { error: assignErr } = await db
        .from("work_assignments")
        .upsert(
          assignmentWorkIds.map(targetWorkId => ({
            work_id: targetWorkId,
            org_id: orgId,
            rights_holder_id: rightsHolderId,
            role: credit.Description || credit.Type || "Klipper",
          })),
          { onConflict: "work_id,rights_holder_id,role" }
        );

      if (assignErr) {
        logWarn("DFI import", "Kreditering fejlede", { filmId: String(filmId), error: assignErr.message });
        errors.push(`Fejl ved kreditering af ${filmTitle}: ${assignErr.message}`);
        continue;
      }

      if (wasExisting) linkedExistingCount++;
      else importedCount++;
    } catch (err: unknown) {
      errors.push(`Systemfejl for ${filmTitle}: ${err instanceof Error ? err.message : "Ukendt fejl"}`);
    }
  }

  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/vaerker");

  return {
    success: errors.length === 0 || importedCount > 0 || linkedExistingCount > 0,
    importedCount,
    linkedExistingCount,
    errors: errors.length > 0 ? errors : null,
  };
}

export type OnboardingCredit = {
  id: string;
  title: string;
  year: number | null;
  role: string;
  category: string;
  source: "lokal" | "dfi" | "tmdb";
  imdb_id?: string | null;
  wikidata_id?: string | null;
  poster_url?: string | null;
  director?: string | null;
  season_number?: number | null;
  selected_episodes?: number[] | null;
  episode_options?: Array<{ number: number; title: string }>;
  raw: any;
};

function isRightBearingRole(role: string | null | undefined): boolean {
  if (!role) return true;
  const r = role.toLowerCase().trim();
  const excluded = [
    "color grading",
    "kolorist",
    "teaser klipper",
    "grading",
    "colorist",
    "trailer klipper",
    "dft",
    "colorist assistant"
  ];
  return !excluded.some(ex => r.includes(ex));
}

function isSameCredit(aTitle: string, aYear: number | null, bTitle: string, bYear: number | null) {
  const normA = normalizeTitle(aTitle);
  const normB = normalizeTitle(bTitle);
  if (!normA || !normB) return false;
  if (normA !== normB) return false;
  if (aYear && bYear) {
    return Math.abs(aYear - bYear) <= 1;
  }
  return true;
}

function isDfiSeriesParent(c: any): boolean {
  const category = String(c.Category || "").toLowerCase();
  const type = String(c.Type || "").toLowerCase();
  const isSeries = category.includes("serie") || type.includes("serie");
  
  if (!isSeries) return false;
  
  const hasParent = Boolean(c.Parent?.Id);
  const hasEpisodeInfo = Boolean(parseDfiEpisodeTitleInfo(c.Title ?? ""));
  
  return !hasParent && !hasEpisodeInfo;
}

export async function normalizeDfiSeriesResults(credits: DfiCredit[]) {
  const parents = new Map<string, DfiCredit>();
  const parentRequests = new Map<string, Promise<DfiCredit | null>>();
  const seriesKey = (title: string | null | undefined) => cleanDfiTitle(title)
    .replace(/\s+\d+\s*:\s*\d+.*$/i, "")
    .replace(/\(\s*\)/g, "")
    .toLocaleLowerCase("da-DK")
    .replace(/[^a-z0-9æøå]/g, "");
  const explicitParents = new Map(
    credits
      .filter(credit => !credit.Parent?.Id && !parseDfiEpisodeTitleInfo(credit.Title ?? ""))
      .map(credit => [seriesKey(credit.Title || credit.DanishTitle), credit] as const)
      .filter(([key]) => Boolean(key))
  );

  const fetchParent = (id: string) => {
    const existing = parentRequests.get(id);
    if (existing) return existing;
    const request = fetchDFI(`/v1/film/${id}`).then(result => result.success && result.data ? result.data as DfiCredit : null);
    parentRequests.set(id, request);
    return request;
  };

  for (const credit of credits) {
    const parentId = credit.Parent?.Id ? String(credit.Parent.Id) : null;
    const parsedChild = parseDfiEpisodeTitleInfo(credit.Title ?? "");
    const inferredParent = parsedChild ? explicitParents.get(seriesKey(credit.Title)) ?? null : null;
    const canonical = parentId ? await fetchParent(parentId) : inferredParent ?? credit;
    const canonicalId = String(canonical?.Id ?? parentId ?? credit.Id ?? "");
    if (!canonicalId) continue;

    const current = parents.get(canonicalId) ?? { ...(canonical ?? credit), Id: canonical?.Id ?? parentId ?? credit.Id };
    const children = Array.isArray(current.Children) ? current.Children : [];
    const episodeOptions = children
      .map((child, index) => {
        const parsed = parseDfiEpisodeTitleInfo(child.Title ?? "");
        if (!parsed) return null;
        return { number: parsed.episodeNumber ?? index + 1, title: parsed.subtitle || child.Title || `Afsnit ${index + 1}` };
      })
      .filter((option): option is { number: number; title: string } => Boolean(option?.number));

    if (parsedChild?.episodeNumber && !episodeOptions.some(option => option.number === parsedChild.episodeNumber)) {
      episodeOptions.push({ number: parsedChild.episodeNumber, title: parsedChild.subtitle || credit.Title || `Afsnit ${parsedChild.episodeNumber}` });
    }

    current.__episode_options = Array.from(
      new Map([...(current.__episode_options ?? []), ...episodeOptions].map(option => [option.number, option])).values()
    ).sort((a, b) => a.number - b.number);
    current.Description = credit.Description || current.Description;
    parents.set(canonicalId, current);
  }

  return Array.from(parents.values());
}

export async function searchOnboardingCredits(
  firstName?: string,
  lastName?: string,
  fullName?: string
) {
  const nameToSearch = fullName || `${firstName ?? ""} ${lastName ?? ""}`.trim();
  logInfo("Onboarding search", "Søger krediteringer");

  const db = createServiceClient();
  let rightsHolderId: string | null = null;
  let savedIdentity: { dfi_person_id?: number | null; tmdb_person_id?: number | null } | null = null;
  let savedDfiPersonIds: number[] = [];
  let savedTmdbPersonIds: number[] = [];
  try {
    const context = await currentRightsHolderAndOrg();
    rightsHolderId = context.rightsHolderId;
    const { data } = await db.from("rettighedshavere").select("dfi_person_id, tmdb_person_id").eq("id", rightsHolderId).maybeSingle();
    savedIdentity = data;
    const { data: identities } = await db.from("rights_holder_external_identities").select("source,external_id").eq("rights_holder_id", rightsHolderId).in("source", ["dfi", "tmdb"]);
    savedDfiPersonIds = (identities ?? []).filter(item => item.source === "dfi").map(item => Number(item.external_id)).filter(Number.isFinite);
    savedTmdbPersonIds = (identities ?? []).filter(item => item.source === "tmdb").map(item => Number(item.external_id)).filter(Number.isFinite);
  } catch {
    // Fortsæt uden rightsHolderId i tilfælde af test-kørsler
  }

  let dfiPersonId: number | null = null;
  let tmdbPersonId: number | null = null;
  
  let rawDfiCredits: DfiCredit[] = [];
  const rawTmdbCredits: any[] = [];

  // 1. Hent rådata fra DFI
  try {
    const legacyDfiPersonId = savedIdentity?.dfi_person_id ?? null;
    const dfiPersonRes = savedDfiPersonIds.length || legacyDfiPersonId ? null : await searchDFIPerson(firstName, lastName, fullName);
    const resolvedDfiPersonIds = savedDfiPersonIds.length ? savedDfiPersonIds : legacyDfiPersonId ? [Number(legacyDfiPersonId)] : (dfiPersonRes?.success ? (dfiPersonRes.results ?? []).slice(0, 1).map((item: { Id?: number | string }) => Number(item.Id)) : []);
    dfiPersonId = resolvedDfiPersonIds[0] ?? null;
    for (const resolvedDfiPersonId of resolvedDfiPersonIds) {
      const dfiCreditsRes = await getDFIPersonCredits(resolvedDfiPersonId);
      if (dfiCreditsRes.success && dfiCreditsRes.credits) {
        const uniqueDfi = dfiCreditsRes.credits.filter((c: any, i: number, arr: any[]) => arr.findIndex((x) => x.Id === c.Id) === i);
        const filteredDfi = uniqueDfi
          .filter((c: any) => isRightBearingRole(c.Description || c.Type));
        rawDfiCredits.push(...filteredDfi);
      }
    }
  } catch (err) {
    logWarn("Onboarding search", "DFI-søgning fejlede", { error: errorMessage(err) });
  }

  rawDfiCredits = await normalizeDfiSeriesResults(rawDfiCredits);

  // 2. Hent rådata fra TMDB
  try {
    const legacyTmdbPersonId = savedIdentity?.tmdb_person_id ?? null;
    const tmdbPersonRes = savedTmdbPersonIds.length || legacyTmdbPersonId ? null : await searchTMDBPerson(nameToSearch);
    const resolvedTmdbPersonIds = savedTmdbPersonIds.length ? savedTmdbPersonIds : legacyTmdbPersonId ? [Number(legacyTmdbPersonId)] : (tmdbPersonRes?.success ? (tmdbPersonRes.results ?? []).slice(0, 1).map((item: { id?: number | string }) => Number(item.id)) : []);
    tmdbPersonId = resolvedTmdbPersonIds[0] ?? null;
    for (const resolvedTmdbPersonId of resolvedTmdbPersonIds) {
      const tmdbCreditsRes = await getTMDBPersonCombinedCredits(resolvedTmdbPersonId);
      if (tmdbCreditsRes.success && tmdbCreditsRes.crew) {
        const tmdbCrew = tmdbCreditsRes.crew as any[];
        const editors = tmdbCrew.filter(c => c.job === "Editor" || c.job === "Edit" || c.job?.toLowerCase().includes("klipp"));
        const filteredTmdb = editors.filter(c => isRightBearingRole(c.job));
        rawTmdbCredits.push(...filteredTmdb);
      }
    }
  } catch (err) {
    logWarn("Onboarding search", "TMDB-søgning fejlede", { error: errorMessage(err) });
  }

  // 3. Tjek den lokale database (works og work_assignments)
  const localWorksMap = new Map<string, any>();
  const localDfiIds = new Set<string>();
  const localTmdbIds = new Set<number>();

  // A. Hent eksisterende assignments for denne rettighedshaver (kun hvis søgningen er på eget navn)
  if (rightsHolderId) {
    try {
      const { data: rhProfile } = await db
        .from("rettighedshavere")
        .select("full_name")
        .eq("id", rightsHolderId)
        .maybeSingle();

      const rhName = rhProfile?.full_name ?? "";
      const isSearchForSelf = normalizeTitle(rhName) === normalizeTitle(nameToSearch);

      if (isSearchForSelf) {
        const { data: myAssignments } = await db
          .from("work_assignments")
          .select("role, works(*)")
          .eq("rights_holder_id", rightsHolderId);
        
        if (myAssignments) {
          myAssignments.forEach((a: any) => {
            const w = a.works;
            if (w && isRightBearingRole(a.role)) {
              localWorksMap.set(w.id, { work: w, role: a.role });
              if (w.dfi_id) localDfiIds.add(String(w.dfi_id));
              if (w.tmdb_id) localTmdbIds.add(Number(w.tmdb_id));
            }
          });
        }
      }
    } catch (err) {
      logWarn("Onboarding search", "Lokale krediteringer kunne ikke hentes", { error: errorMessage(err) });
    }
  }

  // B. Slå de DFI og TMDB id'er op, som vi fandt i søgningen, for at se om de allerede findes lokalt
  const searchDfiIds = rawDfiCredits.map(c => String(c.Id)).filter(Boolean);
  if (searchDfiIds.length > 0) {
    try {
      const { data: matchedDfiWorks } = await db
        .from("works")
        .select("*")
        .in("dfi_id", searchDfiIds);
      if (matchedDfiWorks) {
        matchedDfiWorks.forEach((w: any) => {
          if (!localWorksMap.has(w.id)) {
            const rawCredit = rawDfiCredits.find(c => String(c.Id) === String(w.dfi_id));
            localWorksMap.set(w.id, { work: w, role: rawCredit?.Description || rawCredit?.Type || "Klipper" });
          }
          localDfiIds.add(String(w.dfi_id));
          if (w.tmdb_id) localTmdbIds.add(Number(w.tmdb_id));
        });
      }
    } catch (err) {
      logWarn("Onboarding search", "Lokalt DFI-opslag fejlede", { error: errorMessage(err) });
    }
  }

  const searchTmdbIds = rawTmdbCredits.map(c => Number(c.id)).filter(Boolean);
  if (searchTmdbIds.length > 0) {
    try {
      const { data: matchedTmdbWorks } = await db
        .from("works")
        .select("*")
        .in("tmdb_id", searchTmdbIds);
      if (matchedTmdbWorks) {
        matchedTmdbWorks.forEach((w: any) => {
          if (!localWorksMap.has(w.id)) {
            const rawCredit = rawTmdbCredits.find(c => Number(c.id) === Number(w.tmdb_id));
            localWorksMap.set(w.id, { work: w, role: rawCredit?.job || "Klipper" });
          }
          localTmdbIds.add(Number(w.tmdb_id));
          if (w.dfi_id) localDfiIds.add(String(w.dfi_id));
        });
      }
    } catch (err) {
      logWarn("Onboarding search", "Lokalt TMDB-opslag fejlede", { error: errorMessage(err) });
    }
  }

  // 4. Byg de tre separate lister for at respektere prioriteringsrækkefølgen
  const localCredits: OnboardingCredit[] = [];
  const dfiCredits: OnboardingCredit[] = [];
  const tmdbCredits: OnboardingCredit[] = [];

  const localEpisodeParentIds = Array.from(new Set(
    Array.from(localWorksMap.values())
      .map(val => val.work?.parent_work_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  ));

  if (localEpisodeParentIds.length > 0) {
    try {
      const [{ data: parentWorks }, { data: childWorks }] = await Promise.all([
        db.from("works").select("*").in("id", localEpisodeParentIds),
        db.from("works").select("*").in("parent_work_id", localEpisodeParentIds).order("season_number", { ascending: true }).order("episode_number", { ascending: true }),
      ]);
      const parentMap = new Map((parentWorks ?? []).map((work: any) => [work.id, work]));
      const childrenByParent = new Map<string, any[]>();
      for (const child of childWorks ?? []) {
        if (!child.parent_work_id) continue;
        const rows = childrenByParent.get(child.parent_work_id) ?? [];
        rows.push(child);
        childrenByParent.set(child.parent_work_id, rows);
      }

      for (const [workId, val] of Array.from(localWorksMap.entries())) {
        const parentId = val.work?.parent_work_id;
        if (!parentId) continue;
        const parent = parentMap.get(parentId);
        if (!parent) continue;
        localWorksMap.delete(workId);
        const existing = localWorksMap.get(parent.id);
        const children = childrenByParent.get(parent.id) ?? [];
        localWorksMap.set(parent.id, {
          work: {
            ...parent,
            __local_children: children,
            __episode_options: buildCompleteEpisodeOptions({
              episodeCount: parent.episode_count,
              localChildren: children,
              seasonNumber: parseSeasonNumberFromTitle(parent.title) ?? children.find(child => child.season_number)?.season_number ?? 1,
            }),
          },
          role: existing?.role ?? val.role,
        });
      }
    } catch (err) {
      logWarn("Onboarding search", "Lokale serieafsnit kunne ikke samles under parent", { error: errorMessage(err) });
    }
  }

  const localParentsByTitle = new Map<string, { work: any; role: string }>();
  for (const val of localWorksMap.values()) {
    const work = val.work;
    const type = String(work?.type ?? "").toLowerCase();
    if (!work?.title || work?.parent_work_id || !(type.includes("serie") || type.includes("tv"))) continue;
    localParentsByTitle.set(normalizeTitle(cleanDfiTitle(work.title)), val);
  }

  const titleBasedChildrenByParent = new Map<string, any[]>();
  for (const [workId, val] of Array.from(localWorksMap.entries())) {
    const parsed = parseLocalEpisodeCode(val.work?.title);
    if (!parsed?.baseTitle) continue;
    const parent = localParentsByTitle.get(normalizeTitle(parsed.baseTitle));
    if (!parent) continue;
    localWorksMap.delete(workId);
    const rows = titleBasedChildrenByParent.get(parent.work.id) ?? [];
    rows.push({
      ...val.work,
      season_number: val.work?.season_number ?? parsed.seasonNumber,
      episode_number: val.work?.episode_number ?? parsed.episodeNumber,
    });
    titleBasedChildrenByParent.set(parent.work.id, rows);
  }

  for (const [parentId, children] of titleBasedChildrenByParent.entries()) {
    const parentEntry = localWorksMap.get(parentId);
    if (!parentEntry) continue;
    const existingChildren = Array.isArray(parentEntry.work.__local_children) ? parentEntry.work.__local_children : [];
    const mergedChildren = Array.from(new Map([...existingChildren, ...children].map(child => [child.id ?? `${child.season_number}-${child.episode_number}`, child])).values());
    const parentSeason = parseSeasonNumberFromTitle(parentEntry.work.title) ?? mergedChildren.find(child => child.season_number)?.season_number ?? 1;
    localWorksMap.set(parentId, {
      ...parentEntry,
      work: {
        ...parentEntry.work,
        __local_children: mergedChildren,
        __episode_options: buildCompleteEpisodeOptions({
          episodeCount: parentEntry.work.episode_count,
          localChildren: mergedChildren,
          seasonNumber: parentSeason,
        }),
      },
    });
  }

  // A. Fyld Local listen
  localWorksMap.forEach((val) => {
    const w = val.work;
    localCredits.push({
      id: `local-${w.id}`,
      title: w.title,
      year: w.year,
      role: val.role || "Klipper",
      category: w.type === "tv-serie" || w.type === "dokumentar-serie" || w.type === "serie" ? "TV-serie" : "Spillefilm",
      source: "lokal",
      imdb_id: w.imdb_id ?? null,
      wikidata_id: w.wikidata_id ?? null,
      poster_url: w.poster_url ?? null,
      director: w.director ?? null,
      season_number: w.season_number ?? parseSeasonNumberFromTitle(w.title),
      episode_options: w.__episode_options ?? [],
      raw: w
    });
  });

  // B. Fyld DFI listen med udestående DFI titler
  rawDfiCredits.forEach((c: any) => {
    const title = cleanDfiTitle(c.Title || c.DanishTitle || "Ukendt");
    const year = extractDfiPremiereYear(c) || null;
    const dfiId = String(c.Id);

    const isLocal = localDfiIds.has(dfiId) || localCredits.some(l => isSameCredit(l.title, l.year, title, year));
    if (!isLocal) {
      dfiCredits.push({
        id: `dfi-${dfiId}`,
        title,
        year,
        role: c.Description || c.Type || "Klipper",
        category: isDfiSeriesParent(c) ? "TV-serie" : c.Category || "Film",
        source: "dfi",
        poster_url: extractDfiPosterUrl(c as DfiMetadata),
        director: extractDfiDirectors(c as DfiMetadata).join(", ") || null,
        season_number: parseSeasonNumberFromTitle(title),
        episode_options: c.__episode_options ?? [],
        raw: c
      });
    }
  });

  // C. Fyld TMDB listen med udestående TMDB titler
  rawTmdbCredits.forEach((c: any) => {
    const title = c.title || c.name || "Ukendt";
    const releaseDate = c.release_date || c.first_air_date || "";
    const year = Number.parseInt(releaseDate.substring(0, 4), 10) || null;
    const tmdbId = Number(c.id);

    const isLocalOrDfi = localTmdbIds.has(tmdbId) || 
                         localCredits.some(l => isSameCredit(l.title, l.year, title, year)) ||
                         dfiCredits.some(d => isSameCredit(d.title, d.year, title, year));
    
    if (!isLocalOrDfi) {
      tmdbCredits.push({
        id: `tmdb-${tmdbId}`,
        title,
        year,
        role: c.job || "Klipper",
        category: c.media_type === "tv" ? "TV-serie" : "Spillefilm",
        source: "tmdb",
        poster_url: c.poster_path ? `https://image.tmdb.org/t/p/w185${c.poster_path}` : null,
        season_number: parseSeasonNumberFromTitle(title),
        raw: c
      });
    }
  });

  const mergedCredits = [...localCredits, ...dfiCredits, ...tmdbCredits];

  // Sorter den samlede liste efter årstal (nyeste først)
  mergedCredits.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  return {
    success: mergedCredits.length > 0,
    credits: mergedCredits,
    dfiPersonId,
    tmdbPersonId
  };
}

export async function resolveOnboardingEpisodeOptions(credit: OnboardingCredit, seasonNumber = 1) {
  let options = credit.episode_options ?? [];
  if (credit.source === "lokal" && Array.isArray(credit.raw?.__local_children)) {
    options = buildCompleteEpisodeOptions({
      episodeCount: Number(credit.raw?.episode_count ?? credit.raw?.number_of_episodes ?? 0) || null,
      externalOptions: options,
      localChildren: credit.raw.__local_children,
      seasonNumber,
    });
  }
  if (credit.source === "dfi") {
    const dfiId = String(credit.id).replace(/^dfi-/, "");
    const details = await getDFIFilmDetails(Number(dfiId));
    const film = details.success && details.film ? details.film as DfiCredit : null;
    const children: DfiCredit[] = Array.isArray(film?.Children) ? film.Children : [];
    const dfiOptions = children.map((child: DfiCredit, index: number) => {
      const parsed = parseDfiEpisodeTitleInfo(String(child.Title ?? ""));
      return parsed ? { number: parsed.episodeNumber ?? index + 1, title: parsed.subtitle || String(child.Title ?? "") } : null;
    }).filter((item): item is { number: number; title: string } => Boolean(item));
    if (dfiOptions.length) options = dfiOptions;
  }
  if (!options.length || (credit.source === "lokal" && Number(credit.raw?.tmdb_id ?? 0) && options.length <= (credit.raw?.__local_children?.length ?? 0))) {
    let tmdbId = credit.source === "tmdb" ? Number(String(credit.id).replace(/^tmdb-/, "")) : Number(credit.raw?.tmdb_id ?? 0);
    if (!tmdbId) tmdbId = Number((await findTMDBMatch(credit.title, credit.year)).tmdb_id ?? 0);
    if (tmdbId) {
      const season = await getTMDBSeasonEpisodes(tmdbId, seasonNumber);
      if (season.success) {
        const tmdbOptions = (season.episodes ?? []).map((episode: { episode_number?: number; name?: string }) => ({ number: Number(episode.episode_number), title: episode.name || `Afsnit ${episode.episode_number ?? ""}` })).filter(option => Number.isFinite(option.number) && option.number > 0);
        if (tmdbOptions.length > options.length) options = tmdbOptions;
      }
    }
  }
  return { success: options.length > 0, options, error: options.length ? null : "Der blev ikke fundet afsnit for denne sæson." };
}

export async function searchNewCreditsForCurrentMember(fullName: string) {
  const db = createServiceClient();
  let context: Awaited<ReturnType<typeof currentRightsHolderAndOrg>>;
  try {
    context = await currentRightsHolderAndOrg();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Du skal være logget ind for at søge.";
    return { success: false, error: message, credits: [], dfiPersonId: null, tmdbPersonId: null, skippedAlreadyAssignedCount: 0 };
  }

  const searchResult = await searchOnboardingCredits(undefined, undefined, fullName);
  if (!searchResult.success || !searchResult.credits) {
    return {
      ...searchResult,
      credits: [],
      skippedAlreadyAssignedCount: 0,
    };
  }

  const { data: assignments } = await db
    .from("work_assignments")
    .select("works(id, title, year, dfi_id, tmdb_id)")
    .eq("rights_holder_id", context.rightsHolderId);

  const assignedWorkIds = new Set<string>();
  const assignedDfiIds = new Set<string>();
  const assignedTmdbIds = new Set<number>();
  const assignedTitleYears: Array<{ title: string; year: number | null }> = [];

  for (const assignment of (assignments ?? []) as Array<{ works?: any | any[] | null }>) {
    const work = Array.isArray(assignment.works) ? assignment.works[0] : assignment.works;
    if (!work) continue;
    if (work.id) assignedWorkIds.add(String(work.id));
    if (work.dfi_id) assignedDfiIds.add(String(work.dfi_id));
    if (work.tmdb_id) assignedTmdbIds.add(Number(work.tmdb_id));
    if (work.title) assignedTitleYears.push({ title: String(work.title), year: work.year ?? null });
  }

  let skippedAlreadyAssignedCount = 0;
  const credits = searchResult.credits.filter(credit => {
    const raw = credit.raw as any;
    const localId = credit.source === "lokal" ? String(raw?.id ?? credit.id.replace(/^local-/, "")) : null;
    const dfiId = raw?.dfi_id ?? raw?.Id ?? (credit.id.startsWith("dfi-") ? credit.id.replace("dfi-", "") : null);
    const tmdbId = raw?.tmdb_id ?? raw?.id ?? (credit.id.startsWith("tmdb-") ? credit.id.replace("tmdb-", "") : null);

    const isAssigned =
      (localId && assignedWorkIds.has(String(localId))) ||
      (dfiId && assignedDfiIds.has(String(dfiId))) ||
      (tmdbId && assignedTmdbIds.has(Number(tmdbId))) ||
      assignedTitleYears.some(item => isSameCredit(item.title, item.year, credit.title, credit.year));

    if (isAssigned) skippedAlreadyAssignedCount += 1;
    return !isAssigned;
  });

  return {
    ...searchResult,
    success: true,
    credits,
    skippedAlreadyAssignedCount,
  };
}

export async function importApprovedOnboardingWorks(
  dfiPersonId: number | null,
  tmdbPersonId: number | null,
  approvedCredits: OnboardingCredit[]
) {
  let context: Awaited<ReturnType<typeof currentRightsHolderAndOrg>>;
  try {
    context = await currentRightsHolderAndOrg();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Du skal være logget ind for at importere.";
    return { success: false, error: message };
  }
  const { db, rightsHolderId, orgId } = context;

  if (dfiPersonId) {
    await rememberRightsHolderExternalIdentity(db, rightsHolderId, "dfi", dfiPersonId);
  }
  if (tmdbPersonId) {
    await rememberRightsHolderExternalIdentity(db, rightsHolderId, "tmdb", tmdbPersonId);
  }

  const localCredits = approvedCredits.filter(c => c.source === "lokal");
  const dfiCredits = approvedCredits.filter(c => c.source === "dfi").map(c => ({
    ...(c.raw as DfiCredit),
    __selected_episodes: c.selected_episodes ?? null,
    __season_number: c.season_number ?? null,
  }));
  const tmdbCredits = approvedCredits.filter(c => c.source === "tmdb");

  let importedCount = 0;
  let linkedExistingCount = 0;
  const errors: string[] = [];

  // 1. Importer Local credits (opret kun assignments til det eksisterende værk)
  for (const credit of localCredits) {
    const workId = credit.id.replace("local-", "");
    try {
      let assignmentWorkIds = [workId];
      const selectedEpisodes = (credit.selected_episodes ?? []).filter(Number.isFinite);
      const seasonNumber = credit.season_number ?? 1;
      const rawWork = credit.raw as EpisodeParentWork & { parent_work_id?: string | null; episode_number?: number | null };
      const isSeriesParent = (rawWork.type === "tv-serie" || rawWork.type === "dokumentar-serie") && !rawWork.parent_work_id && rawWork.episode_number == null;
      if (isSeriesParent && selectedEpisodes.length > 0) {
        const episodes = await ensureOnboardingEpisodes({
          db,
          parent: rawWork,
          seasonNumber,
          selectedEpisodes,
        });
        assignmentWorkIds = episodes.map(episode => episode.id);
      }

      const { error: assignErr } = await db
        .from("work_assignments")
        .upsert(
          assignmentWorkIds.map(targetWorkId => ({
            work_id: targetWorkId,
            org_id: orgId,
            rights_holder_id: rightsHolderId,
            role: credit.role || "Klipper",
          })),
          { onConflict: "work_id,rights_holder_id,role" }
        );
      if (assignErr) {
        errors.push(`Fejl ved kreditering af eksisterende værk ${credit.title}: ${assignErr.message}`);
      } else {
        linkedExistingCount++;
      }
    } catch (err: unknown) {
      errors.push(`Systemfejl for eksisterende værk ${credit.title}: ${err instanceof Error ? err.message : "Ukendt fejl"}`);
    }
  }

  // 2. Importer DFI credits
  if (dfiCredits.length > 0 && dfiPersonId) {
    const dfiRes = await importApprovedDFIWorks(dfiPersonId, dfiCredits);
    if (dfiRes.success) {
      importedCount += dfiRes.importedCount ?? 0;
      linkedExistingCount += dfiRes.linkedExistingCount ?? 0;
    }
    if (dfiRes.errors) {
      errors.push(...dfiRes.errors);
    }
  }

  // 3. Importer TMDB credits
  for (const credit of tmdbCredits) {
    const tmdbId = credit.raw.id;
    const title = credit.title;
    const year = credit.year;
    const mediaType = credit.raw.media_type === "tv" ? "tv" : "movie";
    const type = mediaType === "tv" ? "tv-serie" : "spillefilm";
    const posterUrl = credit.raw.poster_path ? `https://image.tmdb.org/t/p/w185${credit.raw.poster_path}` : null;
    let imdbId = credit.imdb_id ?? null;
    let wikidataId = credit.wikidata_id ?? null;
    let director = credit.director ?? null;
    let genre: string | null = null;
    let durationMinutes: number | null = null;
    let seasonCount: number | null = null;
    let episodeCount: number | null = null;
    let productionCountries: string[] = [];
    let productionCompanies: string[] = [];

    try {
      const externalIds = await getTMDBExternalIds(tmdbId, mediaType);
      imdbId = imdbId ?? externalIds.imdb_id;
      wikidataId = wikidataId ?? externalIds.wikidata_id;
      const wiki = await enrichFromWikidata({ imdbId, title, year });
      imdbId = imdbId ?? wiki.imdb_id;
      wikidataId = wikidataId ?? wiki.wikidata_id;
      director = director ?? wiki.director;
      genre = wiki.genre;
      durationMinutes = wiki.duration_minutes;
      const detailsResult = await getTMDBWorkDetails(tmdbId, mediaType);
      if (detailsResult.success && detailsResult.details) {
        const details = detailsResult.details as Record<string, any>;
        seasonCount = mediaType === "tv" ? Number(details.number_of_seasons ?? 0) || null : null;
        const selectedSeason = credit.season_number ?? 1;
        const season = Array.isArray(details.seasons) ? details.seasons.find((item: Record<string, any>) => Number(item.season_number) === selectedSeason) : null;
        episodeCount = mediaType === "tv" ? Number(season?.episode_count ?? details.number_of_episodes ?? 0) || null : null;
        durationMinutes = durationMinutes ?? (Number(details.runtime ?? details.episode_run_time?.[0] ?? 0) || null);
        productionCountries = metadataTextList(details.production_countries);
        productionCompanies = metadataTextList(details.production_companies);
        genre = genre ?? (metadataTextList(details.genres).join(", ") || null);
      }

      const { data: existing } = await db
        .from("works")
        .select("id, imdb_id, wikidata_id, duration_minutes, season_count, episode_count, genre, director, description, production_countries, production_companies")
        .eq("org_id", orgId)
        .eq("tmdb_id", tmdbId)
        .maybeSingle();

      let workId = existing?.id ?? null;

      if (!workId) {
        const { data: newWork, error: insertErr } = await db
          .from("works")
          .insert({
            title,
            type,
            year,
            org_id: orgId,
            description: credit.raw.overview || null,
            poster_url: posterUrl,
            tmdb_id: tmdbId,
            imdb_id: imdbId,
            wikidata_id: wikidataId,
            director,
            genre,
            duration_minutes: durationMinutes,
            season_count: seasonCount,
            episode_count: episodeCount,
            production_countries: productionCountries,
            production_companies: productionCompanies,
            field_sources: { title: "tmdb", type: "tmdb", year: "tmdb", description: "tmdb", poster_url: "tmdb", imdb_id: imdbId ? "tmdb/wikidata" : null, season_count: seasonCount ? "tmdb" : null, episode_count: episodeCount ? "tmdb" : null },
            status: "godkendt",
          })
          .select("id")
          .single();

        if (insertErr || !newWork) {
          errors.push(`Fejl ved oprettelse af TMDB værk ${title}: ${insertErr?.message}`);
          continue;
        }
        workId = newWork.id;
        importedCount++;
      } else {
        const updates: Record<string, unknown> = {};
        if (!existing?.imdb_id && imdbId) updates.imdb_id = imdbId;
        if (!existing?.wikidata_id && wikidataId) updates.wikidata_id = wikidataId;
        const enrichment = { duration_minutes: durationMinutes, season_count: seasonCount, episode_count: episodeCount, genre, director, description: credit.raw.overview || null, production_countries: productionCountries, production_companies: productionCompanies };
        for (const [key, value] of Object.entries(enrichment)) {
          const oldValue = existing?.[key as keyof typeof existing];
          if ((oldValue == null || (Array.isArray(oldValue) && oldValue.length === 0)) && value != null) updates[key] = value;
        }
        if (Object.keys(updates).length > 0) await db.from("works").update(updates).eq("id", workId);
        linkedExistingCount++;
      }

      const selectedEpisodes = (credit.selected_episodes ?? []).filter(Number.isFinite);
      const seasonNumber = credit.season_number ?? 1;
      let assignmentWorkIds = [workId];
      if (mediaType === "tv" && selectedEpisodes.length > 0) {
        const episodes = await ensureOnboardingEpisodes({
          db,
          parent: {
            id: workId,
            org_id: orgId,
            title,
            type,
            year,
            duration_minutes: durationMinutes,
            season_count: seasonCount,
            episode_count: episodeCount,
            genre,
            director,
            description: credit.raw.overview || null,
            poster_url: posterUrl,
            status: "godkendt",
            tmdb_id: tmdbId,
            imdb_id: imdbId,
            wikidata_id: wikidataId,
          },
          seasonNumber,
          selectedEpisodes,
        });
        assignmentWorkIds = episodes.map(episode => episode.id);
      }

      const { error: assignErr } = await db
        .from("work_assignments")
        .upsert(
          assignmentWorkIds.map(targetWorkId => ({
            work_id: targetWorkId,
            org_id: orgId,
            rights_holder_id: rightsHolderId,
            role: credit.role || "Klipper",
          })),
          { onConflict: "work_id,rights_holder_id,role" }
        );

      if (assignErr) {
        errors.push(`Fejl ved kreditering af TMDB værk ${title}: ${assignErr.message}`);
      }
    } catch (err: unknown) {
      errors.push(`Systemfejl for TMDB værk ${title}: ${err instanceof Error ? err.message : "Ukendt fejl"}`);
    }
  }

  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/vaerker");

  return {
    success: errors.length === 0 || importedCount > 0 || linkedExistingCount > 0,
    importedCount,
    linkedExistingCount,
    errors: errors.length > 0 ? errors : null,
  };
}
