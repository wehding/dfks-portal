import { resolveBranding } from "@/lib/branding";
import { isAccountAccessMode, type AccountAccessMode } from "@/lib/auth/account-access";
import { resolveOrgId } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import AccountAccessClient, { type AccountAccessStatus } from "./AccountAccessClient";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AccountAccessPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const candidateMode = rawMode ?? null;
  const mode: AccountAccessMode = isAccountAccessMode(candidateMode) ? candidateMode : "invite";
  const rawError = Array.isArray(params.error) ? params.error[0] : params.error;

  let status: AccountAccessStatus = rawError === "invalid_link" ? "invalid_link" : "ready";
  let email = "";
  let logoUrl: string | null = null;
  let brand = resolveBranding(null);

  if (status === "ready") {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      status = "missing_session";
    } else {
      email = user.email ?? "";
      const orgId = await resolveOrgId(supabase, user.id);
      if (!orgId) {
        status = "missing_org";
      } else {
        const { data: org } = await supabase
          .from("organisations")
          .select("name, logo_url, branding")
          .eq("id", orgId)
          .maybeSingle();

        if (org) {
          brand = resolveBranding(org as never);
          logoUrl = org.logo_url ?? null;
        }
      }
    }
  }

  return (
    <AccountAccessClient
      mode={mode}
      status={status}
      email={email}
      logoUrl={logoUrl}
      brand={brand}
    />
  );
}
