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
  return (data?.org_id as string | undefined) ?? null;
}

export async function requireOrgId(db: SupabaseClient, userId: string): Promise<string> {
  const orgId = await resolveOrgId(db, userId);
  if (!orgId) {
    throw new Error("Din bruger er ikke knyttet til en organisation. Kontakt administrator.");
  }
  return orgId;
}
