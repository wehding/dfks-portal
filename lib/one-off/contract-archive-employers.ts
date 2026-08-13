import type { SupabaseClient } from "@supabase/supabase-js";
import { companyMatchScore, type ProductionCompanyOption } from "@/lib/production-companies";

export type ArchiveEmployerMatch = { id: string; name: string; score: number };

export async function matchArchiveEmployers(db: SupabaseClient, names: string[]) {
  const cleanNames = Array.from(new Set(names.map(name => name.trim()).filter(Boolean)));
  if (!cleanNames.length) return [] as ArchiveEmployerMatch[];
  const { data, error } = await db.from("employers")
    .select("id,name,is_verified,employer_aliases(alias),employer_legal_entities(id,legal_name,registration_country,registration_type,registration_number,entity_kind,is_primary,registration_status,archived_at)")
    .is("merged_into_id", null).is("archived_at", null).limit(5000);
  if (error) throw new Error(error.message);
  const options: ProductionCompanyOption[] = (data ?? []).map(employer => ({
    employerId: employer.id,
    canonicalName: employer.name,
    aliases: (employer.employer_aliases ?? []).map(item => item.alias),
    legalEntities: (employer.employer_legal_entities ?? []).filter(item => !item.archived_at).map(item => ({
      id: item.id, legalName: item.legal_name, registrationCountry: item.registration_country,
      registrationType: item.registration_type, registrationNumber: item.registration_number,
      entityKind: item.entity_kind, isPrimary: item.is_primary, registrationStatus: item.registration_status,
    })),
    isVerified: Boolean(employer.is_verified),
  }));
  const matches = cleanNames.flatMap(name => {
    const ranked = options.map(option => ({ option, score: companyMatchScore(option, name) })).sort((left, right) => right.score - left.score);
    const first = ranked[0];
    const second = ranked[1];
    if (!first || first.score < 96 || (second && first.score - second.score < 10)) return [];
    return [{ id: first.option.employerId, name: first.option.canonicalName, score: Math.min(100, first.score) }];
  });
  return Array.from(new Map(matches.map(match => [match.id, match])).values());
}

export async function attachArchiveEmployers(db: SupabaseClient, input: {
  orgId: string;
  contractId: string;
  workId: string | null;
  matches: ArchiveEmployerMatch[];
}) {
  if (!input.matches.length) return;
  const { count: contractRelations, error: contractCountError } = await db.from("contract_employers")
    .select("id", { count: "exact", head: true }).eq("contract_id", input.contractId);
  if (contractCountError) throw new Error(contractCountError.message);
  if (!contractRelations) {
    const inserted = await db.from("contract_employers").insert(input.matches.map((match, index) => ({
      contract_id: input.contractId, employer_id: match.id, relation_role: "counterparty",
      sort_order: index, source: "archive_import",
    })));
    if (inserted.error) throw new Error(inserted.error.message);
    const mirror = await db.from("contracts").update({ employer_id: input.matches[0].id }).eq("id", input.contractId).is("employer_id", null);
    if (mirror.error) throw new Error(mirror.error.message);
  }
  if (!input.workId) return;
  const organisation = await db.from("work_organisations").upsert({ work_id: input.workId, org_id: input.orgId, relation_role: "catalogue" }, { onConflict: "work_id,org_id" });
  if (organisation.error) throw new Error(organisation.error.message);
  const { count: workRelations, error: workCountError } = await db.from("work_employers").select("id", { count: "exact", head: true }).eq("work_id", input.workId);
  if (workCountError) throw new Error(workCountError.message);
  if (!workRelations) {
    const inserted = await db.from("work_employers").insert(input.matches.map((match, index) => ({
      work_id: input.workId, employer_id: match.id, relation_role: "producer",
      sort_order: index, source: "archive_import",
    })));
    if (inserted.error) throw new Error(inserted.error.message);
    const mirror = await db.from("works").update({ employer_id: input.matches[0].id, production_companies: input.matches.map(match => match.name) }).eq("id", input.workId).is("employer_id", null);
    if (mirror.error) throw new Error(mirror.error.message);
  }
}
