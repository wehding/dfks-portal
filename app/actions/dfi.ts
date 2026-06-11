"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

// DFI org_id bruges ved import — DFKS default
const DFKS_ORG_ID = "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

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
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      return { success: false, error: "Tidsafbrydelse: DFI API svarede ikke inden for 15 sekunder." };
    }
    return { success: false, error: error.message || "Netværksfejl ved DFI API-kald" };
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
  let searchQuery = cleanedTitle;

  if (hasSpaces) {
    const words = cleanedTitle.split(/\s+/).map((w) => w.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ""));
    const distinctiveWords = words.filter((w) => w.length > 2);
    const candidates = distinctiveWords.length > 0 ? distinctiveWords : words;
    searchQuery = candidates.reduce((longest, current) =>
      current.length > longest.length ? current : longest, "");
  }

  const result = await fetchDFI(`/v1/film?Title=${encodeURIComponent(searchQuery)}`);
  if (!result.success || !result.data) {
    return { success: false, error: result.error || "Ingen film fundet." };
  }

  let filmList = result.data.FilmList || [];

  if (hasSpaces && filmList.length > 0) {
    const originalLower = cleanedTitle.toLowerCase();
    const scored = filmList.map((film: any) => {
      const t = (film.Title || "").toLowerCase();
      let score = t === originalLower ? 100 : t.includes(originalLower) ? 50 : 0;
      originalLower.split(/\s+/).filter((w) => w.length > 1).forEach((w) => {
        if (t.includes(w)) score += 10;
      });
      return { film, score };
    });
    scored.sort((a: any, b: any) => b.score - a.score);
    filmList = scored.filter((i: any) => i.score > 0).map((i: any) => i.film);
  }

  return { success: true, results: filmList };
}

export async function getDFIFilmDetails(filmId: number) {
  const result = await fetchDFI(`/v1/film/${filmId}`);
  if (!result.success || !result.data) {
    return { success: false, error: result.error || "Kunne ikke hente filmdetaljer." };
  }
  return { success: true, film: result.data };
}

export async function importApprovedDFIWorks(personId: number, selectedCredits: any[]) {
  const supabase = await createClient();        // til auth + rettighedshaver
  const db = createServiceClient();             // til works + work_assignments (bypasser RLS)
  const { data: authData } = await supabase.auth.getUser();

  if (!authData?.user) {
    return { success: false, error: "Du skal være logget ind for at importere værker." };
  }

  const userId = authData.user.id;

  // Hent rettighedshaver for denne bruger
  const { data: rh } = await db
    .from("rettighedshavere")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (!rh) {
    console.error("[DFI import] Ingen rettighedshaver fundet for user_id:", userId);
    return { success: false, error: "Kunne ikke finde din rettighedshaver-profil." };
  }
  console.log("[DFI import] Rettighedshaver:", rh.id, "| Credits:", selectedCredits.length);

  // Gem dfi_person_id på rettighedshaveren
  await db
    .from("rettighedshavere")
    .update({ dfi_person_id: personId })
    .eq("id", rh.id);

  // Hent brugerens org (eller brug DFKS default)
  const { data: orgRole } = await db
    .from("user_org_roles")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .single();

  const orgId = orgRole?.org_id ?? DFKS_ORG_ID;

  let importedCount = 0;
  const errors: string[] = [];

  const KNOWN_BROADCASTERS = [
    "DR", "Danmarks Radio", "TV 2", "TV2", "SVT", "NRK",
    "Netflix", "HBO", "Viaplay", "Discovery", "Disney", "Apple TV", "ZDF", "ARTE",
  ];

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

  for (const item of detailResults.filter(Boolean) as { credit: any; film: any }[]) {
    const { credit, film } = item;
    const filmId = credit.Id;

    const categoryLower = (film.Category || "").toLowerCase();
    const typeLower = (film.Type || "").toLowerCase();
    let workType = "fiktion";
    if (categoryLower.includes("dokumentar") || typeLower.includes("dokumentar")) workType = "dokumentar";
    else if (typeLower.includes("serie") || typeLower.includes("tv-serie")) workType = "serie";

    const directors = (film.PersonCredits || [])
      .filter((c: any) => c.TypeCode === "instr")
      .map((c: any) => c.Name)
      .join(", ") || null;

    let platformNote: string | null = null;
    for (const c of film.ProductionCompanies || []) {
      const match = KNOWN_BROADCASTERS.find((b) =>
        c.Name?.toLowerCase().includes(b.toLowerCase())
      );
      if (match) { platformNote = match; break; }
    }

    const prodYear: number | null = film.ProductionYear || film.ReleaseYear || null;
    const filmTitle: string = film.Title || film.DanishTitle || "Ukendt titel";

    // Slå plakat op i TMDB (stille fejl)
    let posterUrl: string | null = null;
    try {
      const tmdbRes = await fetchTMDBPoster(filmTitle, prodYear);
      posterUrl = tmdbRes;
    } catch { /* posterUrl forbliver null */ }

    try {
      // Tjek om værket allerede eksisterer
      let existingId: string | null = null;

      const { data: byDfi } = await db
        .from("works")
        .select("id")
        .eq("dfi_id", String(filmId))
        .maybeSingle();

      if (byDfi) {
        existingId = byDfi.id;
      } else if (filmTitle && prodYear) {
        const { data: byTitle } = await db
          .from("works")
          .select("id")
          .ilike("title", filmTitle.trim())
          .eq("year", prodYear)
          .maybeSingle();
        if (byTitle) existingId = byTitle.id;
      }

      let workId = existingId;

      const workData = {
        dfi_id: String(filmId),
        title: filmTitle,
        type: workType,
        year: prodYear,
        org_id: orgId,
        description: film.Synopsis || film.ShortSynopsis || null,
        poster_url: posterUrl,
      };

      if (workId) {
        await db.from("works").update(workData).eq("id", workId);
      } else {
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
      }

      // Tilføj work_assignment
      const { error: assignErr } = await db
        .from("work_assignments")
        .upsert(
          {
            work_id: workId,
            org_id: orgId,
            rights_holder_id: rh.id,
            role: credit.Description || credit.Type || "Klipper",
          },
          { onConflict: "work_id,rights_holder_id,role" }
        );

      if (assignErr) {
        console.error(`[DFI import] UPSERT work_assignments fejl for "${filmTitle}":`, assignErr);
        errors.push(`Fejl ved kreditering af ${filmTitle}: ${assignErr.message}`);
        continue;
      }

      importedCount++;
    } catch (err: any) {
      errors.push(`Systemfejl for ${filmTitle}: ${err.message}`);
    }
  }

  revalidatePath("/portal/mine-vaerker");
  revalidatePath("/vaerker");

  return {
    success: errors.length === 0 || importedCount > 0,
    importedCount,
    errors: errors.length > 0 ? errors : null,
  };
}

// Intern helper: hent TMDB-plakat-sti
async function fetchTMDBPoster(title: string, year: number | null): Promise<string | null> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey || !title) return null;

  const q = encodeURIComponent(title.trim());
  const yearParam = year ? `&year=${year}` : "";
  const sep = apiKey.length === 32 ? `&api_key=${apiKey}` : "";
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey.length !== 32) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/search/movie?query=${q}${yearParam}&language=da-DK${sep}`,
      { headers }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.results?.[0]?.poster_path) return data.results[0].poster_path;
    }
  } catch { /* stille fejl */ }
  return null;
}
