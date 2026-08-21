import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readActiveOrgId } from "@/lib/active-org-context";
import { resolveAppAccessContext, type AppAccessContext } from "@/lib/app-access-context";

// DFKS' organisation-id bruges kun til seed/scripts og eksplicit DFKS-data.
// Det må ikke bruges som automatisk fallback for indloggede brugere.
export const DEFAULT_ORG_ID =
  process.env.NEXT_PUBLIC_DEFAULT_ORG_ID ?? "3dfcad23-03ce-4de0-82f2-6566dfcd88a5";

export async function resolveOrgId(
  db: SupabaseClient,
  userId: string
): Promise<string | null> {
  const requestedOrgId = await readActiveOrgId().catch(() => null);
  return (await resolveAppAccessContext(db, requestedOrgId, userId))?.orgId ?? null;
}

export async function resolveMemberContext(db: SupabaseClient, userId: string): Promise<AppAccessContext | null> {
  const requestedOrgId = await readActiveOrgId().catch(() => null);
  const context = await resolveAppAccessContext(db, requestedOrgId, userId);
  return context?.canUseMember ? context : null;
}

export async function requireMemberContext(db: SupabaseClient, userId: string): Promise<AppAccessContext> {
  const context = await resolveMemberContext(db, userId);
  if (!context) throw new Error("Du er ikke rettighedshaver i den aktive organisation.");
  return context;
}

export async function requireOrgId(db: SupabaseClient, userId: string): Promise<string> {
  const orgId = await resolveOrgId(db, userId);
  if (!orgId) {
    throw new Error("Din bruger er ikke knyttet til en organisation. Kontakt administrator.");
  }
  return orgId;
}
