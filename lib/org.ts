import type { SupabaseClient } from "@supabase/supabase-js";

// Standard-organisation (DFKS). ÉN kilde i stedet for spredte hardcodede id'er.
// Kan overrides via env NEXT_PUBLIC_DEFAULT_ORG_ID (virker både server- og klientside).
export const DEFAULT_ORG_ID =
  process.env.NEXT_PUBLIC_DEFAULT_ORG_ID ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

// Slå en brugers organisation op fra user_org_roles.
// Falder tilbage til DEFAULT_ORG_ID indtil invite→org garanterer en rolle for alle
// (jf. plan Del 2c). Når det er på plads, kan fallback fjernes helt.
export async function resolveOrgId(
  db: SupabaseClient,
  userId: string,
  fallback: string = DEFAULT_ORG_ID
): Promise<string> {
  const { data } = await db
    .from("user_org_roles")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return (data?.org_id as string | undefined) ?? fallback;
}
