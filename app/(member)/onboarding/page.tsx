import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { decryptRettighedshaver } from "@/lib/encryption";
import OnboardingClient from "./OnboardingClient";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveTerminology } from "@/lib/branding";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: rh } = await supabase
    .from("rettighedshavere")
    .select("id, full_name, email, phone, address, cpr_no, bank_account, gender, onboarding_completed, alternative_names, professional_start_year, primary_profession_type_id, usual_work_mode, primary_work_region_code, org_affiliations(org_id,is_member)")
    .eq("user_id", user.id)
    .single();

  if (rh?.onboarding_completed) {
    redirect("/portal");
  }

  const affiliation = Array.isArray(rh?.org_affiliations) ? rh?.org_affiliations[0] : rh?.org_affiliations;
  const profile = rh ? { ...rh, is_member: Boolean(affiliation?.is_member) } : null;
  const service = createServiceClient();
  const orgId = affiliation?.org_id as string | undefined;
  const [{ data: organisation }, { data: professionRows }, { data: regionRows }, { data: secondaryRows }] = await Promise.all([
    orgId ? service.from("organisations").select("terminology,statistics_profile_config").eq("id", orgId).maybeSingle() : Promise.resolve({ data: null }),
    orgId ? service.from("organisation_profession_types").select("profession_type_id,display_order,profession_types(name)").eq("org_id", orgId).order("display_order") : Promise.resolve({ data: [] }),
    orgId ? service.from("organisation_work_regions").select("code,name_da,name_en").eq("org_id", orgId).eq("active", true).order("display_order") : Promise.resolve({ data: [] }),
    rh?.id ? service.from("rights_holder_profession_types").select("profession_type_id").eq("rights_holder_id", rh.id) : Promise.resolve({ data: [] }),
  ]);
  const terminology = resolveTerminology(organisation ? { terminology: organisation.terminology } : null);
  const statisticsProfile = {
    config: (organisation?.statistics_profile_config ?? {}) as Record<string, boolean>,
    professionLabel: terminology.role_labels[0] ?? terminology.coeditor_word,
    professionTypes: (professionRows ?? []).map(row => ({ id: row.profession_type_id as string, name: (row.profession_types as unknown as { name?: string } | null)?.name ?? "" })).filter(row => row.name),
    workRegions: (regionRows ?? []).map(row => ({ code: row.code as string, nameDa: row.name_da as string, nameEn: row.name_en as string })),
    secondaryProfessionTypeIds: (secondaryRows ?? []).map(row => row.profession_type_id as string),
  };

  return <OnboardingClient rh={decryptRettighedshaver(profile)} user={user} statisticsProfile={statisticsProfile} />;
}
