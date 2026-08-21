import { NextRequest, NextResponse } from "next/server";
import { resolveAppAccessContext } from "@/lib/app-access-context";
import { readActiveOrgIdFromRequest, writeActiveOrgIdToResponse } from "@/lib/active-org-context";
import { createRequestClient } from "@/lib/supabase/request-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase, applyCookies } = createRequestClient(request);
  const context = await resolveAppAccessContext(supabase, readActiveOrgIdFromRequest(request));
  if (!context) {
    return applyCookies(NextResponse.json({ error: "Ingen organisationsadgang" }, { status: 403 }));
  }
  return applyCookies(NextResponse.json(context));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { orgId?: unknown } | null;
  if (!body || typeof body.orgId !== "string") {
    return NextResponse.json({ error: "Organisation mangler" }, { status: 400 });
  }
  const { supabase, applyCookies } = createRequestClient(request);
  const context = await resolveAppAccessContext(supabase, body.orgId);
  if (!context || context.orgId !== body.orgId || !context.allowedOrgIds.includes(body.orgId)) {
    return applyCookies(NextResponse.json({ error: "Ingen adgang til organisationen" }, { status: 403 }));
  }
  const response = NextResponse.json({
    ok: true,
    orgId: body.orgId,
    canUseAdmin: context.canUseAdmin,
    canUseMember: context.canUseMember,
  });
  writeActiveOrgIdToResponse(response, body.orgId);
  return applyCookies(response);
}
