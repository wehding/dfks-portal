import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readActiveOrgId } from "@/lib/active-org-context";

export async function requireMemberDriveContext() {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return null;
  const db = createServiceClient();
  const activeOrgId = await readActiveOrgId();
  let query = db.from("rettighedshavere")
    .select("id,org_affiliations!inner(org_id)")
    .eq("user_id", user.id);
  if (activeOrgId) query = query.eq("org_affiliations.org_id", activeOrgId);
  const { data: holder } = await query.limit(1).maybeSingle();
  const affiliations = holder?.org_affiliations as unknown;
  const affiliation = Array.isArray(affiliations) ? affiliations[0] : affiliations;
  const orgId = affiliation && typeof affiliation === "object" && "org_id" in affiliation ? String(affiliation.org_id) : null;
  if (!holder?.id || !orgId) return null;
  return { userId: user.id, rightsHolderId: holder.id, orgId, email: user.email ?? null };
}
