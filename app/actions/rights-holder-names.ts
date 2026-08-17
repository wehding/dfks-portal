"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeRightsHolderName } from "@/lib/rights-holder-name";

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
    return {
      available: false,
      error: claim.rights_holder_id === ownHolder?.id
        ? "Navnet findes allerede på din profil."
        : "Navnet bruges allerede af en anden profil og kan ikke tilføjes som navnevariant.",
    };
  }
  return { available: true, error: null };
}
