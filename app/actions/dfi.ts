"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { findTMDBMatch } from "@/app/actions/tmdb";
import { extractDfiDirectors, extractDfiPosterUrl, extractDfiPremiereYear, mapDfiWorkType, type DfiMetadata } from "@/lib/dfi-metadata";

// DFI org_id bruges ved import — DFKS default
const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";
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

  const { data: orgRole } = await db
    .from("user_org_roles")
    .select("org_id")
    .eq("user_id", authData.user.id)
    .limit(1)
    .single();

  return { db, userId: authData.user.id, rightsHolderId: rh.id as string, orgId: orgRole?.org_id ?? DFKS_ORG_ID };
}

async function findExistingWorkForDfiCredit(db: ReturnType<typeof createServiceClient>, credit: DfiCredit, orgId: string) {
  const filmId = credit.Id ? String(credit.Id) : null;
  if (filmId) {
    const { data } = await db
      .from("works")
      .select("id, title, year, poster_url, tmdb_id, dfi_metadata")
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
    .select("id, title, year, poster_url, tmdb_id, dfi_metadata")
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
  return { success: true, credits: result.data.FilmCredits || [] };
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

    await db
      .from("rettighedshavere")
      .update({ dfi_person_id: personId })
      .eq("id", rightsHolderId);

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
  console.log("[DFI import] Rettighedshaver:", rightsHolderId, "| Credits:", selectedCredits.length);

  // Gem dfi_person_id på rettighedshaveren
  await db
    .from("rettighedshavere")
    .update({ dfi_person_id: personId })
    .eq("id", rightsHolderId);

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
      console.error(`[DFI import] Film ${filmId} fejlede:`, res.error);
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

    let posterUrl = await downloadDfiPosterDataUrl(film) ?? extractDfiPosterUrl(film);

    // Slå plakat og tmdb_id op i TMDB (stille fejl)
    let tmdbId: number | null = null;
    try {
      const match = await findTMDBMatch(filmTitle, prodYear);
      tmdbId = match.tmdb_id;
      if (!posterUrl) posterUrl = match.poster_url;
    } catch { /* tmdbId/posterUrl forbliver som de er */ }

    try {
      const existing = await findExistingWorkForDfiCredit(db, { ...credit, Title: filmTitle, ProductionYear: prodYear }, orgId);
      let workId = existing?.id ?? null;

      const workData = {
        dfi_id: String(filmId),
        title: filmTitle,
        type: workType,
        year: prodYear,
        org_id: orgId,
        description: film.Synopsis || film.ShortSynopsis || null,
        director: extractDfiDirectors(film).join(", ") || null,
        poster_url: posterUrl,
        tmdb_id: tmdbId,
        dfi_metadata: film,
        dfi_title: typeof film.Title === "string" ? film.Title : null,
        dfi_danish_title: typeof film.DanishTitle === "string" ? film.DanishTitle : null,
        dfi_original_title: typeof film.OriginalTitle === "string" ? film.OriginalTitle : null,
        dfi_category: typeof film.Category === "string" ? film.Category : null,
        dfi_type: typeof film.Type === "string" ? film.Type : null,
      };

      const wasExisting = Boolean(workId);
      if (!workId) {
        const { data: newWork, error: insertErr } = await db
          .from("works")
          .insert(workData)
          .select("id")
          .single();

        if (insertErr || !newWork) {
          console.error(`[DFI import] INSERT works fejl for "${filmTitle}":`, insertErr);
          errors.push(`Fejl ved oprettelse af ${filmTitle}: ${insertErr?.message}`);
          continue;
        }
        console.log(`[DFI import] Oprettet work: "${filmTitle}" (${workId})`);
        workId = newWork.id;
      } else if (existing) {
        // Opdater hvis der mangler plakat eller TMDB id
        const updates: Record<string, unknown> = {};
        if (!existing.poster_url && posterUrl) updates.poster_url = posterUrl;
        if (!existing.tmdb_id && tmdbId) updates.tmdb_id = tmdbId;
        updates.dfi_metadata = film;
        if (Object.keys(updates).length > 0) {
          await db.from("works").update(updates).eq("id", workId);
        }
      }

      // Tilføj work_assignment
      const { error: assignErr } = await db
        .from("work_assignments")
        .upsert(
          {
            work_id: workId,
            org_id: orgId,
            rights_holder_id: rightsHolderId,
            role: credit.Description || credit.Type || "Klipper",
          },
          { onConflict: "work_id,rights_holder_id,role" }
        );

      if (assignErr) {
        console.error(`[DFI import] UPSERT work_assignments fejl for "${filmTitle}":`, assignErr);
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
