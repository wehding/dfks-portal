import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export async function getRightsHolderInOrg(
  db: SupabaseClient,
  rhId: string,
  orgId: string
): Promise<{
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  user_id: string | null;
  invite_sent_at: string | null;
  onboarding_completed: boolean | null;
} | null> {
  const { data, error } = await db
    .from("rettighedshavere")
    .select("id, full_name, email, phone, user_id, invite_sent_at, onboarding_completed, org_affiliations!inner(org_id)")
    .eq("id", rhId)
    .eq("org_affiliations.org_id", orgId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as never;
}

export async function assertRightsHolderInOrg(
  db: SupabaseClient,
  rhId: string,
  orgId: string
) {
  const holder = await getRightsHolderInOrg(db, rhId, orgId);
  if (!holder) throw new Error("Rettighedshaveren tilhører ikke din organisation.");
  return holder;
}

export async function assertUserInOrg(
  db: SupabaseClient,
  userId: string,
  orgId: string
) {
  const [{ data: role }, { data: holder }] = await Promise.all([
    db
      .from("user_org_roles")
      .select("user_id")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      // En bruger kan have flere roller i samme organisation. Vi skal kun
      // bevise medlemskabet, ikke kræve at forespørgslen giver præcis én række.
      .limit(1)
      .maybeSingle(),
    db
      .from("rettighedshavere")
      .select("id, org_affiliations!inner(org_id)")
      .eq("user_id", userId)
      .eq("org_affiliations.org_id", orgId)
      .maybeSingle(),
  ]);

  if (!role && !holder) throw new Error("Brugeren tilhører ikke din organisation.");
}

export async function assertContractInOrg(
  db: SupabaseClient,
  contractId: string,
  orgId: string
) {
  const { data, error } = await db
    .from("contracts")
    .select("id, org_id, rights_holder_id, pdf_url")
    .eq("id", contractId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Kontrakten tilhører ikke din organisation.");
  return data as { id: string; org_id: string; rights_holder_id: string | null; pdf_url: string | null };
}

export async function assertContractReviewInOrg(
  db: SupabaseClient,
  reviewId: string,
  orgId: string
) {
  const { data, error } = await db
    .from("contract_reviews")
    .select("id, org_id, storage_path")
    .eq("id", reviewId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Kontraktgennemgangen tilhører ikke din organisation.");
  return data as { id: string; org_id: string; storage_path: string | null };
}

export async function assertWorkInOrg(
  db: SupabaseClient,
  workId: string,
  orgId: string
) {
  const { data, error } = await db
    .from("works")
    .select("id, org_id")
    .eq("id", workId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Værket tilhører ikke din organisation.");
  return data as { id: string; org_id: string };
}

export async function getRightsHolderForUser(
  db: SupabaseClient,
  userId: string
) {
  const { data, error } = await db
    .from("rettighedshavere")
    .select("id, full_name, email, org_affiliations!inner(org_id)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as { id: string; full_name: string | null; email: string | null; org_affiliations?: unknown } | null;
}
