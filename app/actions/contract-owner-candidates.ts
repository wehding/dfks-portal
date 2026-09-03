"use server";

import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import { createServiceClient } from "@/lib/supabase/service";
import type { ContractOwnerSummary } from "@/lib/contract-owner-verification-types";

type OwnershipContext = {
  userId: string;
  orgId: string;
  role: "superadmin" | "admin" | "org-admin";
};

async function requireOwnershipContext(operation: "read" | "write") {
  const context = await getRequestAppAccessContext();
  const role = context?.role;
  if (
    !context?.canUseAdmin
    || !role
    || !(USER_ADMIN_ROLES as readonly string[]).includes(role)
    || !context.modules?.contract_ownership?.[operation]
  ) return null;
  return { userId: context.userId, orgId: context.orgId, role } as OwnershipContext;
}

export async function createContractOwnerCandidate(name: string) {
  const caller = await requireOwnershipContext("write");
  if (!caller) return { success: false as const, error: "Ikke autoriseret", code: "forbidden" as const };
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length < 2) return { success: false as const, error: "Navnet skal være mindst 2 tegn", code: "invalid_input" as const };

  const db = createServiceClient();
  const { data, error: createError } = await db.rpc("create_contract_owner_candidate", {
    p_org_id: caller.orgId,
    p_actor_user_id: caller.userId,
    p_actor_role: caller.role,
    p_full_name: trimmed,
  });

  const result = data as { id?: string; fullName?: string; created?: boolean } | null;
  if (createError || !result?.id || !result.fullName) {
    const duplicate = createError?.code === "23505";
    return {
      success: false as const,
      error: duplicate
        ? "Der findes allerede en rettighedshaver med dette navn. Vælg personen i søgeresultatet."
        : "Kunne ikke oprette rettighedshaveren. Prøv igen.",
      code: duplicate ? "duplicate" as const : "create_failed" as const,
    };
  }

  const candidate: ContractOwnerSummary = {
    id: result.id,
    name: result.fullName,
    secondaryLabel: result.created ? "Nyoprettet rettighedshaver" : "Eksisterende rettighedshaver",
  };
  return { success: true as const, candidate };
}
