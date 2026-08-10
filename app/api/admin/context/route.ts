import { NextRequest, NextResponse } from "next/server";
import { createRequestClient } from "@/lib/supabase/request-client";
import { resolveStaffAccess } from "@/lib/staff-access";
import { resolveBranding } from "@/lib/branding";
import { readActiveOrgIdFromRequest, writeActiveOrgIdToResponse } from "@/lib/active-org-context";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { supabase, applyCookies } = createRequestClient(request);
  const access = await resolveStaffAccess(supabase, readActiveOrgIdFromRequest(request));
  if (!access) return applyCookies(NextResponse.json({ error: "Ingen administratoradgang" }, { status: 403 }));

  const [{ data: organisation }, { data: holder }, { data: organisations }] = await Promise.all([
    supabase.from("organisations").select("name,logo_url,branding").eq("id", access.activeOrgId).maybeSingle(),
    supabase
      .from("rettighedshavere")
      .select("id,org_affiliations!inner(org_id)")
      .eq("user_id", access.userId)
      .eq("org_affiliations.org_id", access.activeOrgId)
      .maybeSingle(),
    supabase.from("organisations").select("id,name").in("id", access.allowedOrgIds).order("name"),
  ]);

  const branding = organisation ? resolveBranding(organisation as never) : { short_name: "DFKS" };
  return applyCookies(NextResponse.json({
    userId: access.userId,
    orgId: access.activeOrgId,
    role: access.activeRole,
    global: access.global,
    allowedOrgIds: access.allowedOrgIds,
    organisations: organisations ?? [],
    modules: access.modules,
    isAssociationMember: Boolean(holder?.id),
    brand: {
      logo_url: organisation?.logo_url ?? null,
      short_name: branding.short_name,
    },
  }));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { orgId?: unknown } | null;
  if (!body || typeof body.orgId !== "string") return NextResponse.json({ error: "Organisation mangler" }, { status: 400 });
  const { supabase, applyCookies } = createRequestClient(request);
  const access = await resolveStaffAccess(supabase, body.orgId);
  if (!access || access.activeOrgId !== body.orgId || !access.allowedOrgIds.includes(body.orgId)) {
    return applyCookies(NextResponse.json({ error: "Ingen adgang til organisationen" }, { status: 403 }));
  }
  const response = NextResponse.json({ ok: true, orgId: body.orgId });
  writeActiveOrgIdToResponse(response, body.orgId);
  return applyCookies(response);
}
