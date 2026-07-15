import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { decryptRettighedshaver } from "@/lib/encryption";
import OnboardingClient from "./OnboardingClient";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: rh } = await supabase
    .from("rettighedshavere")
    .select("full_name, email, phone, address, cpr_no, bank_account, gender, onboarding_completed, alternative_names, org_affiliations(is_member)")
    .eq("user_id", user.id)
    .single();

  if (rh?.onboarding_completed) {
    redirect("/portal");
  }

  const affiliation = Array.isArray(rh?.org_affiliations) ? rh?.org_affiliations[0] : rh?.org_affiliations;
  const profile = rh ? { ...rh, is_member: Boolean(affiliation?.is_member) } : null;

  return <OnboardingClient rh={decryptRettighedshaver(profile)} user={user} />;
}
