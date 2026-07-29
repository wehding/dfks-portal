import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveStaffAccess } from "@/lib/staff-access";
import { resolveBranding } from "@/lib/branding";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const access = await resolveStaffAccess(supabase);
  if (!access) return NextResponse.json({ error: "Ingen administratoradgang" }, { status: 403 });

  const [{ data: organisation }, { data: holder }] = await Promise.all([
    supabase.from("organisations").select("name,logo_url,branding").eq("id", access.activeOrgId).maybeSingle(),
    supabase
      .from("rettighedshavere")
      .select("id,org_affiliations!inner(org_id)")
      .eq("user_id", access.userId)
      .eq("org_affiliations.org_id", access.activeOrgId)
      .maybeSingle(),
  ]);

  const branding = organisation ? resolveBranding(organisation as never) : { short_name: "DFKS" };
  return NextResponse.json({
    userId: access.userId,
    orgId: access.activeOrgId,
    role: access.activeRole,
    global: access.global,
    allowedOrgIds: access.allowedOrgIds,
    modules: access.modules,
    isAssociationMember: Boolean(holder?.id),
    brand: {
      logo_url: organisation?.logo_url ?? null,
      short_name: branding.short_name,
    },
  });
}
