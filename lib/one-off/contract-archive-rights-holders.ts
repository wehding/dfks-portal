import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMatchText, titleSimilarity } from "@/lib/contract-import";

type HolderRow = {
  id: string;
  full_name: string;
  email: string | null;
  alternative_names: string[] | null;
  org_affiliations: Array<{ org_id: string }> | null;
};

export type ArchiveRightsHolderResolution = {
  id: string | null;
  score: number | null;
  margin: number | null;
  created: boolean;
  affiliated: boolean;
  reason: string;
};

function plausiblePersonName(value: string | null | undefined) {
  const name = value?.trim() ?? "";
  if (name.length < 5 || name.length > 160) return false;
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts.every(part => /^[A-Za-zÆØÅæøåÉéÜüÖöÁáÀà.'-]+$/.test(part));
}

async function ensureDfksAffiliation(db: SupabaseClient, orgId: string, rightsHolderId: string) {
  const { data: current, error: lookupError } = await db.from("org_affiliations")
    .select("id")
    .eq("org_id", orgId)
    .eq("rights_holder_id", rightsHolderId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (current) return false;
  const { error } = await db.from("org_affiliations").insert({
    org_id: orgId,
    rights_holder_id: rightsHolderId,
    is_member: false,
    statistics_participation: false,
  });
  if (error) throw new Error(error.message);
  return true;
}

async function klipperProfessionId(db: SupabaseClient, orgId: string) {
  const { data } = await db.from("organisation_profession_types")
    .select("profession_type_id,profession_types!inner(normalized_name)")
    .eq("org_id", orgId)
    .eq("profession_types.normalized_name", "klipper")
    .limit(1)
    .maybeSingle();
  return data?.profession_type_id ? String(data.profession_type_id) : null;
}

export async function resolveArchiveRightsHolder(db: SupabaseClient, input: {
  orgId: string;
  name: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  allowCreateNonMember: boolean;
}) : Promise<ArchiveRightsHolderResolution> {
  const name = input.name?.trim() || null;
  const email = input.email?.trim().toLocaleLowerCase("da-DK") || null;
  if (!name && !email) return { id: null, score: null, margin: null, created: false, affiliated: false, reason: "missing_identity" };
  const { data, error } = await db.from("rettighedshavere")
    .select("id,full_name,email,alternative_names,org_affiliations(org_id)")
    .limit(5000);
  if (error) throw new Error(error.message);
  const ranked = ((data ?? []) as HolderRow[]).map(holder => {
    const holderEmail = holder.email?.trim().toLocaleLowerCase("da-DK") ?? null;
    const emailExact = Boolean(email && holderEmail && email === holderEmail);
    const names = [holder.full_name, ...(holder.alternative_names ?? [])];
    const similarity = name ? Math.max(...names.map(candidate => titleSimilarity(name, candidate))) : 0;
    const nameExact = similarity === 1;
    let score = emailExact ? 100 : nameExact ? 92 : Math.round(similarity * 69);
    if (emailExact && nameExact) score = 100;
    return { holder, score, emailExact, nameExact };
  }).filter(item => item.score >= 55).sort((a, b) => b.score - a.score);
  const first = ranked[0];
  const second = ranked[1];
  const margin = first ? first.score - (second?.score ?? 0) : null;
  if (first && first.score >= 90 && (!second || (margin ?? 0) >= 10)) {
    const affiliated = await ensureDfksAffiliation(db, input.orgId, first.holder.id);
    return { id: first.holder.id, score: first.score, margin, created: false, affiliated, reason: first.emailExact ? "exact_email" : "exact_name" };
  }
  if (!input.allowCreateNonMember || !plausiblePersonName(name) || first) {
    return { id: null, score: first?.score ?? null, margin, created: false, affiliated: false, reason: first ? "ambiguous" : "insufficient_identity" };
  }
  const professionId = await klipperProfessionId(db, input.orgId);
  const { data: created, error: createError } = await db.from("rettighedshavere").insert({
    user_id: null,
    full_name: name!,
    email,
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
    onboarding_completed: false,
    opt_out_statistics: true,
    ...(professionId ? { primary_profession_type_id: professionId } : {}),
  }).select("id").single();
  if (createError || !created) throw new Error(createError?.message ?? "Rettighedshaveren kunne ikke oprettes");
  const { error: affiliationError } = await db.from("org_affiliations").insert({
    org_id: input.orgId,
    rights_holder_id: created.id,
    is_member: false,
    statistics_participation: false,
  });
  if (affiliationError) {
    await db.from("rettighedshavere").delete().eq("id", created.id);
    throw new Error(affiliationError.message);
  }
  return { id: created.id, score: 100, margin: null, created: true, affiliated: true, reason: "created_non_member" };
}

export function chooseArchiveIdentity(input: {
  aiName?: unknown;
  sheetName?: string | null;
  localEmail?: string | null;
  sheetEmail?: string | null;
}) {
  const aiName = typeof input.aiName === "string" && plausiblePersonName(input.aiName) ? input.aiName.trim() : null;
  const sheetName = plausiblePersonName(input.sheetName) ? input.sheetName!.trim() : null;
  return {
    name: aiName ?? sheetName,
    email: input.localEmail?.trim().toLocaleLowerCase("da-DK") ?? input.sheetEmail?.trim().toLocaleLowerCase("da-DK") ?? null,
    nameSource: aiName ? "contract" : sheetName ? "spreadsheet" : "none",
  };
}

export function safeIdentitySummary(value: ArchiveRightsHolderResolution) {
  return {
    id: value.id,
    score: value.score,
    margin: value.margin,
    created: value.created,
    affiliated: value.affiliated,
    reason: normalizeMatchText(value.reason),
  };
}
