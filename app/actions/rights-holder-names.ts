"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeRightsHolderName } from "@/lib/rights-holder-name";
import { recordSensitiveFlow } from "@/lib/sensitive-flow-audit";

export async function checkNameVariantAvailability(name: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { available: false, error: "Du skal være logget ind." };

  const normalizedName = normalizeRightsHolderName(name);
  if (!normalizedName) return { available: false, error: "Skriv et navn." };

  const db = createServiceClient();
  const [{ data: ownHolder }, { data: claim, error }] = await Promise.all([
    db.from("rettighedshavere").select("id").eq("user_id", user.id).maybeSingle(),
    db.from("rights_holder_name_claims").select("rights_holder_id").eq("normalized_name", normalizedName).maybeSingle(),
  ]);
  if (error) return { available: false, error: error.message };
  if (claim) {
    await recordSensitiveFlow({ actor: { userId: user.id, source: "portal" }, action: "search", component: "portal.rights-holder-name.availability", entityType: "rights_holder_name_claims", targetMemberUuid: ownHolder?.id ?? null, purposeCode: "profile_name_management", legalBasis: "GDPR Art. 6(1)(b) og 9(2)(d)", dataCategories: ["identity_data", "union_membership_data"], counts: { available: false } });
    return {
      available: false,
      error: claim.rights_holder_id === ownHolder?.id
        ? "Navnet findes allerede på din profil."
        : "Navnet bruges allerede af en anden profil og kan ikke tilføjes som navnevariant.",
    };
  }
  await recordSensitiveFlow({ actor: { userId: user.id, source: "portal" }, action: "search", component: "portal.rights-holder-name.availability", entityType: "rights_holder_name_claims", targetMemberUuid: ownHolder?.id ?? null, purposeCode: "profile_name_management", legalBasis: "GDPR Art. 6(1)(b) og 9(2)(d)", dataCategories: ["identity_data", "union_membership_data"], counts: { available: true } });
  return { available: true, error: null };
}
