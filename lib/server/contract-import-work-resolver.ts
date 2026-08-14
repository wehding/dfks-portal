import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { searchDFIFilms, getDFIFilmDetails } from "@/app/actions/dfi";
import { getTMDBWorkDetails, searchTMDB } from "@/app/actions/tmdb";
import { mapDfiWorkType, extractDfiDirectors, extractDfiPremiereYear, extractDfiPosterUrl } from "@/lib/dfi-metadata";
import { contractProductionTypeToWorkType, normalizeMatchText, titleSimilarity } from "@/lib/contract-import";
import { matchSharedWork, type ContractMatchResult } from "@/lib/server/contract-import-matching";
import { resolveWorkIdentity } from "@/lib/server/work-identity-resolver";

type Candidate = {
  title: string;
  year: number | null;
  type: string | null;
  score: number;
  sources: string[];
  dfiId: string | null;
  tmdbId: number | null;
  imdbId: string | null;
  wikidataId: string | null;
  raw?: Record<string, unknown>;
};

export type ContractWorkResolution = ContractMatchResult & {
  created: boolean;
  source: string | null;
};

function workType(value: unknown) {
  return contractProductionTypeToWorkType(value);
}

function lookupTitle(title: string, type: string | null) {
  return workType(type)?.includes("serie")
    ? title.replace(/\s*[-–—,:]?\s*(?:sæson|season)\s*\d+\s*$/iu, "").replace(/\s+[IVXLCDM]+\s*$/u, "").trim() || title
    : title.trim();
}

function yearOf(value: unknown) {
  const match = String(value ?? "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function candidateScore(input: { title: string; year: number | null; type: string | null; contractDate?: string | null }, candidate: Pick<Candidate, "title" | "year" | "type">) {
  const similarity = titleSimilarity(input.title, candidate.title);
  let score = similarity === 1 ? 75 : Math.round(similarity * 50);
  if (input.year && candidate.year === input.year) score += 20;
  else if (input.year && candidate.year && Math.abs(input.year - candidate.year) <= 1) score += 8;
  else if (!input.year && input.contractDate && candidate.year) {
    const contractYear = yearOf(input.contractDate);
    if (contractYear && candidate.year >= contractYear && candidate.year <= contractYear + 3) score += 20;
  }
  if (workType(input.type) && workType(input.type) === workType(candidate.type)) score += 10;
  return Math.min(100, score);
}

function candidateKey(candidate: Candidate) {
  return `${normalizeMatchText(candidate.title)}|${candidate.year ?? ""}|${workType(candidate.type) ?? ""}`;
}

function mergeCandidates(candidates: Candidate[]) {
  const merged = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const previous = merged.get(key);
    if (!previous) { merged.set(key, candidate); continue; }
    merged.set(key, {
      ...previous,
      ...candidate,
      score: Math.max(previous.score, candidate.score),
      sources: Array.from(new Set([...previous.sources, ...candidate.sources])),
      dfiId: previous.dfiId ?? candidate.dfiId,
      tmdbId: previous.tmdbId ?? candidate.tmdbId,
      imdbId: previous.imdbId ?? candidate.imdbId,
      wikidataId: previous.wikidataId ?? candidate.wikidataId,
      raw: previous.raw ?? candidate.raw,
    });
  }
  return Array.from(merged.values()).sort((left, right) => right.score - left.score);
}

async function existingByExternalId(db: SupabaseClient, candidate: Candidate) {
  if (candidate.dfiId) {
    const result = await db.from("works").select("id").eq("dfi_id", candidate.dfiId).maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (result.data) return result.data.id as string;
  }
  if (candidate.tmdbId) {
    const result = await db.from("works").select("id").eq("tmdb_id", candidate.tmdbId).maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (result.data) return result.data.id as string;
  }
  if (candidate.imdbId) {
    const result = await db.from("works").select("id").eq("imdb_id", candidate.imdbId).maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (result.data) return result.data.id as string;
  }
  return null;
}

export async function resolveContractImportWork(db: SupabaseClient, input: {
  orgId: string;
  title: string | null;
  year: number | null;
  type: string | null;
  contractDate?: string | null;
  rightsHolderId?: string | null;
  allowExternalCreate?: boolean;
}): Promise<ContractWorkResolution> {
  if (!input.title?.trim()) return { id: null, score: null, evidence: [], version: "2026-08-v1", candidates: [], created: false, source: null };
  const title = lookupTitle(input.title, input.type);
  const local = await matchSharedWork(db, { ...input, title, premiereYear: input.year });
  if (local.id) return { ...local, created: false, source: "local" };
  if (input.allowExternalCreate === false) return { ...local, created: false, source: null };

  const candidates: Candidate[] = [];
  const [dfiResult, tmdbResult, identity] = await Promise.all([
    searchDFIFilms(title).catch(() => ({ success: false as const, results: [] })),
    searchTMDB(title).catch(() => []),
    resolveWorkIdentity({ title, year: input.year, type: input.type }).catch(() => null),
  ]);

  if (dfiResult.success) {
    for (const film of dfiResult.results ?? []) {
      const raw = film as Record<string, unknown>;
      const candidate: Candidate = {
        title: String(raw.DanishTitle ?? raw.Title ?? raw.OriginalTitle ?? "").trim(),
        year: extractDfiPremiereYear(raw),
        type: mapDfiWorkType(raw.Category, raw.Type),
        score: 0,
        sources: ["dfi"],
        dfiId: raw.Id == null ? null : String(raw.Id),
        tmdbId: null, imdbId: null, wikidataId: null, raw,
      };
      if (candidate.title) { candidate.score = candidateScore({ ...input, title }, candidate); candidates.push(candidate); }
    }
  }
  for (const item of tmdbResult) {
    const raw = item as unknown as Record<string, unknown>;
    const mediaType = String(raw.media_type ?? (raw.first_air_date ? "tv" : "movie"));
    const candidate: Candidate = {
      title: String(raw.name ?? raw.title ?? "").trim(),
      year: yearOf(raw.release_date ?? raw.first_air_date),
      type: mediaType === "tv" ? (workType(input.type) === "dokumentar-serie" ? "dokumentar-serie" : "tv-serie") : workType(input.type) ?? "spillefilm",
      score: 0,
      sources: ["tmdb"], dfiId: null,
      tmdbId: Number(raw.id) || null, imdbId: null, wikidataId: null, raw,
    };
    if (candidate.title) { candidate.score = candidateScore({ ...input, title }, candidate); candidates.push(candidate); }
  }
  for (const item of identity?.candidates ?? []) {
    const candidate: Candidate = {
      title: item.title,
      year: item.year ?? null,
      type: item.type === "series" ? workType(input.type) ?? "tv-serie" : workType(input.type) ?? "spillefilm",
      score: 0,
      sources: item.sources,
      dfiId: item.dfiId ?? null,
      tmdbId: Number(item.tmdbId) || null,
      imdbId: item.imdbId,
      wikidataId: item.wikidataId ?? null,
    };
    candidate.score = candidateScore({ ...input, title }, candidate);
    candidates.push(candidate);
  }

  const ranked = mergeCandidates(candidates);
  const first = ranked[0];
  const second = ranked[1];
  const safe = first && first.score >= 95 && (!second || first.score - second.score >= 10) ? first : null;
  const exposedCandidates = ranked.slice(0, 5).map(candidate => ({
    id: candidate.dfiId ? `dfi:${candidate.dfiId}` : candidate.tmdbId ? `tmdb:${candidate.tmdbId}` : candidate.imdbId ?? candidateKey(candidate),
    label: candidate.title,
    score: candidate.score,
  }));
  if (!safe) return { ...local, score: first?.score ?? local.score, candidates: exposedCandidates, created: false, source: null };

  const existing = await existingByExternalId(db, safe);
  if (existing) return {
    id: existing, score: safe.score, evidence: [{ signal: "verified_external_identity", points: safe.score }],
    version: local.version, candidates: exposedCandidates, created: false, source: safe.sources.join("+")
  };

  let details: Record<string, unknown> = safe.raw ?? {};
  if (safe.dfiId) {
    const detail = await getDFIFilmDetails(Number(safe.dfiId)).catch(() => null);
    if (detail?.success && detail.film) details = detail.film as Record<string, unknown>;
  } else if (safe.tmdbId) {
    const detail = await getTMDBWorkDetails(safe.tmdbId, safe.type?.includes("serie") ? "tv" : "movie");
    if (detail.success && detail.details) details = detail.details as Record<string, unknown>;
  }
  const { data: created, error } = await db.from("works").insert({
    org_id: input.orgId,
    title: safe.title,
    alternative_titles: safe.title === input.title ? [] : [input.title],
    type: safe.type,
    year: safe.year,
    director: safe.dfiId ? extractDfiDirectors(details).join(", ") || null : Array.isArray(details.directors) ? details.directors.join(", ") : null,
    description: typeof details.overview === "string" ? details.overview : null,
    poster_url: safe.dfiId ? extractDfiPosterUrl(details) : null,
    dfi_id: safe.dfiId,
    tmdb_id: safe.tmdbId,
    imdb_id: safe.imdbId,
    wikidata_id: safe.wikidataId,
    dfi_metadata: safe.dfiId ? details : null,
    status: "godkendt",
  }).select("id").single();
  if (error || !created) {
    const raced = await existingByExternalId(db, safe);
    if (!raced) throw new Error(error?.message ?? "Værket kunne ikke oprettes");
    return { id: raced, score: safe.score, evidence: [{ signal: "verified_external_identity", points: safe.score }], version: local.version, candidates: exposedCandidates, created: false, source: safe.sources.join("+") };
  }
  const organisation = await db.from("work_organisations").upsert({ work_id: created.id, org_id: input.orgId, relation_role: "catalogue" }, { onConflict: "work_id,org_id" });
  if (organisation.error) throw new Error(organisation.error.message);
  return {
    id: created.id, score: safe.score, evidence: [{ signal: "verified_external_identity", points: safe.score }],
    version: local.version, candidates: exposedCandidates, created: true, source: safe.sources.join("+")
  };
}
