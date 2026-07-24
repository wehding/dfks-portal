import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertAdminRole } from "@/lib/supabase/assert-admin";
import { STAFF_ROLES } from "@/lib/admin-roles";
import { resolveBranding } from "@/lib/branding";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const caller = await assertAdminRole(supabase, STAFF_ROLES);
  if (!caller) return NextResponse.json({ error: "Ingen administratoradgang" }, { status: 403 });

  const [{ data: organisation }, { data: holder }] = await Promise.all([
    supabase.from("organisations").select("name,logo_url,branding").eq("id", caller.orgId).maybeSingle(),
    supabase
      .from("rettighedshavere")
      .select("id,org_affiliations!inner(org_id)")
      .eq("user_id", caller.userId)
      .eq("org_affiliations.org_id", caller.orgId)
      .maybeSingle(),
  ]);

  const branding = organisation ? resolveBranding(organisation as never) : { short_name: "DFKS" };
  return NextResponse.json({
    userId: caller.userId,
    orgId: caller.orgId,
    role: caller.role,
    isAssociationMember: Boolean(holder?.id),
    brand: {
      logo_url: organisation?.logo_url ?? null,
      short_name: branding.short_name,
    },
  });
}
