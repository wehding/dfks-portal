import { NextRequest, NextResponse } from "next/server";
import { createRequestClient } from "@/lib/supabase/request-client";
import { resolveAppAccessContext } from "@/lib/app-access-context";
import { readActiveOrgIdFromRequest, writeActiveOrgIdToResponse } from "@/lib/active-org-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase, applyCookies } = createRequestClient(request);
  const access = await resolveAppAccessContext(supabase, readActiveOrgIdFromRequest(request));
  if (!access?.canUseAdmin || !access.role) return applyCookies(NextResponse.json({ error: "Ingen administratoradgang" }, { status: 403 }));
  return applyCookies(NextResponse.json({
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
  const { supabase, applyCookies } = createRequestClient(request);
  const access = await resolveAppAccessContext(supabase, body.orgId);
  if (!access?.canUseAdmin || access.orgId !== body.orgId || !access.allowedOrgIds.includes(body.orgId)) {
    return applyCookies(NextResponse.json({ error: "Ingen adgang til organisationen" }, { status: 403 }));
  }
  const response = NextResponse.json({ ok: true, orgId: body.orgId });
  writeActiveOrgIdToResponse(response, body.orgId);
  return applyCookies(response);
}
