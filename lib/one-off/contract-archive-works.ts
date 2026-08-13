import type { SupabaseClient } from "@supabase/supabase-js";
import { searchDFIFilms, getDFIFilmDetails } from "@/app/actions/dfi";
import { findTMDBMatch, getTMDBWorkDetails } from "@/app/actions/tmdb";
import { mapDfiWorkType, extractDfiDirectors, extractDfiPremiereYear, extractDfiPosterUrl } from "@/lib/dfi-metadata";
import { matchSharedWork } from "@/lib/server/contract-import-matching";
import { resolveWorkIdentity } from "@/lib/server/work-identity-resolver";
import { storeWorkExternalIdentity } from "@/lib/server/work-identity-storage";
import { titleSimilarity } from "@/lib/contract-import";

type WorkType = "kortfilm" | "spillefilm" | "tv-serie" | "dokumentar-serie" | "dokumentarfilm";

export type ArchiveWorkResolution = {
  id: string | null;
  score: number | null;
  created: boolean;
  source: "local" | "dfi" | "tmdb" | "none";
  title: string | null;
};

function safeType(value: string | null | undefined): WorkType | null {
  const normalized = value?.toLocaleLowerCase("da-DK") ?? "";
  if (normalized.includes("dokumentar") && normalized.includes("serie")) return "dokumentar-serie";
  if (normalized.includes("dokumentar")) return "dokumentarfilm";
  if (normalized.includes("serie") || normalized === "tv") return "tv-serie";
  if (normalized.includes("kort")) return "kortfilm";
  if (normalized.includes("spille") || normalized.includes("feature") || normalized === "movie") return "spillefilm";
  return null;
}

function externalScore(input: { title: string; year: number | null; type: WorkType | null }, candidate: { title: string; year: number | null; type: WorkType | null }) {
  const similarity = titleSimilarity(input.title, candidate.title);
  let score = similarity === 1 ? 65 : Math.round(similarity * 45);
  if (input.year && candidate.year === input.year) score += 20;
  else if (input.year && candidate.year && Math.abs(input.year - candidate.year) <= 1) score += 10;
  if (input.type && candidate.type === input.type) score += 10;
  return Math.min(100, score);
}

function objectText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? number : null;
}

export async function resolveArchiveWork(db: SupabaseClient, input: {
  orgId: string;
  title: string | null;
  alternativeTitle?: string | null;
  year: number | null;
  type: string | null;
  contractDate?: string | null;
  rightsHolderId?: string | null;
  allowExternalCreate: boolean;
}) : Promise<ArchiveWorkResolution> {
  const title = input.title?.trim() || input.alternativeTitle?.trim() || null;
  if (!title) return { id: null, score: null, created: false, source: "none", title: null };
  const type = safeType(input.type);
  const local = await matchSharedWork(db, {
    title,
    premiereYear: input.year,
    contractDate: input.contractDate,
    type,
    rightsHolderId: input.rightsHolderId,
  });
  if (local.id) {
    const { data } = await db.from("works").select("title").eq("id", local.id).maybeSingle();
    return { id: local.id, score: local.score, created: false, source: "local", title: data?.title ?? title };
  }
  if (!input.allowExternalCreate) return { id: null, score: local.score, created: false, source: "none", title };

  const dfi = await searchDFIFilms(title).catch(() => ({ success: false as const, results: [] }));
  const dfiCandidates = dfi.success ? (dfi.results ?? []).map((film: Record<string, unknown>) => {
    const candidateTitle = objectText(film.DanishTitle) ?? objectText(film.Title) ?? objectText(film.OriginalTitle) ?? "";
    const candidateType = safeType(mapDfiWorkType(film.Category, film.Type));
    const candidateYear = extractDfiPremiereYear(film);
    return { film, title: candidateTitle, type: candidateType, year: candidateYear, score: externalScore({ title, year: input.year, type }, { title: candidateTitle, year: candidateYear, type: candidateType }) };
  }).filter(candidate => candidate.title).sort((a, b) => b.score - a.score) : [];
  const firstDfi = dfiCandidates[0];
  const secondDfi = dfiCandidates[1];
  if (firstDfi && firstDfi.score >= 95 && (!secondDfi || firstDfi.score - secondDfi.score >= 10)) {
    const dfiId = objectNumber(firstDfi.film.Id);
    if (dfiId) {
      const { data: existing } = await db.from("works").select("id,title").eq("dfi_id", String(dfiId)).maybeSingle();
      if (existing) return { id: existing.id, score: firstDfi.score, created: false, source: "dfi", title: existing.title };
      const detailsResult = await getDFIFilmDetails(dfiId);
      const details = detailsResult.success && detailsResult.film ? detailsResult.film as Record<string, unknown> : firstDfi.film;
      const aliases = Array.from(new Set([title, input.alternativeTitle, objectText(details.OriginalTitle), objectText(details.DanishTitle)].filter((value): value is string => Boolean(value && value !== firstDfi.title))));
      const { data: created, error } = await db.from("works").insert({
        org_id: input.orgId,
        title: firstDfi.title,
        alternative_titles: aliases,
        type: firstDfi.type,
        year: firstDfi.year,
        director: extractDfiDirectors(details).join(", ") || null,
        poster_url: extractDfiPosterUrl(details),
        dfi_id: String(dfiId),
        dfi_metadata: details,
        status: "godkendt",
      }).select("id").single();
      if (error || !created) throw new Error(error?.message ?? "DFI-værket kunne ikke oprettes");
      return { id: created.id, score: firstDfi.score, created: true, source: "dfi", title: firstDfi.title };
    }
  }

  const preferredMedia = type === "tv-serie" || type === "dokumentar-serie" ? "tv" : "movie";
  const tmdb = await findTMDBMatch(title, input.year, preferredMedia);
  if (tmdb.tmdb_id) {
    const detailResult = await getTMDBWorkDetails(Number(tmdb.tmdb_id), tmdb.media_type ?? preferredMedia);
    if (detailResult.success && detailResult.details) {
      const details = detailResult.details as Record<string, unknown>;
      const candidateTitle = objectText(details.name) ?? objectText(details.title) ?? title;
      const candidateYear = objectNumber(String(details.first_air_date ?? details.release_date ?? "").slice(0, 4));
      const candidateType = (tmdb.media_type ?? preferredMedia) === "tv" ? (type === "dokumentar-serie" ? "dokumentar-serie" : "tv-serie") : type ?? "spillefilm";
      const score = externalScore({ title, year: input.year, type }, { title: candidateTitle, year: candidateYear, type: candidateType });
      if (score >= 95) {
        const { data: existing } = await db.from("works").select("id,title").eq("tmdb_id", Number(tmdb.tmdb_id)).maybeSingle();
        if (existing) return { id: existing.id, score, created: false, source: "tmdb", title: existing.title };
        const aliases = Array.from(new Set([title, input.alternativeTitle, objectText(details.original_title), objectText(details.original_name)].filter((value): value is string => Boolean(value && value !== candidateTitle))));
        const { data: created, error } = await db.from("works").insert({
          org_id: input.orgId,
          title: candidateTitle,
          alternative_titles: aliases,
          type: candidateType,
          year: candidateYear,
          description: objectText(details.overview),
          poster_url: tmdb.poster_url,
          tmdb_id: Number(tmdb.tmdb_id),
          status: "godkendt",
        }).select("id").single();
        if (error || !created) throw new Error(error?.message ?? "TMDb-værket kunne ikke oprettes");
        const identity = await resolveWorkIdentity({
          title: candidateTitle,
          alternativeTitles: aliases,
          year: candidateYear,
          type: candidateType,
          tmdbId: String(tmdb.tmdb_id),
        }).catch(() => null);
        const identityCandidate = identity?.status === "matched" ? identity.candidates[0] : null;
        if (identityCandidate) {
          await db.from("works").update({ imdb_id: identityCandidate.imdbId, wikidata_id: identityCandidate.wikidataId }).eq("id", created.id);
          await storeWorkExternalIdentity(db, { orgId: input.orgId, workId: created.id, level: preferredMedia === "tv" ? "series" : "movie", candidate: identityCandidate });
        }
        return { id: created.id, score, created: true, source: "tmdb", title: candidateTitle };
      }
    }
  }
  return { id: null, score: local.score, created: false, source: "none", title };
}
