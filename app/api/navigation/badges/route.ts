import { NextRequest, NextResponse } from "next/server";
import { readActiveOrgIdFromRequest } from "@/lib/active-org-context";
import { resolveAppAccessContext } from "@/lib/app-access-context";
import { normalizeNavigationBadgeCounts } from "@/lib/navigation-badges";
import { createRequestClient } from "@/lib/supabase/request-client";
import { verifyRequestUser } from "@/lib/supabase/request-auth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase, applyAuthResponse } = createRequestClient(request);
  const auth = await verifyRequestUser(supabase);
  if (!auth.ok) return applyAuthResponse(NextResponse.json({ error: auth.error }, { status: auth.status }));

  const context = await resolveAppAccessContext(supabase, readActiveOrgIdFromRequest(request), auth.userId);
  if (!context) return applyAuthResponse(NextResponse.json({ error: "Ingen organisationsadgang" }, { status: 403 }));

  const db = createServiceClient();
  const { data, error } = await db.rpc("get_navigation_badge_counts", {
    p_org_id: context.orgId,
    p_user_id: context.userId,
    p_rights_holder_id: context.rightsHolderId,
  });
  if (error) {
    console.error("[navigation-badges] rpc_failed", { code: error.code });
    return applyAuthResponse(NextResponse.json({ error: "Navigationstællere kunne ikke hentes" }, { status: 500 }));
  }
  const row = Array.isArray(data) ? data[0] : data;
  return applyAuthResponse(NextResponse.json(normalizeNavigationBadgeCounts(row as Record<string, unknown> | null)));
}
