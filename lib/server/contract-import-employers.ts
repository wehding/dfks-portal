import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMatchText } from "@/lib/contract-import";
import { companyMatchScore, type ProductionCompanyOption } from "@/lib/production-companies";

export type ContractEmployerMatch = {
  id: string;
  name: string;
  score: number;
  evidence: Array<{ signal: string; points: number }>;
};

function candidateToken(name: string) {
  return normalizeMatchText(name).split(" ")
    .filter(token => token.length >= 3 && !["aps", "as", "film", "produktion", "production"].includes(token))
    .sort((left, right) => right.length - left.length)[0] ?? normalizeMatchText(name);
}

export async function matchContractEmployers(db: SupabaseClient, names: string[]) {
  const cleanNames = Array.from(new Set(names.map(name => name.trim()).filter(Boolean)));
  if (!cleanNames.length) return { matches: [] as ContractEmployerMatch[], candidates: [] as ContractEmployerMatch[] };

  const candidateIds = new Set<string>();
  for (const name of cleanNames) {
    const token = candidateToken(name).replace(/[%_,()]/g, "");
    if (!token) continue;
    const pattern = `%${token}%`;
    const [canonical, aliases, legal] = await Promise.all([
      db.from("employers").select("id").ilike("name", pattern).is("merged_into_id", null).is("archived_at", null).limit(100),
      db.from("employer_aliases").select("employer_id").ilike("alias", pattern).limit(100),
      db.from("employer_legal_entities").select("employer_id").ilike("legal_name", pattern).is("archived_at", null).limit(100),
    ]);
    for (const result of [canonical, aliases, legal]) {
      if (result.error) throw new Error(result.error.message);
    }
    canonical.data?.forEach(item => candidateIds.add(String(item.id)));
    aliases.data?.forEach(item => candidateIds.add(String(item.employer_id)));
    legal.data?.forEach(item => candidateIds.add(String(item.employer_id)));
  }
  if (!candidateIds.size) return { matches: [] as ContractEmployerMatch[], candidates: [] as ContractEmployerMatch[] };

  const { data, error } = await db.from("employers")
    .select("id,name,is_verified,employer_aliases(alias),employer_legal_entities(id,legal_name,registration_country,registration_type,registration_number,entity_kind,is_primary,registration_status,archived_at)")
    .in("id", Array.from(candidateIds)).is("merged_into_id", null).is("archived_at", null);
  if (error) throw new Error(error.message);

  const options: ProductionCompanyOption[] = (data ?? []).map(employer => ({
    employerId: employer.id,
    canonicalName: employer.name,
    aliases: (employer.employer_aliases ?? []).map(item => item.alias),
    legalEntities: (employer.employer_legal_entities ?? []).filter(item => !item.archived_at).map(item => ({
      id: item.id,
      legalName: item.legal_name,
      registrationCountry: item.registration_country,
      registrationType: item.registration_type,
      registrationNumber: item.registration_number,
      entityKind: item.entity_kind,
      isPrimary: item.is_primary,
      registrationStatus: item.registration_status,
    })),
    isVerified: Boolean(employer.is_verified),
  }));

  const rankedByName = cleanNames.map(name => options.map(option => ({
    id: option.employerId,
    name: option.canonicalName,
    score: Math.min(100, companyMatchScore(option, name)),
    evidence: [{ signal: "canonical_alias_or_legal_name", points: Math.min(100, companyMatchScore(option, name)) }],
  })).sort((left, right) => right.score - left.score));

  const candidates = Array.from(new Map(rankedByName.flat().sort((left, right) => right.score - left.score)
    .map(candidate => [candidate.id, candidate])).values()).slice(0, 10);
  const matches = rankedByName.flatMap(ranked => {
    const first = ranked[0];
    const second = ranked[1];
    return first && first.score >= 96 && (!second || first.score - second.score >= 10) ? [first] : [];
  });
  return { matches: Array.from(new Map(matches.map(match => [match.id, match])).values()), candidates };
}

export async function attachContractEmployers(db: SupabaseClient, input: {
  contractId: string;
  matches: ContractEmployerMatch[];
}) {
  if (!input.matches.length) return;
  const { count, error: countError } = await db.from("contract_employers")
    .select("id", { count: "exact", head: true }).eq("contract_id", input.contractId);
  if (countError) throw new Error(countError.message);
  if (count) return; // Never replace a manual or previously confirmed relation.

  const relation = await db.from("contract_employers").insert(input.matches.map((match, index) => ({
    contract_id: input.contractId,
    employer_id: match.id,
    relation_role: "counterparty",
    sort_order: index,
    source: "contract_import",
  })));
  if (relation.error) throw new Error(relation.error.message);
  const mirror = await db.from("contracts").update({ employer_id: input.matches[0].id })
    .eq("id", input.contractId).is("employer_id", null);
  if (mirror.error) throw new Error(mirror.error.message);
}
