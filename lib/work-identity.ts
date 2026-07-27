export const IDENTITY_STATUSES = ["matched", "review_required", "not_found", "error"] as const;

export type IdentityStatus = typeof IDENTITY_STATUSES[number];
export type WorkIdentityLevel = "movie" | "series" | "episode";
export type WorkIdentitySource = "existing" | "tmdb" | "wikidata" | "omdb" | "manual";

export type IdentityCandidate = {
  imdbId: string;
  tmdbId?: string | null;
  wikidataId?: string | null;
  dfiId?: string | null;
  title: string;
  year?: number | null;
  type?: WorkIdentityLevel | null;
  confidence: number;
  sources: WorkIdentitySource[];
  matchedBy: string[];
};

export type IdentityResolution = {
  status: IdentityStatus;
  confidence: number | null;
  candidates: IdentityCandidate[];
  sources: WorkIdentitySource[];
  errorCode?: string | null;
};

export type WorkIdentityInput = {
  workId?: string;
  title: string;
  alternativeTitles?: string[] | null;
  year?: number | null;
  type?: string | null;
  imdbId?: string | null;
  tmdbId?: string | number | null;
  wikidataId?: string | null;
  dfiId?: string | null;
  parent?: {
    title: string;
    imdbId?: string | null;
    tmdbId?: string | number | null;
    wikidataId?: string | null;
    dfiId?: string | null;
  } | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

export function normalizeIdentityTitle(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da-DK")
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9æøå]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripTechnicalSeriesSuffix(value: string) {
  return value
    .replace(/\s*[-–—:]\s*oversigt\s*$/i, "")
    .replace(/\s+oversigt\s*$/i, "")
    .trim();
}

export function identityTitleVariants(input: Pick<WorkIdentityInput, "title" | "alternativeTitles">) {
  const raw = [input.title, ...(input.alternativeTitles ?? [])]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value));
  return Array.from(new Map(raw.flatMap(value => [value, stripTechnicalSeriesSuffix(value)])
    .filter(Boolean)
    .map(value => [normalizeIdentityTitle(value), value])).values());
}

export function identityLevel(type: string | null | undefined, parent?: WorkIdentityInput["parent"]): WorkIdentityLevel {
  if (parent) return "episode";
  const normalized = normalizeIdentityTitle(type ?? "");
  return normalized.includes("serie") || normalized === "tv" ? "series" : "movie";
}

export function validImdbId(value: unknown): value is string {
  return typeof value === "string" && /^tt\d{7,10}$/.test(value);
}

export function validWikidataId(value: unknown): value is string {
  return typeof value === "string" && /^Q\d+$/.test(value);
}

export function isInheritedEpisodeIdentity(childValue: unknown, parentValue: unknown) {
  return childValue !== null && childValue !== undefined && String(childValue) !== ""
    && parentValue !== null && parentValue !== undefined && String(childValue) === String(parentValue);
}

export function scoreIdentityCandidate(input: WorkIdentityInput, candidate: {
  title?: string | null;
  year?: number | null;
  type?: WorkIdentityLevel | null;
  directExternalLink?: boolean;
  exactEpisodeRelation?: boolean;
  strongProviderMatch?: boolean;
}) {
  const variants = identityTitleVariants(input).map(normalizeIdentityTitle);
  const candidateTitle = normalizeIdentityTitle(candidate.title ?? "");
  let confidence = 0;
  const matchedBy: string[] = [];

  if (candidate.directExternalLink) {
    confidence += 70;
    matchedBy.push("external_id");
  }
  if (candidate.exactEpisodeRelation) {
    confidence += 70;
    matchedBy.push("season_episode");
  }
  if (candidate.strongProviderMatch) {
    confidence += 40;
    matchedBy.push("provider_match");
  }
  if (candidateTitle && variants.includes(candidateTitle)) {
    confidence += 25;
    matchedBy.push("title");
  }
  if (input.year && candidate.year === input.year) {
    confidence += 15;
    matchedBy.push("year");
  } else if (input.year && candidate.year && Math.abs(input.year - candidate.year) <= 1) {
    confidence += 7;
    matchedBy.push("year_near");
  }
  if (candidate.type && candidate.type === identityLevel(input.type, input.parent)) {
    confidence += 10;
    matchedBy.push("type");
  }

  return { confidence: Math.min(confidence, 100), matchedBy };
}

export function classifyIdentityCandidates(candidates: IdentityCandidate[]): IdentityResolution {
  const byImdbId = new Map<string, IdentityCandidate>();
  for (const candidate of candidates.filter(candidate => validImdbId(candidate.imdbId))) {
    const existing = byImdbId.get(candidate.imdbId);
    if (!existing) {
      byImdbId.set(candidate.imdbId, candidate);
      continue;
    }
    byImdbId.set(candidate.imdbId, {
      ...existing,
      ...candidate,
      confidence: Math.max(existing.confidence, candidate.confidence),
      sources: Array.from(new Set([...existing.sources, ...candidate.sources])),
      matchedBy: Array.from(new Set([...existing.matchedBy, ...candidate.matchedBy])),
      tmdbId: candidate.tmdbId ?? existing.tmdbId,
      wikidataId: candidate.wikidataId ?? existing.wikidataId,
      dfiId: candidate.dfiId ?? existing.dfiId,
    });
  }
  const unique = Array.from(byImdbId.values()).sort((a, b) => b.confidence - a.confidence);
  const best = unique[0];
  if (!best) return { status: "not_found", confidence: null, candidates: [], sources: [] };
  if (best.confidence < 75) {
    return {
      status: "not_found",
      confidence: best.confidence,
      candidates: unique,
      sources: Array.from(new Set(unique.flatMap(candidate => candidate.sources))),
    };
  }
  const conflicting = unique.some(candidate => candidate.imdbId !== best.imdbId && candidate.confidence >= 75);
  const status: IdentityStatus = best.confidence >= 90 && !conflicting ? "matched" : "review_required";
  return {
    status,
    confidence: best.confidence,
    candidates: unique,
    sources: Array.from(new Set(unique.flatMap(candidate => candidate.sources))),
  };
}

export function identityFingerprint(input: WorkIdentityInput) {
  return JSON.stringify({
    title: normalizeIdentityTitle(input.title),
    alternativeTitles: identityTitleVariants(input).map(normalizeIdentityTitle).sort(),
    year: input.year ?? null,
    type: identityLevel(input.type, input.parent),
    parentImdbId: input.parent?.imdbId ?? null,
    seasonNumber: input.seasonNumber ?? null,
    episodeNumber: input.episodeNumber ?? null,
  });
}
