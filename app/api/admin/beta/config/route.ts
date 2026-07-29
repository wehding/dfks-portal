import { NextRequest, NextResponse } from "next/server";
import { GLOBAL_ROLES } from "@/lib/admin-roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertAdminRole } from "@/lib/supabase/assert-admin";

export async function PATCH(request: NextRequest) {
  const caller = await assertAdminRole(await createClient(), GLOBAL_ROLES);
  if (!caller) return NextResponse.json({ error: "Kun superadmin kan ændre betateststatus." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const orgId = typeof body.orgId === "string" && /^[0-9a-f-]{36}$/i.test(body.orgId) ? body.orgId : "";
  if (!orgId || typeof body.enabled !== "boolean") return NextResponse.json({ error: "Ugyldig anmodning." }, { status: 400 });
  const { data, error } = await createServiceClient().from("organisations")
    .update({ beta_test_mode: body.enabled, updated_at: new Date().toISOString() })
    .eq("id", orgId).select("id,name,beta_test_mode").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
