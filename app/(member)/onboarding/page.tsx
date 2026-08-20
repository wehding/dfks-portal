import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { decryptRettighedshaver } from "@/lib/encryption";
import OnboardingClient from "./OnboardingClient";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveDefaultRole } from "@/lib/branding";
import { mustCompleteOnboarding, resolveOnboardingStatus } from "@/lib/auth/onboarding-state";
import { resolvePostLoginDestination } from "@/lib/auth/post-login";
import { listCurrentLegalDocuments } from "@/lib/server/legal-document-records";
import { resolveOrgId } from "@/lib/org";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: rh } = await supabase
    .from("rettighedshavere")
    .select("id, full_name, email, phone, address, cpr_no, bank_account, gender, onboarding_completed, onboarding_completed_at, onboarding_required_at, alternative_names, professional_start_year, primary_profession_type_id, usual_work_mode, primary_work_region_code, org_affiliations(org_id,is_member,statistics_participation)")
    .eq("user_id", user.id)
    .single();

  const onboardingStatus = resolveOnboardingStatus({
    hasPortalUser: Boolean(rh?.id),
    completedAt: rh?.onboarding_completed_at,
    requiredAt: rh?.onboarding_required_at,
    lastSignInAt: user.last_sign_in_at,
  });
  if (rh && !mustCompleteOnboarding(onboardingStatus)) redirect(await resolvePostLoginDestination(supabase, user.id, user.last_sign_in_at));

  const service = createServiceClient();
  const resolvedOrgId = await resolveOrgId(service, user.id);
  const affiliations = Array.isArray(rh?.org_affiliations) ? rh?.org_affiliations : [rh?.org_affiliations];
  const affiliation = affiliations.find(row => row?.org_id === resolvedOrgId) ?? affiliations.find(Boolean);
  const profile = rh ? {
    ...rh,
    is_member: Boolean(affiliation?.is_member),
    statistics_participation: affiliation?.statistics_participation ?? null,
  } : null;
  const orgId = affiliation?.org_id as string | undefined;
  const audience = affiliation?.is_member ? "member" : "non_member";
  const [{ data: organisation }, { data: professionRows }, { data: regionRows }, { data: secondaryRows }, legalDocuments] = await Promise.all([
    orgId ? service.from("organisations").select("terminology,statistics_profile_config").eq("id", orgId).maybeSingle() : Promise.resolve({ data: null }),
    orgId ? service.from("organisation_profession_types").select("profession_type_id,display_order,profession_types(name)").eq("org_id", orgId).order("display_order") : Promise.resolve({ data: [] }),
    orgId ? service.from("organisation_work_regions").select("code,name_da,name_en").eq("org_id", orgId).eq("active", true).order("display_order") : Promise.resolve({ data: [] }),
    rh?.id ? service.from("rights_holder_profession_types").select("profession_type_id").eq("rights_holder_id", rh.id) : Promise.resolve({ data: [] }),
    orgId ? listCurrentLegalDocuments(service, orgId, audience) : Promise.resolve([]),
  ]);
  const statisticsProfile = {
    config: (organisation?.statistics_profile_config ?? {}) as Record<string, boolean>,
    professionLabel: resolveDefaultRole(organisation ? { terminology: organisation.terminology } : null),
    professionTypes: (professionRows ?? []).map(row => ({ id: row.profession_type_id as string, name: (row.profession_types as unknown as { name?: string } | null)?.name ?? "" })).filter(row => row.name),
    workRegions: (regionRows ?? []).map(row => ({ code: row.code as string, nameDa: row.name_da as string, nameEn: row.name_en as string })),
    secondaryProfessionTypeIds: (secondaryRows ?? []).map(row => row.profession_type_id as string),
  };

  return <OnboardingClient rh={decryptRettighedshaver(profile)} user={user} statisticsProfile={statisticsProfile} legalDocuments={legalDocuments} isRepeatOnboarding={onboardingStatus === "reset_required"} />;
}
