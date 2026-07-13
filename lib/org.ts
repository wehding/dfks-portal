import type { SupabaseClient } from "@supabase/supabase-js";

// DFKS' organisation-id bruges kun til seed/scripts og eksplicit DFKS-data.
// Det må ikke bruges som automatisk fallback for indloggede brugere.
export const DEFAULT_ORG_ID =
  process.env.NEXT_PUBLIC_DEFAULT_ORG_ID ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

export async function resolveOrgId(
  db: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await db
    .from("user_org_roles")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (data?.org_id) return data.org_id as string;

  const { data: holder } = await db
    .from("rettighedshavere")
    .select("org_affiliations(org_id)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  const affiliations = holder?.org_affiliations as Array<{ org_id?: string | null }> | null | undefined;
  return affiliations?.find(affiliation => affiliation.org_id)?.org_id ?? null;
}

export async function requireOrgId(db: SupabaseClient, userId: string): Promise<string> {
  const orgId = await resolveOrgId(db, userId);
  if (!orgId) {
    throw new Error("Din bruger er ikke knyttet til en organisation. Kontakt administrator.");
  }
  return orgId;
}
