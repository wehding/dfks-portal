import { NextRequest, NextResponse } from "next/server";
import { createRequestClient } from "@/lib/supabase/request-client";
import { resolveAppAccessContext } from "@/lib/app-access-context";
import { readActiveOrgIdFromRequest, writeActiveOrgIdToResponse } from "@/lib/active-org-context";
import { verifyRequestUser } from "@/lib/supabase/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase, applyAuthResponse } = createRequestClient(request);
  const auth = await verifyRequestUser(supabase);
  if (!auth.ok) return applyAuthResponse(NextResponse.json({ error: auth.error }, { status: auth.status }));
  const access = await resolveAppAccessContext(supabase, readActiveOrgIdFromRequest(request), auth.userId);
  if (!access?.canUseAdmin || !access.role) return applyAuthResponse(NextResponse.json({ error: "Ingen administratoradgang" }, { status: 403 }));
  return applyAuthResponse(NextResponse.json({
    userId: access.userId,
    orgId: access.orgId,
    role: access.role,
    global: access.global,
    allowedOrgIds: access.allowedOrgIds,
    organisations: access.organisations,
    modules: access.modules,
    isAssociationMember: access.canUseMember,
    canUseAdmin: access.canUseAdmin,
    canUseMember: access.canUseMember,
    rightsHolderId: access.rightsHolderId,
    brand: access.brand,
    terminology: access.terminology,
  }));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { orgId?: unknown } | null;
  if (!body || typeof body.orgId !== "string") return NextResponse.json({ error: "Organisation mangler" }, { status: 400 });
  const { supabase, applyAuthResponse } = createRequestClient(request);
  const auth = await verifyRequestUser(supabase);
  if (!auth.ok) return applyAuthResponse(NextResponse.json({ error: auth.error }, { status: auth.status }));
  const access = await resolveAppAccessContext(supabase, body.orgId, auth.userId);
  if (!access?.canUseAdmin || access.orgId !== body.orgId || !access.allowedOrgIds.includes(body.orgId)) {
    return applyAuthResponse(NextResponse.json({ error: "Ingen adgang til organisationen" }, { status: 403 }));
  }
  const response = NextResponse.json({ ok: true, orgId: body.orgId });
  writeActiveOrgIdToResponse(response, body.orgId);
  return applyAuthResponse(response);
}
