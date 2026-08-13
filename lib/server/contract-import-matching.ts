import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONTRACT_MATCH_VERSION,
  hasImplausibleFilmTiming,
  premiereWindowScore,
  selectAutomaticMatch,
  titleSimilarity,
  type SafeMatchEvidence,
  type ScoredCandidate,
} from "@/lib/contract-import";

type Holder = { id: string; full_name: string; alternative_names: string[] | null };
type Work = {
  id: string;
  title: string;
  alternative_titles: string[] | null;
  year: number | null;
  type: string | null;
};

export type ContractMatchResult = {
  id: string | null;
  score: number | null;
  evidence: SafeMatchEvidence[];
  version: string;
  candidates: Array<{ id: string; label: string; score: number }>;
};

function extractedYear(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const match = String(value ?? "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

export async function matchRightsHolder(
  db: SupabaseClient,
  input: { orgId: string; name: string | null; workId?: string | null },
): Promise<ContractMatchResult> {
  if (!input.name?.trim()) return { id: null, score: null, evidence: [], version: CONTRACT_MATCH_VERSION, candidates: [] };
  const { data } = await db.from("rettighedshavere")
    .select("id,full_name,alternative_names,org_affiliations!inner(org_id)")
    .eq("org_affiliations.org_id", input.orgId);
  let credited = new Set<string>();
  if (input.workId) {
    const assignmentResult = await db.from("work_assignments").select("rights_holder_id").eq("work_id", input.workId);
    credited = new Set((assignmentResult.data ?? []).map(row => String(row.rights_holder_id)));
  }
  const scored: Array<ScoredCandidate<Holder> & { label: string }> = ((data ?? []) as Holder[]).map(holder => {
    const names = [holder.full_name, ...(holder.alternative_names ?? [])];
    const exactPrimary = titleSimilarity(input.name, holder.full_name) === 1;
    const exactAlias = names.slice(1).some(name => titleSimilarity(input.name, name) === 1);
    const similarity = Math.max(...names.map(name => titleSimilarity(input.name, name)));
    const evidence: SafeMatchEvidence[] = [];
    let score = 0;
    if (exactPrimary) { score += 92; evidence.push({ signal: "exact_primary_name", points: 92 }); }
    else if (exactAlias) { score += 88; evidence.push({ signal: "exact_credit_name", points: 88 }); }
    else {
      const namePoints = Math.round(Math.min(69, similarity * 69));
      score += namePoints;
      if (namePoints) evidence.push({ signal: "fuzzy_name", points: namePoints });
    }
    if (credited.has(holder.id)) { score += 18; evidence.push({ signal: "credited_on_work", points: 18 }); }
    return { value: holder, label: holder.full_name, score: Math.min(100, score), evidence };
  }).filter(candidate => candidate.score >= 55).sort((a, b) => b.score - a.score);
  const selected = selectAutomaticMatch(scored, 92, 12);
  return {
    id: selected?.value.id ?? null,
    score: selected?.score ?? scored[0]?.score ?? null,
    evidence: selected?.evidence ?? scored[0]?.evidence ?? [],
    version: CONTRACT_MATCH_VERSION,
    candidates: scored.slice(0, 5).map(candidate => ({ id: candidate.value.id, label: candidate.label, score: candidate.score })),
  };
}

export async function matchSharedWork(
  db: SupabaseClient,
  input: { title: string | null; premiereYear: number | null; contractDate?: string | null; type?: string | null; rightsHolderId?: string | null },
): Promise<ContractMatchResult> {
  if (!input.title?.trim()) return { id: null, score: null, evidence: [], version: CONTRACT_MATCH_VERSION, candidates: [] };
  const { data } = await db.from("works").select("id,title,alternative_titles,year,type").is("parent_work_id", null).limit(2500);
  let credited = new Set<string>();
  if (input.rightsHolderId) {
    const assignments = await db.from("work_assignments").select("work_id").eq("rights_holder_id", input.rightsHolderId);
    credited = new Set((assignments.data ?? []).map(row => String(row.work_id)));
  }
  const contractYear = extractedYear(input.contractDate);
  const scored: Array<ScoredCandidate<Work> & { label: string }> = ((data ?? []) as Work[]).map(work => {
    const titles = [work.title, ...(work.alternative_titles ?? [])];
    const similarity = Math.max(...titles.map(title => titleSimilarity(input.title, title)));
    const exact = similarity === 1;
    const evidence: SafeMatchEvidence[] = [];
    let score = exact ? 65 : Math.round(Math.min(45, similarity * 45));
    evidence.push({ signal: exact ? "exact_title_or_alias" : "fuzzy_title", points: score });
    if (input.premiereYear && work.year === input.premiereYear) { score += 20; evidence.push({ signal: "exact_premiere_year", points: 20 }); }
    else {
      const points = premiereWindowScore(contractYear, work.year);
      if (points) { score += points; evidence.push({ signal: "contract_to_premiere_window", points }); }
    }
    if (input.type && work.type === input.type) { score += 10; evidence.push({ signal: "work_type", points: 10 }); }
    if (credited.has(work.id)) { score += 25; evidence.push({ signal: "rights_holder_credit", points: 25 }); }
    if (hasImplausibleFilmTiming(input.contractDate, work.year, work.type)) {
      score = Math.min(score, 74);
      evidence.push({ signal: "implausible_film_timing", points: -100 });
    }
    return { value: work, label: work.title, score: Math.min(100, score), evidence };
  }).filter(candidate => candidate.score >= 55).sort((a, b) => b.score - a.score);
  const selected = selectAutomaticMatch(scored, 90, 10);
  return {
    id: selected?.value.id ?? null,
    score: selected?.score ?? scored[0]?.score ?? null,
    evidence: selected?.evidence ?? scored[0]?.evidence ?? [],
    version: CONTRACT_MATCH_VERSION,
    candidates: scored.slice(0, 5).map(candidate => ({ id: candidate.value.id, label: candidate.label, score: candidate.score })),
  };
}
