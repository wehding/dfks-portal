import { NextRequest, NextResponse } from "next/server";
import { resolveAppAccessContext } from "@/lib/app-access-context";
import { readActiveOrgIdFromRequest, writeActiveOrgIdToResponse } from "@/lib/active-org-context";
import { createRequestClient } from "@/lib/supabase/request-client";
import { verifyRequestUser } from "@/lib/supabase/request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase, applyAuthResponse } = createRequestClient(request);
  const auth = await verifyRequestUser(supabase);
  if (!auth.ok) {
    return applyAuthResponse(NextResponse.json({ error: auth.error }, { status: auth.status }));
  }
  const context = await resolveAppAccessContext(supabase, readActiveOrgIdFromRequest(request), auth.userId);
  if (!context) {
    return applyAuthResponse(NextResponse.json({ error: "Ingen organisationsadgang" }, { status: 403 }));
  }
  return applyAuthResponse(NextResponse.json(context));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { orgId?: unknown } | null;
  if (!body || typeof body.orgId !== "string") {
    return NextResponse.json({ error: "Organisation mangler" }, { status: 400 });
  }
  const { supabase, applyAuthResponse } = createRequestClient(request);
  const auth = await verifyRequestUser(supabase);
  if (!auth.ok) {
    return applyAuthResponse(NextResponse.json({ error: auth.error }, { status: auth.status }));
  }
  const context = await resolveAppAccessContext(supabase, body.orgId, auth.userId);
  if (!context || context.orgId !== body.orgId || !context.allowedOrgIds.includes(body.orgId)) {
    return applyAuthResponse(NextResponse.json({ error: "Ingen adgang til organisationen" }, { status: 403 }));
  }
  const response = NextResponse.json({
    ok: true,
    orgId: body.orgId,
    canUseAdmin: context.canUseAdmin,
    canUseMember: context.canUseMember,
  });
  writeActiveOrgIdToResponse(response, body.orgId);
  return applyAuthResponse(response);
}
