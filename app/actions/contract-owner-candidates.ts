"use server";

import { USER_ADMIN_ROLES } from "@/lib/admin-roles";
import { getRequestAppAccessContext } from "@/lib/server/request-app-access-context";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";
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
  const { data: rh, error: createError } = await db
    .from("rettighedshavere")
    .insert({ full_name: trimmed })
    .select("id, full_name")
    .single();

  if (createError || !rh) {
    return { success: false as const, error: createError?.message ?? "Kunne ikke oprette rettighedshaver" };
  }

  await db.from("org_affiliations").insert({
    org_id: caller.orgId,
    rights_holder_id: rh.id,
    is_member: false,
  });

  await recordSensitiveFlow({
    actor: { userId: caller.userId, orgId: caller.orgId, role: caller.role, source: "admin" },
    action: "create",
    component: "admin.contract_ownership.create_owner_candidate",
    entityType: "rettighedshavere",
    targetMemberUuids: [rh.id],
    orgIds: [caller.orgId],
    purposeCode: "contract_owner_verification",
    legalBasis: "GDPR Art. 6(1)(b)/(f)",
    dataCategories: ["identity_data"],
  });

  const candidate: ContractOwnerSummary = {
    id: rh.id,
    name: rh.full_name,
    secondaryLabel: "Nyoprettet rettighedshaver",
  };
  return { success: true as const, candidate };
}
